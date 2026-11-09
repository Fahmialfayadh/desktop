from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn

from app.clients import close_fallback_clients, ipv4_transport
from app.config import CORS_ALLOW_ORIGINS, HOST, PORT
from app.proxy import router as proxy_router
from app.potoken import router as potoken_router
from app.streamer import router as streamer_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize shared HTTP clients on app.state
    proxy_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, read=120.0),
        follow_redirects=False,
        transport=ipv4_transport(),
    )
    streamer_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, read=120.0),
        follow_redirects=True,
        transport=ipv4_transport(),
    )
    app.state.proxy_client = proxy_client
    app.state.streamer_client = streamer_client
    try:
        yield
    finally:
        # Shutdown: close shared and fallback clients
        await proxy_client.aclose()
        await streamer_client.aclose()
        await close_fallback_clients()


app = FastAPI(
    title="Liner Audio Stream & CORS Gateway",
    description="Personal Audio Stream and CORS Gateway for Liner Desktop",
    version="0.1.3",
    lifespan=lifespan,
)

# Parse CORS origins
if CORS_ALLOW_ORIGINS.strip() == "*":
    origins = ["*"]
else:
    origins = [orig.strip() for orig in CORS_ALLOW_ORIGINS.split(",") if orig.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Range",
        "Accept-Ranges",
        "Content-Length",
        "Content-Type",
        "Content-Disposition",
        "ETag",
    ],
)

app.include_router(proxy_router)
app.include_router(potoken_router)
app.include_router(streamer_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "liner-web-gateway"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
