import { describe, expect, it, beforeEach, vi } from "vitest";
import { isSupabaseConfigured } from "./client";
import { localFallbackApi, readLocalAccount } from "./localFallback";

describe("supabase client & fallback", () => {
  const storageMap = new Map<string, string>();

  const localStorageMock = {
    getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
    setItem: vi.fn((key: string, val: string) => {
      storageMap.set(key, val);
    }),
    removeItem: vi.fn((key: string) => {
      storageMap.delete(key);
    }),
    clear: vi.fn(() => {
      storageMap.clear();
    }),
  };

  beforeEach(() => {
    storageMap.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", {
        value: localStorageMock,
        configurable: true,
        writable: true,
      });
    }
  });

  it("reports isSupabaseConfigured based on env vars", () => {
    expect(typeof isSupabaseConfigured()).toBe("boolean");
  });

  it("handles local fallback authentication", () => {
    const tokens = localFallbackApi.register("alice@example.com", "alice", "Alice");
    expect(tokens.user.email).toBe("alice@example.com");
    expect(tokens.user.username).toBe("alice");
    expect(tokens.user.displayName).toBe("Alice");
    expect(tokens.accessToken).toBeTruthy();

    const account = readLocalAccount();
    expect(account?.user.id).toBe(tokens.user.id);

    const loginTokens = localFallbackApi.login("alice@example.com");
    expect(loginTokens.user.id).toBe(tokens.user.id);
  });

  it("manages playlists in local fallback", () => {
    const tokens = localFallbackApi.register("bob@example.com", "bob", "Bob");
    const userId = tokens.user.id;

    const playlist = localFallbackApi.createPlaylist(userId, {
      title: "My Chill Beats",
      description: "Beats to relax to",
      isPublic: true,
    });
    expect(playlist.title).toBe("My Chill Beats");
    expect(playlist.trackCount).toBe(0);

    const item = localFallbackApi.addPlaylistTrack(userId, playlist.id, "track-1", {
      id: "track-1",
      title: "Chill Track",
      coverUrl: "https://example.com/cover.jpg",
      durationMs: 180000,
    });
    expect(item.track.title).toBe("Chill Track");
    expect(item.track.cover?.url).toBe("https://example.com/cover.jpg");

    const fetched = localFallbackApi.getUserPlaylist(playlist.id);
    expect(fetched.items.length).toBe(1);
    expect(fetched.playlist.trackCount).toBe(1);

    localFallbackApi.removePlaylistItem(userId, playlist.id, item.id);
    const empty = localFallbackApi.getUserPlaylist(playlist.id);
    expect(empty.items.length).toBe(0);
  });

  it("manages liked tracks in local fallback", () => {
    const tokens = localFallbackApi.register("carol@example.com", "carol", "Carol");
    const userId = tokens.user.id;

    localFallbackApi.likeTrack(userId, "track-99", {
      id: "track-99",
      title: "Loved Song",
      artists: "Carol",
      durationMs: 200000,
    });

    const page = localFallbackApi.listLikedTracks(userId);
    expect(page.items.length).toBe(1);
    expect(page.items[0].track.title).toBe("Loved Song");

    localFallbackApi.unlikeTrack(userId, "track-99");
    const emptyPage = localFallbackApi.listLikedTracks(userId);
    expect(emptyPage.items.length).toBe(0);
  });
});
