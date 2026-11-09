import asyncio
from datetime import datetime, timedelta, timezone
import gzip
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch
import urllib.parse

from fastapi import HTTPException
from fastapi.testclient import TestClient
import httpx
import pytest

from app.config import TMP_STREAM_DIR
from app.main import app
from app.streamer import (
    StreamInfo,
    parse_range_header,
    stream_cache,
    validate_video_id,
)


@pytest.fixture
def client():
    # Use context manager so lifespan startup/shutdown execute
    with TestClient(app) as test_client:
        yield test_client


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "liner-web-gateway",
        "version": "0.1.8",
    }


# ============================================================================
# PROXY, ANTI-SSRF, & STREAMING DECOMPRESSION TESTS
# ============================================================================

def test_proxy_rejects_non_https(client):
    response = client.get("/api/proxy?url=http://music.youtube.com/search")
    assert response.status_code == 403
    assert "Only https" in response.json()["detail"]


def test_proxy_rejects_unlisted_domain(client):
    response = client.get("/api/proxy?url=https://example.com/test")
    assert response.status_code == 403
    assert "not allowlisted" in response.json()["detail"]


def test_proxy_rejects_literal_ip(client):
    response = client.get("/api/proxy?url=https://127.0.0.1/test")
    assert response.status_code == 403


def test_proxy_rejects_credentials_in_url(client):
    response = client.get("/api/proxy?url=https://admin:secret@music.youtube.com/search")
    assert response.status_code == 403
    assert "Credentials in URL" in response.json()["detail"]


def test_proxy_rejects_ssrf_private_ip(client):
    fake_addr_info = [(2, 1, 6, "", ("127.0.0.1", 443))]
    with patch("socket.getaddrinfo", return_value=fake_addr_info):
        response = client.get("/api/proxy?url=https://music.youtube.com/search")
        assert response.status_code == 403
        assert "prohibited network address" in response.json()["detail"]


def test_proxy_forwarding_and_header_rewriting(client):
    fake_addr_info = [(2, 1, 6, "", ("142.250.190.46", 443))]
    captured_request = {}

    def mock_handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["url"] = str(request.url)
        captured_request["headers"] = dict(request.headers)
        return httpx.Response(
            status_code=200,
            headers={"content-type": "application/json", "access-control-allow-origin": "evil.com"},
            content=b'{"result": "ok"}',
        )

    mock_transport = httpx.MockTransport(mock_handler)
    mock_proxy_client = httpx.AsyncClient(transport=mock_transport, follow_redirects=False)

    with patch("app.proxy.resolve_host_ips", return_value=("142.250.190.46",)), \
         patch("app.proxy.get_proxy_client", return_value=mock_proxy_client):
        response = client.get(
            "/api/proxy?url=https://music.youtube.com/youtubei/v1/search",
            headers={
                "x-liner-user-agent": "LinerClient/2.0",
                "accept": "application/json",
            },
        )
        assert response.status_code == 200
        assert response.json() == {"result": "ok"}
        assert captured_request["headers"]["origin"] == "https://music.youtube.com"
        assert captured_request["headers"]["referer"] == "https://music.youtube.com/"
        assert captured_request["headers"]["user-agent"] == "LinerClient/2.0"
        assert captured_request["headers"]["accept"] == "application/json"
        assert response.headers.get("access-control-allow-origin") != "evil.com"


def test_proxy_gzipped_response_decompression_and_streaming(client):
    """Test MockTransport streaming with gzip compression to verify Content-Length alignment (Bug 1 & 3)."""
    fake_addr_info = [(2, 1, 6, "", ("142.250.190.46", 443))]
    data_dict = {"status": "success", "tracks": [f"track_{i}" for i in range(30)]}
    raw_payload = json.dumps(data_dict).encode("utf-8")
    compressed_payload = gzip.compress(raw_payload)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            headers={
                "content-type": "application/json",
                "content-encoding": "gzip",
                "content-length": str(len(compressed_payload)),
                "access-control-allow-origin": "*",
            },
            content=compressed_payload,
        )

    mock_transport = httpx.MockTransport(mock_handler)
    mock_proxy_client = httpx.AsyncClient(transport=mock_transport, follow_redirects=False)

    with patch("app.proxy.resolve_host_ips", return_value=("142.250.190.46",)), \
         patch("app.proxy.get_proxy_client", return_value=mock_proxy_client):
        response = client.get("/api/proxy?url=https://music.youtube.com/youtubei/v1/search")
        assert response.status_code == 200
        # Fully consume streamed body: verifies client didn't close prematurely and decompression succeeded
        body = response.json()
        assert body["status"] == "success"
        assert len(body["tracks"]) == 30
        # Content-Length must be stripped when content-encoding was present
        assert "content-length" not in response.headers


# ============================================================================
# STREAMER & VIDEO ID VALIDATION TESTS
# ============================================================================

def test_video_id_regex_validation(client):
    # Reject long-option CLI argument injection
    with pytest.raises(HTTPException) as exc1:
        validate_video_id("--help")
    assert exc1.value.status_code == 400

    # Reject directory traversal
    with pytest.raises(HTTPException) as exc2:
        validate_video_id("../etc")
    assert exc2.value.status_code == 400

    # Reject too short
    with pytest.raises(HTTPException) as exc3:
        validate_video_id("abc")
    assert exc3.value.status_code == 400

    # HTTP endpoint rejections
    res1 = client.post("/api/stream/--help/resolve")
    assert res1.status_code == 400

    res2 = client.post("/api/stream/invalid!chars/resolve")
    assert res2.status_code == 400

    res3 = client.post("/api/stream/short/resolve")
    assert res3.status_code == 400

    # Real YouTube Base64URL IDs: MUST accept valid IDs starting with '-' or '_'
    assert validate_video_id("-5q5mZbe3V8") == "-5q5mZbe3V8"
    assert validate_video_id("_Yhyp-_hX2s") == "_Yhyp-_hX2s"
    assert validate_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_range_header_parsing():
    assert parse_range_header("bytes=0-15", 100) == (0, 15)
    assert parse_range_header("bytes=10-", 100) == (10, 99)
    assert parse_range_header("bytes=-20", 100) == (80, 99)

    with pytest.raises(ValueError):
        parse_range_header("bytes=20-10", 100)
    with pytest.raises(ValueError):
        parse_range_header("bytes=150-200", 100)


@pytest.mark.asyncio
async def test_resolve_and_stream_range(client):
    test_id = "test_vid_123"
    fake_info = {
        "url": "https://googlevideo.com/videoplayback?id=123",
        "ext": "m4a",
        "acodec": "mp4a.40.2",
        "filesize": 1024,
        "duration": 180.0,
        "title": "Unit Test Track",
        "protocol": "https",
        "http_headers": {"User-Agent": "yt-agent"},
    }

    with patch("app.streamer._sync_extract_info", return_value=fake_info):
        # Test Resolve
        res_resolve = client.post(f"/api/stream/{test_id}/resolve")
        assert res_resolve.status_code == 200
        data = res_resolve.json()
        assert data["url"].endswith(f"/api/stream/{test_id}")
        assert data["mimeType"] == "audio/mp4"
        assert data["codec"] == "mp4a.40.2"
        assert data["size"] == 1024

        # Test Local File Range Serving
        os.makedirs(TMP_STREAM_DIR, exist_ok=True)
        local_path = os.path.join(TMP_STREAM_DIR, f"{test_id}.m4a")
        dummy_content = b"\x00\x00\x00\x18ftypM4A " + (b"\x00" * 48)
        with open(local_path, "wb") as f:
            f.write(dummy_content)

        cached_entry = StreamInfo(
            video_id=test_id,
            source_url="https://fake",
            http_headers={},
            mime_type="audio/mp4",
            codec="mp4a.40.2",
            filesize=len(dummy_content),
            duration=180.0,
            title="Unit Test Track",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=20),
            is_direct_standalone=False,
            local_file_path=local_path,
        )
        await stream_cache.put(f"{test_id}:m4a", cached_entry)

        # Range request: first 16 bytes
        res_stream = client.get(
            f"/api/stream/{test_id}",
            headers={"range": "bytes=0-15"},
        )
        assert res_stream.status_code == 206
        assert res_stream.headers["content-range"] == f"bytes 0-15/{len(dummy_content)}"
        assert res_stream.headers["content-length"] == "16"
        assert res_stream.headers["accept-ranges"] == "bytes"
        assert len(res_stream.content) == 16
        assert res_stream.content == dummy_content[:16]

        # Clean up
        if os.path.exists(local_path):
            os.remove(local_path)


def test_resolve_respects_x_forwarded_proto(client):
    test_id = "-5q5mZbe3V8"
    fake_info = {
        "url": "https://googlevideo.com/videoplayback?id=123",
        "ext": "m4a",
        "acodec": "mp4a.40.2",
        "filesize": 2048,
        "duration": 200.0,
        "title": "Leading Dash Track",
        "protocol": "https",
        "http_headers": {},
    }

    with patch("app.streamer._sync_extract_info", return_value=fake_info):
        response = client.post(
            f"/api/stream/{test_id}/resolve",
            headers={"x-forwarded-proto": "https"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["url"].startswith("https://")
        assert f"/api/stream/{test_id}" in data["url"]


def test_download_mp3_utf8_filename(client):
    test_id = "_Yhyp-_hX2s"
    os.makedirs(TMP_STREAM_DIR, exist_ok=True)
    mp3_target = os.path.join(TMP_STREAM_DIR, f"{test_id}.mp3")

    def mock_download(vid, out_path, title, artist):
        with open(out_path, "wb") as f:
            f.write(b"ID3\x04\x00\x00\x00\x00\x00#TPE1\x00\x00\x00\x07\x00\x00\x03YOASOBITIT2\x00\x00\x00\x06\x00\x00\x03Song")

    with patch("app.streamer._sync_download_mp3", side_effect=mock_download):
        # Non-ASCII UTF-8 title and artist
        response = client.get(
            f"/api/download/{test_id}.mp3?title=アイドル&artist=YOASOBI"
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        # Content-Disposition RFC 5987 encodes UTF-8 characters safely without latin-1 crash
        content_disp = response.headers["content-disposition"]
        assert "attachment" in content_disp
        assert "YOASOBI" in content_disp or urllib.parse.quote("YOASOBI") in content_disp
        assert response.content.startswith(b"ID3")
