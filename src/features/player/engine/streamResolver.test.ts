import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/shared/contracts";
import type { Track } from "@/shared/types";

const mocks = vi.hoisted(() => ({
  resolveDirectAudioStream: vi.fn(),
  searchRaw: vi.fn(),
  resolveSoundCloudStream: vi.fn(),
  searchSoundCloudTracks: vi.fn(),
}));

vi.mock("@/shared/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/youtube")>();
  return {
    ...actual,
    resolveDirectAudioStream: mocks.resolveDirectAudioStream,
    searchRaw: mocks.searchRaw,
  };
});

vi.mock("@/shared/media/soundcloud", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/media/soundcloud")>();
  return {
    ...actual,
    resolveSoundCloudStream: mocks.resolveSoundCloudStream,
    searchSoundCloudTracks: mocks.searchSoundCloudTracks,
  };
});

import { resolvePlaybackStream } from "./streamResolver";
import { clearYoutubeStandInCache } from "./youtubeStandIn";
import { clearExactSongVersions } from "./exactSongVersion";

const directStream = {
  url: "https://rr1.googlevideo.com/videoplayback?itag=251",
  mimeType: "audio/webm",
  codec: "opus" as const,
  bitrate: 135_000,
  itag: 251,
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function track(
  id: string,
  title = "Blinding Lights",
  artists = "The Weeknd",
  durationMs = 200_000,
): Track {
  return { id, title, artists, durationMs, coverUrl: "", playCount: 0 };
}

function searchTrack(
  id: string,
  title: string,
  artist: string,
  durationMs: number,
): SearchResult {
  return {
    type: "track",
    id,
    title,
    artists: [{ id: `UC_${artist}`, name: artist }],
    durationMs,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.resolveDirectAudioStream.mockReset();
  mocks.searchRaw.mockReset();
  mocks.resolveSoundCloudStream.mockReset();
  mocks.searchSoundCloudTracks.mockReset();
  clearYoutubeStandInCache();
});

describe("resolvePlaybackStream for youtube ids", () => {
  it("plays youtube tracks straight from googlevideo", async () => {
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    const stream = await resolvePlaybackStream(track("dQw4w9WgXcQ"));

    expect(stream).toMatchObject({
      url: directStream.url,
      expiresAtMs: Date.parse(directStream.expiresAt),
    });
    expect(mocks.resolveSoundCloudStream).not.toHaveBeenCalled();
  });

  it("surfaces the innertube error when youtube cannot play the track and no fallback hits", async () => {
    mocks.resolveDirectAudioStream.mockRejectedValue(
      new Error("LOGIN_REQUIRED"),
    );
    mocks.searchSoundCloudTracks.mockResolvedValue([]);

    await expect(resolvePlaybackStream(track("dQw4w9WgXcQ"))).rejects.toThrow(
      "LOGIN_REQUIRED",
    );
  });

  it("falls back to next soundcloud hit when previous hit fails", async () => {
    mocks.resolveDirectAudioStream.mockRejectedValue(
      new Error("LOGIN_REQUIRED"),
    );
    mocks.searchSoundCloudTracks.mockResolvedValue([
      {
        track: {
          id: "sc:1",
          title: "Blinding Lights",
          artists: [{ id: "a1", name: "The Weeknd" }],
          durationMs: 200_000,
        },
      },
      {
        track: {
          id: "sc:2",
          title: "Blinding Lights",
          artists: [{ id: "a1", name: "The Weeknd" }],
          durationMs: 201_000,
        },
      },
    ]);
    mocks.resolveSoundCloudStream
      .mockRejectedValueOnce(new Error("preview_only"))
      .mockResolvedValueOnce({
        source: "soundcloud",
        mimeType: "audio/mp4",
        codec: "aac",
        bitrate: 128_000,
        url: "https://playback.media-streaming.soundcloud.cloud/test.mp4",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });

    const stream = await resolvePlaybackStream(track("dQw4w9WgXcQ"));
    expect(stream.source).toBe("soundcloud");
    expect(stream.url).toBe(
      "https://playback.media-streaming.soundcloud.cloud/test.mp4",
    );
    expect(mocks.resolveSoundCloudStream).toHaveBeenCalledTimes(2);
  });

  it("rejects live, remix, and duration-mismatched soundcloud hits for studio songs", async () => {
    mocks.resolveDirectAudioStream.mockRejectedValue(
      new Error("LOGIN_REQUIRED"),
    );
    mocks.searchSoundCloudTracks.mockResolvedValue([
      {
        track: {
          id: "sc:live",
          title: "Blinding Lights (Live at Super Bowl)",
          artists: [{ id: "a1", name: "The Weeknd" }],
          durationMs: 200_000,
        },
      },
      {
        track: {
          id: "sc:remix",
          title: "Blinding Lights (Club Remix)",
          artists: [{ id: "a1", name: "The Weeknd" }],
          durationMs: 200_000,
        },
      },
      {
        track: {
          id: "sc:long",
          title: "Blinding Lights",
          artists: [{ id: "a1", name: "The Weeknd" }],
          durationMs: 600_000,
        },
      },
    ]);

    await expect(resolvePlaybackStream(track("dQw4w9WgXcQ"))).rejects.toThrow(
      "LOGIN_REQUIRED",
    );
    expect(mocks.resolveSoundCloudStream).not.toHaveBeenCalled();
  });
});

describe("resolvePlaybackStream for ids of unknown sources", () => {
  it("plays the matching youtube track", async () => {
    mocks.searchRaw.mockResolvedValue([
      searchTrack("4NRXx6U8ABQ", "Blinding Lights", "The Weeknd", 200_040),
    ]);
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    const stream = await resolvePlaybackStream(track("local-file-1"));

    expect(mocks.resolveDirectAudioStream).toHaveBeenCalledWith("4NRXx6U8ABQ", {
      signal: undefined,
    });
    expect(stream).toMatchObject({ url: directStream.url });
  });

  it("fails when youtube has no matching track", async () => {
    mocks.searchRaw.mockResolvedValue([]);
    mocks.searchSoundCloudTracks.mockResolvedValue([]);

    await expect(resolvePlaybackStream(track("local-file-2"))).rejects.toThrow(
      "No matching YouTube track found",
    );
  });
});

describe("resolvePlaybackStream for album rows that are not the song", () => {
  afterEach(() => clearExactSongVersions());

  it("plays the exact song version instead of the music video", async () => {
    mocks.searchRaw.mockResolvedValue([
      searchTrack("Fb3j_yuFh1s", "Blinding Lights", "The Weeknd", 200_000),
    ]);
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    await resolvePlaybackStream({
      ...track("NLZRYQMLDW4"),
      audioVariant: "music-video",
    });

    expect(mocks.resolveDirectAudioStream).toHaveBeenCalledWith("Fb3j_yuFh1s", {
      signal: undefined,
    });
  });

  it("keeps the album row when nothing matches exactly", async () => {
    mocks.searchRaw.mockResolvedValue([
      searchTrack(
        "Fb3j_yuFh1s",
        "Blinding Lights (Remix)",
        "The Weeknd",
        200_000,
      ),
    ]);
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    await resolvePlaybackStream({
      ...track("jvDZEoEdjzo"),
      audioVariant: "premium-only",
    });

    expect(mocks.resolveDirectAudioStream).toHaveBeenCalledWith("jvDZEoEdjzo", {
      signal: undefined,
    });
  });

  it("never searches for tracks that are already the song", async () => {
    mocks.resolveDirectAudioStream.mockResolvedValue(directStream);

    await resolvePlaybackStream(track("dQw4w9WgXcQ"));

    expect(mocks.searchRaw).not.toHaveBeenCalled();
  });
});
