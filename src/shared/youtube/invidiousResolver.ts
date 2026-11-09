export interface InvidiousStreamResult {
  url: string;
  mimeType: string;
  codec: string;
  bitrate: number;
}

const INVIDIOUS_INSTANCES = [
  "https://yt.chocolatemoo53.com",
];

function probeAudioInBrowser(url: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Audio === "undefined") {
      resolve(true);
      return;
    }
    const audio = new Audio();
    audio.preload = "metadata";
    let settled = false;

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, 2500);

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("canplay", onLoaded);
      audio.removeEventListener("error", onError);
      try {
        audio.src = "";
        audio.load();
      } catch {}
    }

    function onLoaded() {
      cleanup();
      resolve(true);
    }

    function onError() {
      cleanup();
      resolve(false);
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    audio.addEventListener("canplay", onLoaded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.src = url;
  });
}

export async function resolveInvidiousAudioStream(
  videoId: string,
  signal?: AbortSignal,
): Promise<InvidiousStreamResult | null> {
  if (import.meta.env.MODE === "test") return null;

  const probe = async (instance: string): Promise<InvidiousStreamResult> => {
    const timeout = AbortSignal.timeout(3500);
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

      // In browser, verify stream reachability natively via audio element
      if (typeof window !== "undefined" && !(window as any).linerElectron) {
        const playable = await probeAudioInBrowser(best.url, combined);
        if (!playable) {
          throw new Error("stream not playable by browser audio element");
        }
      } else {
        try {
          const probeRes = await fetch(best.url, {
            method: "HEAD",
            signal: combined,
          });
          if (!probeRes.ok) {
            throw new Error(`stream returned HTTP ${probeRes.status}`);
          }
        } catch (probeErr) {
          if (combined.aborted) throw probeErr;
          throw new Error(`stream probe failed: ${String(probeErr)}`);
        }
      }

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
