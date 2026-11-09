import {
  isYoutubeSignedIn,
  prefersAccountPlayback,
  resolveDirectAudioStream,
  openTvAudioStream,
  resolveTvAudioStream,
  toVideoId,
} from "@/shared/youtube";
import { resolveInvidiousAudioStream } from "@/shared/youtube/invidiousResolver";
import {
  isOfflineMode,
  OFFLINE_UNAVAILABLE_MESSAGE,
} from "@/features/connectivity/store/offlineModeStore";
import {
  resolveSoundCloudStream,
  searchSoundCloudTracks,
  toSoundCloudTrackId,
} from "@/shared/media/soundcloud";
import { resolveLinerStream } from "@/shared/media/liner/linerPlayback";
import { isLocalTrackId, localTrackAudioUrl } from "@/shared/media/local";
import { savedAudioUrl, savedTrackRecord } from "@/shared/media/saved";
import { isAbortError } from "@/shared/utils/abort";
import { log } from "@/shared/utils/logger";
import { rememberStreamOrigin } from "./nowPlayingLog";
import {
  fromInnertubeStream,
  fromLinerStream,
  fromSoundCloudStream,
  fromTvProgressiveStream,
  fromTvStream,
  type PlayableTrack,
  type PlaybackStream,
} from "./playbackStream";
import { findYoutubeStandIn } from "./youtubeStandIn";
import { findExactSongVersion } from "./exactSongVersion";
import { appAllowsAccountPlayback } from "./accountPlayback";
import { buildSourceProfile } from "@/shared/media/matching/sourceProfile";
import { rankCandidate } from "@/shared/media/matching/rankCandidate";
import type { ImportedTrack } from "@/shared/contracts";

export interface ResolveStreamOptions {
  progressive?: boolean;
}

export type {
  BufferedPlaybackStream,
  PlayableTrack,
  PlaybackStream,
  UrlPlaybackStream,
} from "./playbackStream";

function isRealWebRuntime(): boolean {
  return (
    import.meta.env.MODE !== "test" &&
    typeof window !== "undefined" &&
    !(window as any).linerElectron
  );
}

async function resolveTvAudio(
  videoId: string,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  if (progressive)
    return fromTvProgressiveStream(
      await openTvAudioStream(videoId, { signal }),
    );
  return fromTvStream(await resolveTvAudioStream(videoId, { signal }));
}

async function resolveYoutubeAudio(
  videoId: string,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  if (
    isYoutubeSignedIn() &&
    prefersAccountPlayback() &&
    (await appAllowsAccountPlayback())
  ) {
    try {
      const stream = await resolveTvAudio(videoId, progressive, signal);
      log("cyan", "playback", `resolved youtube tv audio for ${videoId}`);
      return stream;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      log("yellow", "playback", `youtube tv playback failed: ${String(error)}`);
    }
  }
  return fromInnertubeStream(
    await resolveDirectAudioStream(videoId, { signal }),
  );
}

async function resolveSoundCloudFallback(
  track: PlayableTrack,
  signal?: AbortSignal,
): Promise<PlaybackStream | null> {
  try {
    const artist = track.artists?.trim() || "";
    const query = artist ? `${track.title} ${artist}` : track.title;
    const hits = await searchSoundCloudTracks(query, signal);
    if (!hits.length) return null;

    const source: ImportedTrack = {
      sourceId: track.id,
      title: track.title,
      artists: artist
        ? artist
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      ...(track.durationMs > 0 ? { durationMs: track.durationMs } : {}),
    };

    const profile = buildSourceProfile(source);
    const rankedHits = hits
      .map((hit) => ({
        hit,
        ranked: rankCandidate(profile, hit.track),
      }))
      .filter(({ ranked }) => !ranked.isDisqualified && ranked.versionMatches)
      .sort((a, b) => b.ranked.score - a.ranked.score);

    for (const { hit } of rankedHits.slice(0, 8)) {
      try {
        const scStream = fromSoundCloudStream(
          await resolveSoundCloudStream(hit.track.id, { signal }),
        );
        scStream.standIn = true;
        log(
          "cyan",
          "playback",
          `resolved soundcloud fallback ${hit.track.id} for "${track.title}"`,
        );
        return scStream;
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
        log(
          "yellow",
          "playback",
          `soundcloud hit ${hit.track.id} failed, trying next hit: ${String(err)}`,
        );
      }
    }
  } catch (scErr) {
    if (isAbortError(scErr, signal)) throw scErr;
  }
  return null;
}

async function resolveYoutubeStandIn(
  track: PlayableTrack,
  progressive: boolean,
  signal?: AbortSignal,
  excludeVideoId?: string,
): Promise<PlaybackStream> {
  const videoId = await findYoutubeStandIn(track, signal, excludeVideoId);
  if (!videoId || videoId === excludeVideoId) {
    const scStream = await resolveSoundCloudFallback(track, signal);
    if (scStream) return scStream;
    throw new Error("No matching YouTube track found");
  }
  log(
    "cyan",
    "playback",
    `resolved youtube stand-in ${videoId} for "${track.title}"`,
  );
  const liner = await resolveLinerStream(videoId, signal);
  if (liner) {
    const stream = fromLinerStream(liner, track);
    stream.standIn = true;
    return stream;
  }

  const isWeb = isRealWebRuntime();
  const useAccount = isYoutubeSignedIn() && prefersAccountPlayback();

  // On web without sign-in, try fast Soundcloud fallback before heavy Innertube
  if (isWeb && !useAccount) {
    const scStream = await resolveSoundCloudFallback(track, signal);
    if (scStream) return scStream;
  }

  try {
    const stream = await resolveYoutubeAudio(videoId, progressive, signal);
    stream.standIn = true;
    return stream;
  } catch (ytError) {
    if (isAbortError(ytError, signal)) throw ytError;
    if (isWeb) {
      const scStream = await resolveSoundCloudFallback(track, signal);
      if (scStream) return scStream;
    }
    try {
      const invidious = await resolveInvidiousAudioStream(videoId, signal);
      if (invidious) {
        log("cyan", "playback", `resolved invidious stream for "${track.title}"`);
        return {
          url: invidious.url,
          source: "youtube",
          expiresAtMs: Date.now() + 6 * 3600 * 1000,
          mimeType: invidious.mimeType,
          codec: invidious.codec,
          bitrate: invidious.bitrate,
          standIn: true,
        };
      }
    } catch (invErr) {
      if (isAbortError(invErr, signal)) throw invErr;
    }
    if (!isWeb) {
      const scStream = await resolveSoundCloudFallback(track, signal);
      if (scStream) return scStream;
    }
    throw ytError;
  }
}

async function resolveSoundCloud(
  track: PlayableTrack,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  try {
    return fromSoundCloudStream(
      await resolveSoundCloudStream(track.id, { signal }),
    );
  } catch (soundCloudError) {
    if (isAbortError(soundCloudError, signal)) throw soundCloudError;
    log(
      "yellow",
      "playback",
      `soundcloud resolution failed, searching youtube: ${String(soundCloudError)}`,
    );
    try {
      return await resolveYoutubeStandIn(track, progressive, signal);
    } catch (standInError) {
      if (isAbortError(standInError, signal)) throw standInError;
      throw soundCloudError;
    }
  }
}

async function resolveYoutubeTrack(
  track: PlayableTrack,
  rowVideoId: string,
  progressive: boolean,
  signal?: AbortSignal,
): Promise<PlaybackStream> {
  const songId = track.audioVariant
    ? await findExactSongVersion(track, rowVideoId, signal)
    : null;
  if (songId)
    log(
      "cyan",
      "playback",
      `album row ${rowVideoId} is a ${track.audioVariant}, playing the song ${songId}`,
    );
  const videoId = songId ?? rowVideoId;
  const liner = await resolveLinerStream(videoId, signal);
  if (liner) {
    log("cyan", "playback", `resolved liner audio (r2) for "${track.title}"`);
    return fromLinerStream(liner, track);
  }

  const isWeb = isRealWebRuntime();
  const useAccount = isYoutubeSignedIn() && prefersAccountPlayback();

  // On web without sign-in, try fast Soundcloud fallback before heavy Innertube
  if (isWeb && !useAccount) {
    const scStream = await resolveSoundCloudFallback(track, signal);
    if (scStream) return scStream;

    try {
      return await resolveYoutubeStandIn(track, progressive, signal, videoId);
    } catch (standInErr) {
      if (isAbortError(standInErr, signal)) throw standInErr;
    }
  }

  try {
    return await resolveYoutubeAudio(videoId, progressive, signal);
  } catch (ytError) {
    if (isAbortError(ytError, signal)) throw ytError;
    if (isWeb) {
      log(
        "yellow",
        "playback",
        `youtube audio failed for "${track.title}", searching soundcloud fallback: ${String(ytError)}`,
      );
      const scStream = await resolveSoundCloudFallback(track, signal);
      if (scStream) return scStream;
    }
    log(
      "yellow",
      "playback",
      `youtube audio failed for "${track.title}" (${videoId}): ${String(ytError)}, searching stand-in`,
    );
    try {
      return await resolveYoutubeStandIn(track, progressive, signal, videoId);
    } catch (standInErr) {
      if (isAbortError(standInErr, signal)) throw standInErr;
      log(
        "yellow",
        "playback",
        `youtube stand-in failed: ${String(standInErr)}`,
      );
    }
    try {
      const invidious = await resolveInvidiousAudioStream(videoId, signal);
      if (invidious) {
        log("cyan", "playback", `resolved invidious stream for "${track.title}"`);
        return {
          url: invidious.url,
          source: "youtube",
          expiresAtMs: Date.now() + 6 * 3600 * 1000,
          mimeType: invidious.mimeType,
          codec: invidious.codec,
          bitrate: invidious.bitrate,
        };
      }
    } catch (invErr) {
      if (isAbortError(invErr, signal)) throw invErr;
    }
    if (!isWeb) {
      const scStream = await resolveSoundCloudFallback(track, signal);
      if (scStream) return scStream;
    }
    throw ytError;
  }
}

export async function resolvePlaybackStream(
  track: PlayableTrack,
  signal?: AbortSignal,
  options: ResolveStreamOptions = {},
): Promise<PlaybackStream> {
  const stream = await resolveStream(track, signal, options);
  rememberStreamOrigin(track.id, stream);
  return stream;
}

async function resolveStream(
  track: PlayableTrack,
  signal?: AbortSignal,
  options: ResolveStreamOptions = {},
): Promise<PlaybackStream> {
  const progressive = options.progressive ?? false;
  if (isLocalTrackId(track.id))
    return {
      url: localTrackAudioUrl(track.id),
      source: "local",
      expiresAtMs: null,
      mimeType: "",
      codec: "local",
      bitrate: 0,
    };
  const saved = savedTrackRecord(track.id);
  if (saved)
    return {
      url: savedAudioUrl(saved),
      expiresAtMs: null,
      mimeType: saved.mimeType,
      codec: "local",
      bitrate: 0,
    };
  if (isOfflineMode()) throw new Error(OFFLINE_UNAVAILABLE_MESSAGE);
  const resolve = (bounded: AbortSignal | undefined) => {
    if (toSoundCloudTrackId(track.id))
      return resolveSoundCloud(track, progressive, bounded);
    const videoId = toVideoId(track.id);
    if (videoId)
      return resolveYoutubeTrack(track, videoId, progressive, bounded);
    return resolveYoutubeStandIn(track, progressive, bounded);
  };
  return progressive ? withResolveTimeout(signal, resolve) : resolve(signal);
}

export const RESOLVE_TIMEOUT_MS = 25_000;
export const RESOLVE_TIMEOUT_MESSAGE =
  "Timed out looking for a playable stream";

export async function withResolveTimeout<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = RESOLVE_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timedOut = new Error(RESOLVE_TIMEOUT_MESSAGE);
  const forward = () => controller.abort(signal?.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener("abort", forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timedOut);
      reject(timedOut);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}
