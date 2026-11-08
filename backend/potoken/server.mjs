import http from "node:http";
import { mintPoToken } from "./minter.mjs";

const PORT = Number(process.env.POTOKEN_PORT || 4416);
const HOST = process.env.POTOKEN_HOST || "127.0.0.1";
const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{6,20}$/;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/potoken") {
    const videoId = url.searchParams.get("videoId") || "";
    if (!VIDEO_ID_REGEX.test(videoId)) {
      sendJson(res, 400, { detail: "Invalid videoId" });
      return;
    }
    try {
      const result = await mintPoToken(videoId);
      sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[potoken] mint failed for ${videoId}: ${message}`);
      sendJson(res, 503, { detail: message });
    }
    return;
  }

  sendJson(res, 404, { detail: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[potoken] listening on http://${HOST}:${PORT}`);
});
