import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveLinerStream,
  resetLinerPlaybackPause,
  type LinerAudioStream,
} from "./linerPlayback";

describe("resolveLinerStream", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLinerPlaybackPause();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    resetLinerPlaybackPause();
  });

  it("200 OK returns the parsed LinerAudioStream JSON from /api/stream/{videoId}/resolve", async () => {
    const mockStream: LinerAudioStream = {
      url: "https://example.com/stream/track-123.mp4",
      expiresAt: "2026-11-08T20:00:00Z",
      mimeType: "audio/mp4",
      codec: "mp4a.40.2",
      size: 4500000,
    };

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockStream), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await resolveLinerStream("track-123");
    expect(result).toEqual(mockStream);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/stream/track-123/resolve");
    expect(init?.method).toBe("POST");
  });

  it("404 returns null without pausing subsequent calls", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const first = await resolveLinerStream("missing-id");
    expect(first).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const nextStream: LinerAudioStream = {
      url: "https://example.com/stream/track-next.mp4",
      expiresAt: "2026-11-08T20:00:00Z",
      mimeType: "audio/mp4",
      size: 3000000,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(nextStream), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const second = await resolveLinerStream("next-id");
    expect(second).toEqual(nextStream);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("503 returns null and pauses subsequent calls until resetLinerPlaybackPause() is called", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503 }),
    );

    const first = await resolveLinerStream("error-id");
    expect(first).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Subsequent call should be paused immediately without making another network request
    const pausedCall = await resolveLinerStream("should-be-paused");
    expect(pausedCall).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Reset pause state
    resetLinerPlaybackPause();

    const recoveredStream: LinerAudioStream = {
      url: "https://example.com/stream/recovered.mp4",
      expiresAt: "2026-11-08T20:00:00Z",
      mimeType: "audio/mp4",
      size: 3200000,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(recoveredStream), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const afterReset = await resolveLinerStream("recovered-id");
    expect(afterReset).toEqual(recoveredStream);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
