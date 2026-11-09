import { runWorkerPool } from "@/shared/utils/workerPool";

export interface AudioDownloadOptions {
  contentLength?: number;
  signal?: AbortSignal;
  chunkSize?: number;
  concurrency?: number;
}

const DEFAULT_CHUNK_SIZE = 512 * 1024;
const DEFAULT_CONCURRENCY = 6;
const MAX_CHUNK_ATTEMPTS = 2;

export function isGoogleVideoUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".googlevideo.com");
  } catch {
    return false;
  }
}

export function supportsChunkedDownload(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".googlevideo.com")) return true;
    if (
      host.includes("gateway") ||
      parsed.pathname.includes("/api/stream") ||
      parsed.pathname.includes("/api/proxy")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function withRange(url: string, start: number, end: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set("range", `${start}-${end}`);
  return parsed.toString();
}

async function fetchChunk(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const expected = end - start + 1;
  const chunkUrl = withRange(url, start, end);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(chunkUrl, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        signal,
      });
      if (!response.ok && response.status !== 206)
        throw new Error(
          `chunk ${start}-${end} returned HTTP ${response.status}`,
        );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== expected) {
        if (bytes.byteLength > expected && start === 0) {
          return bytes.subarray(0, expected);
        }
        throw new Error(
          `chunk ${start}-${end} returned ${bytes.byteLength} of ${expected} bytes`,
        );
      }
      return bytes;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function downloadInChunks(
  url: string,
  total: number,
  options: AudioDownloadOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const starts = Array.from(
    { length: Math.ceil(total / chunkSize) },
    (_, index) => index * chunkSize,
  );
  const output = new Uint8Array(total);
  await runWorkerPool(
    starts,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (start) => {
      const end = Math.min(start + chunkSize, total) - 1;
      output.set(await fetchChunk(url, start, end, options.signal), start);
    },
  );
  return output;
}

async function downloadWhole(
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const response = await fetch(url, { signal });
  if (!response.ok && response.status !== 206) return null;
  const totalBytes = Number(
    /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1],
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isFinite(totalBytes) && bytes.byteLength < totalBytes) return null;
  return bytes;
}

export async function downloadAudioBytes(
  url: string,
  options: AudioDownloadOptions = {},
): Promise<Uint8Array<ArrayBuffer> | null> {
  const total = options.contentLength;
  const isChunkable = isGoogleVideoUrl(url) || supportsChunkedDownload(url);

  const bytes =
    total && total > 0 && isChunkable
      ? await downloadInChunks(url, total, options)
      : await downloadWhole(url, options.signal);
  return bytes && bytes.byteLength > 0 ? bytes : null;
}
