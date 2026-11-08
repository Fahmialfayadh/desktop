import re

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/youtube", tags=["potoken"])

VIDEO_ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
POTOKEN_SERVER_URL = "http://127.0.0.1:4416"
POTOKEN_TIMEOUT = httpx.Timeout(40.0, connect=2.0)


@router.get("/potoken")
async def get_potoken(video_id: str = Query(alias="videoId")) -> JSONResponse:
    """Mint a content-bound PO token on the gateway's egress IP."""
    if not VIDEO_ID_REGEX.match(video_id):
        raise HTTPException(status_code=400, detail="Invalid videoId")

    try:
        async with httpx.AsyncClient(timeout=POTOKEN_TIMEOUT) as client:
            response = await client.get(
                f"{POTOKEN_SERVER_URL}/potoken",
                params={"videoId": video_id},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail="PO token service is unavailable",
        ) from exc

    if response.status_code != 200:
        detail = "PO token mint failed"
        try:
            body = response.json()
            if isinstance(body.get("detail"), str):
                detail = body["detail"]
        except ValueError:
            pass
        raise HTTPException(status_code=503, detail=detail)

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail="PO token service returned invalid JSON",
        ) from exc

    return JSONResponse(payload)
