import asyncio
import ipaddress
import socket
import time
import urllib.parse
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from starlette.datastructures import Headers
import httpx

from app.clients import get_proxy_client
from app.config import ALLOWED_DOMAINS, DOMAIN_INJECTIONS

router = APIRouter(prefix="/api/proxy", tags=["proxy"])

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)

FORWARDED_HEADER_NAMES = {
    "accept",
    "accept-language",
    "content-type",
    "authorization",
    "range",
    "x-goog-visitor-id",
    "x-goog-authuser",
    "x-goog-api-key",
    "x-goog-po-token",
    "x-origin",
    "x-user-agent",
    "x-youtube-client-name",
    "x-youtube-client-version",
    "client-token",
}

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
}


DNS_CACHE_TTL_SECONDS = 300
_dns_cache: dict[str, tuple[float, tuple[str, ...]]] = {}
_dns_locks: dict[str, asyncio.Lock] = {}


async def resolve_host_ips(hostname: str) -> tuple[str, ...]:
    """Resolve a hostname without blocking the event loop, caching the result briefly."""
    now = time.monotonic()
    cached = _dns_cache.get(hostname)
    if cached and cached[0] > now:
        return cached[1]

    lock = _dns_locks.setdefault(hostname, asyncio.Lock())
    async with lock:
        cached = _dns_cache.get(hostname)
        if cached and cached[0] > now:
            return cached[1]
        loop = asyncio.get_running_loop()
        addr_info = await loop.getaddrinfo(
            hostname, 443, proto=socket.IPPROTO_TCP
        )
        ips = tuple(dict.fromkeys(sockaddr[0] for *_, sockaddr in addr_info))
        _dns_cache[hostname] = (now + DNS_CACHE_TTL_SECONDS, ips)
        return ips


async def validate_and_check_ssrf(url_str: str) -> urllib.parse.SplitResult:
    """Validate target URL strictly: https only, domain allowlist, no literal IP, anti-SSRF."""
    if not url_str:
        raise HTTPException(status_code=400, detail="Missing target URL")

    try:
        parsed = urllib.parse.urlsplit(url_str)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Malformed target URL") from exc

    if parsed.scheme.lower() != "https":
        raise HTTPException(status_code=403, detail="Only https URLs are permitted")

    if parsed.username or parsed.password:
        raise HTTPException(status_code=403, detail="Credentials in URL are forbidden")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise HTTPException(status_code=400, detail="Hostname cannot be empty")

    # Domain allowlist check
    allowed = False
    for allowed_domain in ALLOWED_DOMAINS:
        if hostname == allowed_domain or hostname.endswith("." + allowed_domain):
            allowed = True
            break

    if not allowed:
        raise HTTPException(status_code=403, detail=f"Domain '{hostname}' is not allowlisted")

    # Reject literal IP addresses
    try:
        ipaddress.ip_address(hostname)
        raise HTTPException(status_code=403, detail="Literal IP addresses are forbidden")
    except ValueError:
        pass

    # Resolve hostname to check for internal/private addresses
    try:
        ips = await resolve_host_ips(hostname)
    except socket.gaierror as exc:
        raise HTTPException(status_code=403, detail=f"Failed to resolve host '{hostname}'") from exc

    for ip_str in ips:
        try:
            ip = ipaddress.ip_address(ip_str)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
                or ip.is_unspecified
            ):
                raise HTTPException(
                    status_code=403,
                    detail=f"Target resolves to prohibited network address: {ip_str}",
                )
        except ValueError:
            raise HTTPException(status_code=403, detail="Invalid resolved IP address")

    return parsed


def prepare_upstream_headers(target_url: str, incoming_headers: Headers) -> dict[str, str]:
    headers: dict[str, str] = {}

    # User-Agent handling
    liner_ua = incoming_headers.get("x-liner-user-agent")
    if liner_ua:
        headers["User-Agent"] = liner_ua
    elif incoming_headers.get("user-agent"):
        headers["User-Agent"] = incoming_headers["user-agent"]
    else:
        headers["User-Agent"] = DEFAULT_USER_AGENT

    # Forward whitelisted headers
    for key, val in incoming_headers.items():
        if key.lower() in FORWARDED_HEADER_NAMES:
            headers[key] = val

    # Domain-specific Origin & Referer injection
    parsed = urllib.parse.urlsplit(target_url)
    hostname = (parsed.hostname or "").lower()

    # Do not inject browser origin/referer if caller is emulating a native mobile client
    is_mobile_client = (
        incoming_headers.get("x-youtube-client-name") in ("3", "5")
        or "android" in (liner_ua or "").lower()
    )

    if not is_mobile_client:
        # If incoming client already specified x-origin (e.g. YouTube TV client), respect it
        custom_origin = incoming_headers.get("x-origin")
        if custom_origin and ("youtube.com" in hostname):
            headers["Origin"] = custom_origin
            headers["Referer"] = f"{custom_origin}/"
        else:
            for domain, (origin, referer) in DOMAIN_INJECTIONS.items():
                if hostname == domain or hostname.endswith("." + domain):
                    headers["Origin"] = origin
                    headers["Referer"] = referer
                    break

    return headers


def filter_response_headers(upstream_headers: httpx.Headers) -> dict[str, str]:
    """Filter upstream response headers and handle content-encoding/content-length alignment."""
    filtered: dict[str, str] = {}
    has_content_encoding = "content-encoding" in upstream_headers

    for key, val in upstream_headers.items():
        lower_key = key.lower()
        if lower_key.startswith("access-control-"):
            continue
        if lower_key in HOP_BY_HOP_HEADERS:
            continue
        # Strip content-length when content was encoded/compressed because httpx decompresses the stream
        if has_content_encoding and lower_key == "content-length":
            continue
        filtered[key] = val

    return filtered


async def execute_proxy_request(
    request: Request,
    url: str,
    method: str,
) -> Response:
    current_url = url
    redirect_count = 0
    max_redirects = 5
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None
    client = get_proxy_client(request)

    while True:
        await validate_and_check_ssrf(current_url)
        upstream_headers = prepare_upstream_headers(current_url, request.headers)

        req = client.build_request(
            method,
            current_url,
            headers=upstream_headers,
            content=body,
        )
        resp = await client.send(req, stream=True)

        if resp.is_redirect and "location" in resp.headers:
            redirect_count += 1
            if redirect_count > max_redirects:
                await resp.aclose()
                raise HTTPException(status_code=502, detail="Exceeded maximum redirect hops")
            next_url = urllib.parse.urljoin(current_url, resp.headers["location"])
            await resp.aclose()
            current_url = next_url
            continue

        # Non-redirect response reached
        out_headers = filter_response_headers(resp.headers)

        if method == "HEAD":
            await resp.aclose()
            return Response(status_code=resp.status_code, headers=out_headers)

        # Content-length must not be sent on streaming response because httpx decompresses the stream
        # and Starlette manages chunked transport encoding.
        out_headers.pop("content-length", None)

        async def body_stream() -> AsyncGenerator[bytes, None]:
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()

        return StreamingResponse(
            body_stream(),
            status_code=resp.status_code,
            headers=out_headers,
        )


@router.get("")
async def proxy_get(url: str, request: Request) -> Response:
    return await execute_proxy_request(request, url, "GET")


@router.post("")
async def proxy_post(url: str, request: Request) -> Response:
    return await execute_proxy_request(request, url, "POST")


@router.head("")
async def proxy_head(url: str, request: Request) -> Response:
    return await execute_proxy_request(request, url, "HEAD")
