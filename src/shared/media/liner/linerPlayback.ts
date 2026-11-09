import { getStreamGatewayUrl } from "@/shared/api/baseUrl";
import { isAbortError } from "@/shared/utils/abort";
import { log } from "@/shared/utils/logger";

export interface LinerAudioStream {
  url: string;
  expiresAt: string;
  mimeType: string;
  codec?: string;
  size: number;
}

const REQUEST_TIMEOUT_MS = 8_000;
const GATEWAY_BACKOFF_MS = 5_000;

let pausedUntil = 0;

function pause(ms: number, reason: string): void {
  pausedUntil = Date.now() + ms;
  log(
    "yellow",
    "playback",
    `liner audio paused for ${Math.round(ms / 1000)}s: ${reason}`,
  );
}

// presigned audio stream url, or null so the caller falls back to youtube
export async function resolveLinerStream(
  videoId: string,
  signal?: AbortSignal,
): Promise<LinerAudioStream | null> {
  if (
    import.meta.env.MODE === "test" &&
    typeof globalThis.fetch === "function" &&
    !("mock" in globalThis.fetch)
  ) {
    return null;
  }
  if (Date.now() < pausedUntil) return null;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const gatewayUrl = getStreamGatewayUrl();
    const res = await fetch(
      `${gatewayUrl}/api/stream/${encodeURIComponent(videoId)}/resolve`,
      {
        method: "POST",
        signal: combinedSignal,
      },
    );

    if (res.ok) {
      return (await res.json()) as LinerAudioStream;
    }

    if (res.status === 404 || res.status < 500) {
      return null;
    }

    pause(GATEWAY_BACKOFF_MS, `gateway responded with ${res.status}`);
    return null;
  } catch (error) {
    if (isAbortError(error, signal) && signal?.aborted) throw error;
    log("yellow", "playback", `stream resolve failed for ${videoId}: ${String(error)}`);
    return null;
  }
}

export function markLinerStreamFailed(reason: string): void {
  pause(GATEWAY_BACKOFF_MS, `stream playback failed: ${reason}`);
}

export function resetLinerPlaybackPause(): void {
  pausedUntil = 0;
}
