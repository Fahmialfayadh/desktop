export interface InvidiousStreamResult {
  url: string;
  mimeType: string;
  codec: string;
  bitrate: number;
}

const INVIDIOUS_INSTANCES = [
  "https://yt.chocolatemoo53.com",
];

export async function resolveInvidiousAudioStream(
  videoId: string,
  signal?: AbortSignal,
): Promise<InvidiousStreamResult | null> {
  if (import.meta.env.MODE === "test") return null;

  const probe = async (instance: string): Promise<InvidiousStreamResult> => {
    const timeout = AbortSignal.timeout(2500);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch(
      `${instance}/api/v1/videos/${encodeURIComponent(videoId)}`,
      { signal: combined },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    const adaptiveFormats = Array.isArray(data.adaptiveFormats)
      ? data.adaptiveFormats
      : [];
    const audioFormats = adaptiveFormats.filter((f: any) =>
      Boolean(f && (f.type?.includes("audio") || f.mimeType?.includes("audio"))),
    );

    // Prefer opus (itag 251) or aac (itag 140)
    const best =
      audioFormats.find((f: any) => f.itag === 251 || f.itag === "251") ||
      audioFormats.find((f: any) => f.itag === 140 || f.itag === "140") ||
      audioFormats[0];

    if (best?.url) {
      const mimeType = best.type || best.mimeType || "audio/webm";
      const codec =
        mimeType.includes("mp4") || mimeType.includes("m4a")
          ? "mp4a.40.2"
          : "opus";
      return {
        url: best.url,
        mimeType,
        codec,
        bitrate: Number(best.bitrate) || 128_000,
      };
    }
    throw new Error("No usable audio format found");
  };

  try {
    return await Promise.any(INVIDIOUS_INSTANCES.map((inst) => probe(inst)));
  } catch {
    return null;
  }
}
