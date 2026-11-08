import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PresenceClient } from "./presenceClient";
import * as authSession from "../api/auth-session";

describe("PresenceClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");

    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([{ id: "11111111-1111-1111-1111-111111111111" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(authSession, "getValidAccessToken").mockResolvedValue(
      "test-valid-jwt-token",
    );
    vi.spyOn(authSession, "getAuthSession").mockReturnValue({
      accessToken: "test-valid-jwt-token",
      refreshToken: "test-refresh-token",
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      user: {
        id: "11111111-1111-1111-1111-111111111111",
        email: "alice@example.com",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends PATCH to /rest/v1/profiles with Authorization header on start()", async () => {
    const client = new PresenceClient(100);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://example.supabase.co/rest/v1/profiles?id=eq.11111111-1111-1111-1111-111111111111",
    );
    expect(init.method).toBe("PATCH");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-valid-jwt-token");
    expect(headers.get("apikey")).toBe("test-anon-key");
    const body = JSON.parse(init.body);
    expect(body).toHaveProperty("last_seen_at");
    client.stop();
  });

  it("repeats according to intervalMs and stops after stop()", async () => {
    const client = new PresenceClient(50);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    client.stop();

    const callCountAfterStop = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchMock.mock.calls.length).toBe(callCountAfterStop);
  });

  it("does not send request when user is not authenticated", async () => {
    vi.spyOn(authSession, "getValidAccessToken").mockResolvedValue(null);
    vi.spyOn(authSession, "getAuthSession").mockReturnValue(null);

    const client = new PresenceClient(100);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    client.stop();
  });

  it("does not send request when Supabase is not configured", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const client = new PresenceClient(100);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    client.stop();
  });
});
