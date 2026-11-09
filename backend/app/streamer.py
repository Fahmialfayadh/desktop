import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
import re
import subprocess
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError

from app.clients import get_streamer_client
from app.config import (
    FFMPEG_PATH,
    STREAM_CACHE_MAX_ENTRIES,
    STREAM_CACHE_TTL_SECONDS,
    STREAM_TMP_MAX_BYTES,
    TMP_STREAM_DIR,
)
from app.proxy import filter_response_headers

router = APIRouter(prefix="/api", tags=["streamer"])

# Allow base64url chars (including single leading '-' or '_'), reject '--' long options
VIDEO_ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


@dataclass
class StreamInfo:
    video_id: str
    source_url: str
    http_headers: dict[str, str]
    mime_type: str
    codec: Optional[str]
    filesize: int
    duration: Optional[float]
    title: Optional[str]
    expires_at: datetime
    is_direct_standalone: bool
    local_file_path: Optional[str] = None


class StreamCache:
    """Thread-safe LRU cache with TTL for resolved stream metadata."""

    def __init__(self, ttl_seconds: int = STREAM_CACHE_TTL_SECONDS, max_entries: int = STREAM_CACHE_MAX_ENTRIES):
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._cache: OrderedDict[str, StreamInfo] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[StreamInfo]:
        async with self._lock:
            info = self._cache.get(key)
            if not info:
                return None
            if datetime.now(timezone.utc) >= info.expires_at:
                del self._cache[key]
                return None
            self._cache.move_to_end(key)
            return info

    async def put(self, key: str, info: StreamInfo) -> None:
        async with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = info
            while len(self._cache) > self._max_entries:
                self._cache.popitem(last=False)

    async def evict(self, key: str) -> None:
        async with self._lock:
            if key in self._cache:
                del self._cache[key]


stream_cache = StreamCache()


def validate_video_id(video_id: str) -> str:
    """Validate video_id strictly: 6-20 base64url chars, reject long-option CLI prefix ('--')."""
    if (
        not video_id
        or video_id.startswith("--")
        or not VIDEO_ID_REGEX.match(video_id)
    ):
        raise HTTPException(status_code=400, detail="Invalid video_id parameter")
    return video_id


def cleanup_temp_cache(directory: str = TMP_STREAM_DIR, max_bytes: int = STREAM_TMP_MAX_BYTES) -> None:
    """Perform LRU cleanup of /tmp/liner-stream-cache if size exceeds threshold."""
    if not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
        return

    entries = []
    total_size = 0
    try:
        for fname in os.listdir(directory):
            fpath = os.path.join(directory, fname)
            if os.path.isfile(fpath):
                stat = os.stat(fpath)
                entries.append((stat.st_mtime, stat.st_size, fpath))
                total_size += stat.st_size
    except Exception:
        return

    if total_size > max_bytes:
        # Oldest modification time first
        entries.sort(key=lambda x: x[0])
        target_size = int(max_bytes * 0.75)
        for _, size, fpath in entries:
            try:
                os.remove(fpath)
                total_size -= size
            except OSError:
                pass
            if total_size <= target_size:
                break


def sanitize_filename(name: str) -> str:
    """Sanitize filename to prevent directory traversal and header injection."""
    clean = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    clean = clean.replace("\r", "").replace("\n", "")
    return clean[:120] if clean else "audio"


def _sync_extract_info(video_id: str) -> dict:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "extract_flat": False,
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
        "cachedir": False,
        "js_runtimes": {"node": {}},
        "remote_components": ["ejs:github"],
        "extractor_args": {"youtube": {"player_client": ["tv_embedded", "web_embedded"]}},
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)


def _sync_transcode_to_file(
    source_url: str,
    output_path: str,
    http_headers: dict[str, str],
    target_format: str = "m4a",
) -> None:
    cleanup_temp_cache(TMP_STREAM_DIR)
    os.makedirs(TMP_STREAM_DIR, exist_ok=True)

    headers_str = "".join(f"{k}: {v}\r\n" for k, v in http_headers.items())
    cmd = [FFMPEG_PATH, "-y"]
    if headers_str:
        cmd.extend(["-headers", headers_str])
    cmd.extend(["-i", source_url, "-vn"])

    if target_format == "mp3":
        cmd.extend(["-c:a", "libmp3lame", "-q:a", "2"])
    else:
        cmd.extend(["-c:a", "aac", "-b:a", "192k"])

    cmd.append(output_path)
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def extract_video_stream(
    video_id: str,
    force_refresh: bool = False,
    requested_format: str = "m4a",
) -> StreamInfo:
    validate_video_id(video_id)
    cache_key = f"{video_id}:{requested_format}"

    if not force_refresh:
        cached = await stream_cache.get(cache_key)
        if cached:
            return cached

    try:
        info = await asyncio.to_thread(_sync_extract_info, video_id)
    except (DownloadError, ExtractorError) as exc:
        raise HTTPException(status_code=404, detail=f"Track {video_id} not found or unavailable: {exc}") from exc

    source_url = info.get("url") or ""
    http_headers = info.get("http_headers") or {}
    ext = (info.get("ext") or "").lower()
    acodec = info.get("acodec")
    filesize = info.get("filesize") or info.get("filesize_approx") or 0
    duration = info.get("duration")
    title = info.get("title")
    protocol = (info.get("protocol") or "").lower()

    # Determine if direct progressive standalone audio
    is_progressive_http = (
        protocol.startswith("http")
        and ".m3u8" not in source_url
        and "manifest" not in source_url
        and "dash" not in protocol
    )

    mime_type = "audio/mp4" if ext == "m4a" else ("audio/webm" if ext == "webm" else "audio/mpeg")
    codec = acodec or ("mp4a.40.2" if ext == "m4a" else "opus")
    local_file_path: Optional[str] = None
    is_direct_standalone = is_progressive_http and requested_format != "mp3"

    # Transcode if not direct progressive standalone or if mp3 format requested
    if not is_direct_standalone or requested_format == "mp3":
        os.makedirs(TMP_STREAM_DIR, exist_ok=True)
        out_ext = "mp3" if requested_format == "mp3" else "m4a"
        local_path = os.path.join(TMP_STREAM_DIR, f"{video_id}.{out_ext}")

        if not os.path.exists(local_path) or os.path.getsize(local_path) == 0:
            await asyncio.to_thread(
                _sync_transcode_to_file,
                source_url,
                local_path,
                http_headers,
                out_ext,
            )

        local_file_path = local_path
        filesize = os.path.getsize(local_path)
        mime_type = "audio/mpeg" if out_ext == "mp3" else "audio/mp4"
        codec = "mp3" if out_ext == "mp3" else "mp4a.40.2"
        is_direct_standalone = False

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=STREAM_CACHE_TTL_SECONDS)

    stream_info = StreamInfo(
        video_id=video_id,
        source_url=source_url,
        http_headers=http_headers,
        mime_type=mime_type,
        codec=codec,
        filesize=filesize,
        duration=duration,
        title=title,
        expires_at=expires_at,
        is_direct_standalone=is_direct_standalone,
        local_file_path=local_file_path,
    )

    await stream_cache.put(cache_key, stream_info)
    return stream_info


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    """Parse HTTP Range header string into (start, end) inclusive byte offsets."""
    if not range_header.startswith("bytes="):
        raise ValueError("Invalid range units")
    range_val = range_header[6:].strip()
    if "," in range_val:
        range_val = range_val.split(",")[0].strip()

    parts = range_val.split("-")
    if len(parts) != 2:
        raise ValueError("Invalid range format")

    start_str, end_str = parts[0].strip(), parts[1].strip()
    if not start_str and not end_str:
        raise ValueError("Empty range")

    if not start_str:
        suffix_length = int(end_str)
        start = max(0, file_size - suffix_length)
        end = file_size - 1
    elif not end_str:
        start = int(start_str)
        end = file_size - 1
    else:
        start = int(start_str)
        end = int(end_str)

    if start < 0 or start >= file_size or end < start:
        raise ValueError("Range not satisfiable")

    end = min(end, file_size - 1)
    return start, end


async def serve_file_with_range(
    file_path: str,
    mime_type: str,
    range_header: Optional[str],
    method: str = "GET",
) -> Response:
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    file_size = os.path.getsize(file_path)

    if not range_header:
        if method == "HEAD":
            return Response(
                status_code=200,
                headers={
                    "Content-Type": mime_type,
                    "Content-Length": str(file_size),
                    "Accept-Ranges": "bytes",
                },
            )

        def file_iterator():
            with open(file_path, "rb") as f:
                while chunk := f.read(64 * 1024):
                    yield chunk

        return StreamingResponse(
            file_iterator(),
            status_code=200,
            headers={
                "Content-Type": mime_type,
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
        )

    try:
        start, end = parse_range_header(range_header, file_size)
    except ValueError:
        return Response(
            status_code=416,
            headers={
                "Content-Range": f"bytes */{file_size}",
                "Accept-Ranges": "bytes",
            },
        )

    content_length = end - start + 1
    out_headers = {
        "Content-Type": mime_type,
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Content-Length": str(content_length),
        "Accept-Ranges": "bytes",
    }

    if method == "HEAD":
        return Response(status_code=206, headers=out_headers)

    def range_iterator():
        with open(file_path, "rb") as f:
            f.seek(start)
            bytes_left = content_length
            while bytes_left > 0:
                chunk_size = min(64 * 1024, bytes_left)
                data = f.read(chunk_size)
                if not data:
                    break
                bytes_left -= len(data)
                yield data

    return StreamingResponse(
        range_iterator(),
        status_code=206,
        headers=out_headers,
    )


async def proxy_upstream_stream(
    entry: StreamInfo,
    video_id: str,
    range_header: Optional[str],
    method: str = "GET",
    request: Optional[Request] = None,
) -> Response:
    headers = dict(entry.http_headers)
    if range_header:
        headers["Range"] = range_header

    client = get_streamer_client(request)
    req = client.build_request(method, entry.source_url, headers=headers)
    resp = await client.send(req, stream=True)

    # 403 recovery: evict cache and retry once
    if resp.status_code == 403:
        await resp.aclose()
        await stream_cache.evict(f"{video_id}:m4a")
        new_entry = await extract_video_stream(video_id, force_refresh=True)
        if new_entry.local_file_path:
            return await serve_file_with_range(
                new_entry.local_file_path, new_entry.mime_type, range_header, method
            )
        headers = dict(new_entry.http_headers)
        if range_header:
            headers["Range"] = range_header
        req = client.build_request(method, new_entry.source_url, headers=headers)
        resp = await client.send(req, stream=True)

    out_headers = filter_response_headers(resp.headers)
    out_headers["Accept-Ranges"] = "bytes"
    if not out_headers.get("Content-Type"):
        out_headers["Content-Type"] = entry.mime_type

    if method == "HEAD":
        await resp.aclose()
        return Response(status_code=resp.status_code, headers=out_headers)

    async def stream_generator():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(
        stream_generator(),
        status_code=resp.status_code,
        headers=out_headers,
    )


@router.post("/stream/{video_id}/resolve")
async def resolve_stream(
    video_id: str,
    request: Request,
    format: str = Query("m4a", pattern="^(m4a|mp3)$"),
) -> JSONResponse:
    validate_video_id(video_id)
    entry = await extract_video_stream(video_id, requested_format=format)

    base_url = str(request.base_url).rstrip("/")
    # Respect X-Forwarded-Proto for HTTPS reverse proxies
    if request.headers.get("x-forwarded-proto") == "https" and base_url.startswith("http://"):
        base_url = "https://" + base_url[len("http://") :]

    stream_url = f"{base_url}/api/stream/{video_id}"
    if format == "mp3":
        stream_url += "?format=mp3"

    response_payload = {
        "url": stream_url,
        "expiresAt": entry.expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mimeType": entry.mime_type,
        "codec": entry.codec,
        "size": entry.filesize,
    }
    return JSONResponse(content=response_payload)


@router.get("/stream/{video_id}")
async def get_stream(
    video_id: str,
    request: Request,
    format: str = Query("m4a", pattern="^(m4a|mp3)$"),
) -> Response:
    validate_video_id(video_id)
    entry = await extract_video_stream(video_id, requested_format=format)
    range_header = request.headers.get("range")

    if entry.local_file_path and os.path.exists(entry.local_file_path):
        return await serve_file_with_range(
            entry.local_file_path, entry.mime_type, range_header, method="GET"
        )
    return await proxy_upstream_stream(entry, video_id, range_header, method="GET", request=request)


@router.head("/stream/{video_id}")
async def head_stream(
    video_id: str,
    request: Request,
    format: str = Query("m4a", pattern="^(m4a|mp3)$"),
) -> Response:
    validate_video_id(video_id)
    entry = await extract_video_stream(video_id, requested_format=format)
    range_header = request.headers.get("range")

    if entry.local_file_path and os.path.exists(entry.local_file_path):
        return await serve_file_with_range(
            entry.local_file_path, entry.mime_type, range_header, method="HEAD"
        )
    return await proxy_upstream_stream(entry, video_id, range_header, method="HEAD", request=request)


def _sync_download_mp3(video_id: str, output_path: str, title: Optional[str], artist: Optional[str]) -> None:
    cleanup_temp_cache(TMP_STREAM_DIR)
    os.makedirs(TMP_STREAM_DIR, exist_ok=True)

    postprocessor_args = []
    if title:
        postprocessor_args.extend(["-metadata", f"title={title}"])
    if artist:
        postprocessor_args.extend(["-metadata", f"artist={artist}"])

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "bestaudio/best",
        "outtmpl": output_path.replace(".mp3", ".%(ext)s"),
        "js_runtimes": {"node": {}},
        "remote_components": ["ejs:github"],
        "extractor_args": {"youtube": {"player_client": ["tv_embedded", "web_embedded"]}},
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "cachedir": False,
    }
    if postprocessor_args:
        ydl_opts["postprocessor_args"] = postprocessor_args

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([f"https://www.youtube.com/watch?v={video_id}"])


def remove_file_safely(file_path: str) -> None:
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception:
        pass


@router.get("/download/{video_id}.mp3")
async def download_mp3(
    video_id: str,
    background_tasks: BackgroundTasks,
    title: Optional[str] = None,
    artist: Optional[str] = None,
) -> FileResponse:
    validate_video_id(video_id)
    os.makedirs(TMP_STREAM_DIR, exist_ok=True)

    mp3_path = os.path.join(TMP_STREAM_DIR, f"{video_id}.mp3")

    if not os.path.exists(mp3_path) or os.path.getsize(mp3_path) == 0:
        await asyncio.to_thread(_sync_download_mp3, video_id, mp3_path, title, artist)

    if not os.path.exists(mp3_path):
        raise HTTPException(status_code=500, detail="Failed to generate MP3 file")

    if artist and title:
        download_name = f"{sanitize_filename(artist)} - {sanitize_filename(title)}.mp3"
    elif title:
        download_name = f"{sanitize_filename(title)}.mp3"
    else:
        download_name = f"{video_id}.mp3"

    background_tasks.add_task(remove_file_safely, mp3_path)

    # Let Starlette's FileResponse construct proper RFC 5987 UTF-8 Content-Disposition
    return FileResponse(
        path=mp3_path,
        media_type="audio/mpeg",
        filename=download_name,
    )
