import type {
  LyricsCandidate,
  LyricsSearchResult,
  LyricsStreamEvent,
} from "@/shared/contracts/lyrics";
import { linerDb } from "@/shared/storage";
import { clientCatalog } from "./clientCatalog";

interface LyricsHint {
  title: string;
  artist: string;
  durationMs?: number;
}

const LRCLIB_BASE = "https://lrclib.net/api";
const TIMEOUT_MS = 8000;

function mapLrclibToCandidate(item: any): (LyricsCandidate & { format: "lrc" | "plain" }) | null {
  if (!item) return null;
  const isSynced =
    typeof item.syncedLyrics === "string" && item.syncedLyrics.trim().length > 0;
  const isPlain =
    typeof item.plainLyrics === "string" && item.plainLyrics.trim().length > 0;

  if (!isSynced && !isPlain) return null;

  const title = item.trackName || item.name || "";
  const artist = item.artistName || "";
  const durationMs = item.duration ? Math.round(item.duration * 1000) : undefined;

  if (isSynced) {
    return {
      format: "lrc",
      matchedTrack: {
        title,
        artists: artist ? [artist] : undefined,
        durationMs,
      },
      lyrics: {
        format: "lrc",
        content: item.syncedLyrics,
      },
      syncHint: "line_synced",
      provider: "lrclib",
      contentKind: "line_synced",
      syncLevel: "line_level",
      quality: {
        total: 90,
        match: 90,
        content: 90,
        sync: 90,
        source: 90,
        reasons: ["lrclib_synced"],
      },
    };
  }

  return {
    format: "plain",
    matchedTrack: {
      title,
      artists: artist ? [artist] : undefined,
      durationMs,
    },
    lyrics: {
      format: "plain",
      content: item.plainLyrics,
    },
    syncHint: "plain",
    provider: "lrclib",
    contentKind: "plain",
    syncLevel: "plain",
    quality: {
      total: 65,
      match: 80,
      content: 70,
      sync: 30,
      source: 80,
      reasons: ["lrclib_plain"],
    },
  };
}

async function fetchLrclibData(
  hint: LyricsHint,
  signal?: AbortSignal,
): Promise<any | null> {
  const title = hint.title.trim();
  const artist = hint.artist.trim();
  const durationSec = hint.durationMs && hint.durationMs > 0
    ? Math.round(hint.durationMs / 1000)
    : undefined;

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // 1. Try exact match /api/get if title and artist are present
  if (title && artist) {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (durationSec) {
      params.set("duration", String(durationSec));
    }
    try {
      const res = await fetch(`${LRCLIB_BASE}/get?${params.toString()}`, {
        signal: combinedSignal,
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
  }

  // 2. Fallback to /api/search?q=
  const query = [title, artist].filter(Boolean).join(" ");
  if (query) {
    const searchParams = new URLSearchParams({ q: query });
    try {
      const res = await fetch(`${LRCLIB_BASE}/search?${searchParams.toString()}`, {
        signal: combinedSignal,
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          // Prefer item with syncedLyrics
          const withSynced = list.find(
            (item: any) => typeof item.syncedLyrics === "string" && item.syncedLyrics.trim().length > 0,
          );
          if (withSynced) return withSynced;
          const withPlain = list.find(
            (item: any) => typeof item.plainLyrics === "string" && item.plainLyrics.trim().length > 0,
          );
          if (withPlain) return withPlain;
          return list[0];
        }
      }
    } catch {}
  }

  return null;
}

export async function searchLyricsWithLrclib(
  hint: LyricsHint,
  signal?: AbortSignal,
): Promise<LyricsSearchResult | null> {
  try {
    const data = await fetchLrclibData(hint, signal);
    if (!data) return null;
    const candidate = mapLrclibToCandidate(data);
    if (!candidate) return null;
    return {
      provider: "lrclib",
      cached: false,
      candidate,
    };
  } catch {
    return null;
  }
}

export async function* streamLyricsWithLrclib(
  id: string,
  signal?: AbortSignal,
  hint?: LyricsHint,
): AsyncGenerator<LyricsStreamEvent> {
  const start = performance.now();
  let resolvedHint = hint;

  // If hint is missing or incomplete, resolve track from cache or catalog
  if (!resolvedHint || !resolvedHint.title) {
    try {
      const cached = await linerDb.getTrack(id).catch(() => null);
      if (cached) {
        resolvedHint = {
          title: cached.title,
          artist: Array.isArray(cached.artists)
            ? cached.artists.map((a: any) => (typeof a === "string" ? a : a.name)).join(", ")
            : typeof cached.artists === "string"
              ? cached.artists
              : "",
          durationMs: cached.durationMs,
        };
      } else {
        const snapshot = await clientCatalog.resolveSnapshot(id).catch(() => null);
        if (snapshot) {
          resolvedHint = {
            title: snapshot.title,
            artist: Array.isArray(snapshot.artists)
              ? snapshot.artists.map((a: any) => (typeof a === "string" ? a : a.name)).join(", ")
              : typeof snapshot.artists === "string"
                ? snapshot.artists
                : "",
            durationMs: snapshot.durationMs,
          };
        }
      }
    } catch {}
  }

  if (resolvedHint?.title) {
    const artistName = resolvedHint.artist || "Unknown Artist";
    yield {
      type: "metadata",
      track: {
        id,
        title: resolvedHint.title,
        artists: [{ id: "artist_0", name: artistName }],
        durationMs: resolvedHint.durationMs || 0,
      },
    };
  }

  if (!resolvedHint || !resolvedHint.title) {
    yield {
      type: "provider",
      provider: "lrclib",
      status: "not_found",
      durationMs: Math.round(performance.now() - start),
    };
    yield {
      type: "done",
      cached: false,
      status: "not_found",
    };
    return;
  }

  let data: any = null;
  try {
    data = await fetchLrclibData(resolvedHint, signal);
  } catch {}

  const durationMs = Math.round(performance.now() - start);

  if (data && data.instrumental) {
    yield {
      type: "provider",
      provider: "lrclib",
      status: "not_found",
      instrumental: true,
      durationMs,
    };
    yield {
      type: "done",
      cached: false,
      status: "not_found",
      instrumental: true,
    };
    return;
  }

  const candidate = mapLrclibToCandidate(data);
  if (candidate) {
    yield {
      type: "provider",
      provider: "lrclib",
      status: "found",
      syncLevel: candidate.syncLevel,
      candidate,
      durationMs,
    };
    yield {
      type: "done",
      cached: false,
      best: {
        provider: "lrclib",
        quality: candidate.quality.total,
        syncLevel: candidate.syncLevel,
      },
    };
    return;
  }

  yield {
    type: "provider",
    provider: "lrclib",
    status: "not_found",
    durationMs,
  };
  yield {
    type: "done",
    cached: false,
    status: "not_found",
  };
}
