from typing import Optional
from fastapi import Request
import httpx

_fallback_proxy_client: Optional[httpx.AsyncClient] = None
_fallback_streamer_client: Optional[httpx.AsyncClient] = None


def get_proxy_client(request: Optional[Request] = None) -> httpx.AsyncClient:
    """Return shared proxy AsyncClient from app.state or fallback lazy singleton."""
    global _fallback_proxy_client
    if request is not None:
        client = getattr(request.app.state, "proxy_client", None)
        if client is not None and not client.is_closed:
            return client

    if _fallback_proxy_client is None or _fallback_proxy_client.is_closed:
        _fallback_proxy_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, read=120.0),
            follow_redirects=False,
        )
    return _fallback_proxy_client


def get_streamer_client(request: Optional[Request] = None) -> httpx.AsyncClient:
    """Return shared streamer AsyncClient from app.state or fallback lazy singleton."""
    global _fallback_streamer_client
    if request is not None:
        client = getattr(request.app.state, "streamer_client", None)
        if client is not None and not client.is_closed:
            return client

    if _fallback_streamer_client is None or _fallback_streamer_client.is_closed:
        _fallback_streamer_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, read=120.0),
            follow_redirects=True,
        )
    return _fallback_streamer_client


async def close_fallback_clients() -> None:
    """Close any fallback clients during app shutdown."""
    global _fallback_proxy_client, _fallback_streamer_client
    if _fallback_proxy_client is not None and not _fallback_proxy_client.is_closed:
        await _fallback_proxy_client.aclose()
        _fallback_proxy_client = None

    if _fallback_streamer_client is not None and not _fallback_streamer_client.is_closed:
        await _fallback_streamer_client.aclose()
        _fallback_streamer_client = None
