import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchLyricsWithLrclib, streamLyricsWithLrclib } from "./lrclibLyrics";

describe("lrclibLyrics", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps synced lyrics correctly", async () => {
    const mockLrc = {
      id: 1,
      trackName: "Song A",
      artistName: "Artist B",
      duration: 120,
      instrumental: false,
      syncedLyrics: "[00:10.00] Line one\n[00:20.00] Line two",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockLrc,
    } as any);

    const result = await searchLyricsWithLrclib({
      title: "Song A",
      artist: "Artist B",
      durationMs: 120000,
    });

    expect(result).not.toBeNull();
    expect(result?.candidate.lyrics.format).toBe("lrc");
    expect(result?.candidate.syncLevel).toBe("line_level");
    expect(result?.candidate.quality.total).toBe(90);
  });

  it("maps plain lyrics correctly", async () => {
    const mockPlain = {
      id: 2,
      trackName: "Song C",
      artistName: "Artist D",
      duration: 150,
      instrumental: false,
      plainLyrics: "Just some text\nWithout timestamps",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPlain,
    } as any);

    const result = await searchLyricsWithLrclib({
      title: "Song C",
      artist: "Artist D",
    });

    expect(result).not.toBeNull();
    expect(result?.candidate.lyrics.format).toBe("plain");
    expect(result?.candidate.syncLevel).toBe("plain");
    expect(result?.candidate.quality.total).toBe(65);
  });

  it("streams instrumental status properly", async () => {
    const mockInstrumental = {
      id: 3,
      trackName: "Instrumental Piece",
      artistName: "Composer",
      duration: 200,
      instrumental: true,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockInstrumental,
    } as any);

    const events: any[] = [];
    for await (const ev of streamLyricsWithLrclib("track-inst", undefined, {
      title: "Instrumental Piece",
      artist: "Composer",
    })) {
      events.push(ev);
    }

    const providerEv = events.find((e) => e.type === "provider");
    expect(providerEv?.instrumental).toBe(true);

    const doneEv = events.find((e) => e.type === "done");
    expect(doneEv?.instrumental).toBe(true);
  });
});
