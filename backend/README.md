# Liner Web Gateway

Lightweight Personal Audio Stream and CORS Gateway service for Liner Desktop.

## Features

1. CORS Proxy (`/api/proxy`):
   - Strict domain allowlist matching official media providers (YouTube, SoundCloud, Spotify, Apple Music, Deezer, etc.).
   - Anti-SSRF protection: rejects non-HTTPS URLs, credentials in URL, literal IP addresses, and DNS hostnames resolving to private, loopback, link-local, multicast, or reserved networks.
   - Header rewriting: forwards essential headers, preserves client `Range`, injects domain-specific `Origin` and `Referer`, and translates `x-liner-user-agent` to upstream `User-Agent`.
   - Full redirect inspection: validates every redirect target against SSRF and domain restrictions before following.

2. On-Demand Audio Streamer (`/api/stream/{video_id}`):
   - Strict `video_id` regex validation (`^[A-Za-z0-9_-]{6,20}$`) preventing argument and path injection.
   - Fast metadata resolution with in-memory TTL cache (20 minutes).
   - Audio extraction prioritizing progressive standalone containers (M4A with `ftyp`, WebM).
   - Dynamic FFmpeg remuxing/transcoding into `/tmp/liner-stream-cache` for fragmented or HLS streams, ensuring full compatibility with client standalone audio detectors.
   - Full HTTP 206 Partial Content range support for both upstream streams and local transcoded files.
   - Automatic 403 recovery: flushes expired upstream URLs and re-extracts automatically.

3. Direct MP3 Download (`/api/download/{video_id}.mp3`):
   - Standalone MP3 conversion using `libmp3lame`.
   - ID3 tag injection for track title and artist.
   - Sanitized filenames and automatic background cleanup of temporary files.

4. Bounded Storage:
   - All audio cache and conversion files reside in `/tmp/liner-stream-cache`.
   - Automatic LRU cleanup caps temporary cache at 512 MB.

## Environment Variables

Configured via root `.env` or system environment:

- `PORT`: Gateway HTTP port (default: `8787`).
- `HOST`: Gateway listen host (default: `0.0.0.0`).
- `TMP_STREAM_DIR`: Temporary cache directory (default: `/tmp/liner-stream-cache`).
- `CORS_ALLOW_ORIGINS`: Allowed origins (default: `*`).
- `STREAM_CACHE_TTL_SECONDS`: In-memory metadata TTL (default: `1200` seconds / 20 minutes).
- `STREAM_TMP_MAX_BYTES`: Maximum cache size in /tmp (default: `536870912` bytes / 512 MB).
- `FFMPEG_PATH`: Path to ffmpeg binary (default: `/usr/bin/ffmpeg`).

## Installation and Execution with uv

Create virtual environment and install lightweight dependencies:

```bash
uv venv /home/data/kuliah/project/desktop/backend/.venv
uv pip install --python /home/data/kuliah/project/desktop/backend/.venv/bin/python \
  fastapi uvicorn yt-dlp httpx pydantic python-dotenv pytest pytest-asyncio
```

Run tests:

```bash
/home/data/kuliah/project/desktop/backend/.venv/bin/pytest -v
```

Start the service:

```bash
/home/data/kuliah/project/desktop/backend/.venv/bin/python -m app.main
```
