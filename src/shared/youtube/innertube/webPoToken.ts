import { getStreamGatewayUrl } from "@/shared/api/baseUrl";
import { log } from "@/shared/utils/logger";
import { WEB_PROFILE } from "./innertubeClient";

const CHALLENGE_URL =
  "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false";
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const TOKEN_CACHE_MS = 6 * 60 * 60 * 1000;
const GATEWAY_MINT_TIMEOUT_MS = 3_000;
const GATEWAY_MINT_BACKOFF_MS = 2 * 60 * 1000;

export interface WebPoTokenResult {
  poToken: string;
  visitorData: string;
  ttlSecs: number;
}

interface CachedToken {
  result: WebPoTokenResult;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const inflightTokens = new Map<string, Promise<WebPoTokenResult>>();
let mintChain: Promise<unknown> = Promise.resolve();
let gatewayMintUnavailableUntil = 0;

export function canMintWebPoToken(): boolean {
  return typeof window !== "undefined";
}

function enqueueMint<T>(run: () => Promise<T>): Promise<T> {
  const next = mintChain.then(run, run);
  mintChain = next.then(() => undefined, () => undefined);
  return next;
}

function cacheToken(videoId: string, result: WebPoTokenResult): void {
  tokenCache.set(videoId, {
    result,
    expiresAt: Date.now() + Math.min(result.ttlSecs * 1000, TOKEN_CACHE_MS),
  });
}

async function fetchGatewayToken(
  videoId: string,
  signal?: AbortSignal,
): Promise<WebPoTokenResult> {
  const response = await fetch(
    `${getStreamGatewayUrl()}/api/youtube/potoken?videoId=${encodeURIComponent(
      videoId,
    )}`,
    {
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(GATEWAY_MINT_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(GATEWAY_MINT_TIMEOUT_MS),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`gateway PO token failed with HTTP ${response.status}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  const poToken = typeof data.poToken === "string" ? data.poToken : "";
  if (!poToken) throw new Error("gateway PO token response was empty");
  return {
    poToken,
    visitorData:
      typeof data.visitorData === "string" ? data.visitorData : "",
    ttlSecs: Number(data.ttlSecs) || 43_200,
  };
}

async function mintToken(videoId: string, signal?: AbortSignal) {
  const result = await fetchGatewayToken(videoId, signal);
  cacheToken(videoId, result);
  return result;
}

export async function getWebPoToken(
  videoId: string,
  signal?: AbortSignal,
): Promise<WebPoTokenResult> {
  const cached = tokenCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const existing = inflightTokens.get(videoId);
  if (existing) return existing;

  const promise = enqueueMint(() => mintToken(videoId, signal));
  inflightTokens.set(videoId, promise);
  promise
    .catch((error) => {
      if (signal?.aborted) return;
      gatewayMintUnavailableUntil = Date.now() + GATEWAY_MINT_BACKOFF_MS;
      log(
        "yellow",
        "playback",
        `PO token mint failed for ${videoId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    })
    .finally(() => {
      if (inflightTokens.get(videoId) === promise) {
        inflightTokens.delete(videoId);
      }
    });
  return promise;
}

export function clearWebPoTokenCache(): void {
  tokenCache.clear();
  inflightTokens.clear();
  gatewayMintUnavailableUntil = 0;
}
