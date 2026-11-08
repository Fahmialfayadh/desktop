import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env if present in root or backend directory
env_path = Path(__file__).resolve().parents[2] / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

PORT: int = int(os.getenv("PORT", "8787"))
HOST: str = os.getenv("HOST", "0.0.0.0")
TMP_STREAM_DIR: str = os.getenv("TMP_STREAM_DIR", "/tmp/liner-stream-cache")
CORS_ALLOW_ORIGINS: str = os.getenv("CORS_ALLOW_ORIGINS", "*")

STREAM_CACHE_TTL_SECONDS: int = int(os.getenv("STREAM_CACHE_TTL_SECONDS", "1200"))
STREAM_CACHE_MAX_ENTRIES: int = int(os.getenv("STREAM_CACHE_MAX_ENTRIES", "256"))
STREAM_TMP_MAX_BYTES: int = int(
    os.getenv("STREAM_TMP_MAX_BYTES", str(512 * 1024 * 1024))
)  # 512 MB
FFMPEG_PATH: str = os.getenv("FFMPEG_PATH", "/usr/bin/ffmpeg")

ALLOWED_DOMAINS: tuple[str, ...] = (
    "youtube.com",
    "music.youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "accounts.youtube.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "googleusercontent.com",
    "googleapis.com",
    "soundcloud.com",
    "sndcdn.com",
    "spotify.com",
    "spotify.link",
    "scdn.co",
    "spotifycdn.com",
    "deezer.com",
    "deezer.page.link",
    "dzcdn.net",
    "apple.com",
    "mzstatic.com",
    "lrclib.net",
)

DOMAIN_INJECTIONS: dict[str, tuple[str, str]] = {
    "youtube.com": ("https://music.youtube.com", "https://music.youtube.com/"),
    "googlevideo.com": ("https://music.youtube.com", "https://music.youtube.com/"),
    "soundcloud.com": ("https://soundcloud.com", "https://soundcloud.com/"),
    "sndcdn.com": ("https://soundcloud.com", "https://soundcloud.com/"),
    "spotify.com": ("https://open.spotify.com", "https://open.spotify.com/"),
    "apple.com": ("https://music.apple.com", "https://music.apple.com/"),
    "deezer.com": ("https://www.deezer.com", "https://www.deezer.com/"),
}
