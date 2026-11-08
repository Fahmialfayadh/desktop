import {
  getAuthSession,
  getSessionExpiryMs,
  getValidAccessToken,
  refreshAuthSession,
  setAuthSession,
  type AuthTokens,
  type AuthUser,
} from "./auth-session";
import { signApiRequest, syncServerTime } from "./requestSigner";
import { clientCatalog } from "./clientCatalog";
import { getLocalImportHandler } from "./localImports";
import type { Track, Cover } from "@/shared/contracts";
import { telemetry } from "@/shared/telemetry";
import type {
  PublicUser,
  UpdateProfileInput,
  UserProfile,
  LeaderboardResponse,
  DailyMixesResponse,
} from "@/shared/contracts";

import { usePlayerStore } from "@/features/player/store/playerStore";
import { isLocalTrackId } from "@/shared/media/local";
import { showToast } from "@/shared/ui/Toast";
import { createTranslatorSync, getStoredLocale } from "@/languages";
import {
  connectionToastsMuted,
  isConnectivityFailure,
  isPlaybackPath,
  recordConnectivityFailure,
  statusOf,
  stripQuery,
} from "@/features/connectivity";
import { enterOfflineMode } from "@/features/connectivity/engine/offlineController";
import { supabaseApi } from "@/shared/supabase";
import { searchLyricsWithLrclib, streamLyricsWithLrclib } from "./lrclibLyrics";
import { linerDb } from "@/shared/storage";

function toContractTrack(source: any): Track {
  if (!source) {
    return {
      id: "",
      title: "",
      artists: [],
      durationMs: 0,
    };
  }

  let artists: { id: string; name: string }[] = [];
  if (Array.isArray(source.artists)) {
    artists = source.artists.map((a: any) => ({
      id: typeof a === "string" ? "" : (a?.id || ""),
      name: typeof a === "string" ? a : (a?.name || ""),
    }));
  } else if (typeof source.artists === "string" && source.artists.trim()) {
    artists = source.artists
      .split(",")
      .map((p: string) => ({
        id: source.artistId || "",
        name: p.trim(),
      }))
      .filter((a: any) => a.name);
  } else if (typeof source.artist === "string" && source.artist.trim()) {
    artists = [{ id: source.artistId || "", name: source.artist.trim() }];
  } else if (typeof source.artist === "object" && source.artist !== null) {
    artists = [{ id: source.artist?.id || "", name: source.artist?.name || "" }];
  }

  const coverUrl =
    source.cover?.url ||
    source.coverUrl ||
    source.thumbnail ||
    (typeof source.cover === "string" ? source.cover : "");

  const cover: Cover | undefined = coverUrl
    ? {
        url: coverUrl,
        width: source.cover?.width || 500,
        height: source.cover?.height || 500,
        fallbackUrl: source.cover?.fallbackUrl,
      }
    : undefined;

  return {
    id: String(source.id || source.trackId || ""),
    title: String(source.title || source.name || ""),
    artists,
    album: source.album
      ? {
          id: String(source.album.id || ""),
          title: String(source.album.title || source.album.name || ""),
        }
      : undefined,
    durationMs: Number(source.durationMs || source.duration || 0),
    cover,
    explicit: Boolean(source.explicit),
    audioVariant: source.audioVariant,
  };
}

function translate(key: string, vars?: Record<string, string | number>) {
  try {
    return createTranslatorSync(getStoredLocale())(key, vars);
  } catch {
    return key;
  }
}

function offlineModeAction() {
  return {
    label: translate("offline.use_offline"),
    onClick: () =>
      enterOfflineMode(
        "auto",
        true,
        typeof navigator !== "undefined" && !navigator.onLine
          ? "offline"
          : "server",
      ),
  };
}

import { getApiBaseUrl } from "./baseUrl";
import {
  PowTimeoutError,
  SUPPORTED_POW_ALGORITHM,
  type PowChallenge,
  type PowSolution,
} from "./proofOfWork";
import { solvePow } from "./proofOfWorkRunner";
import {
  isHumanCheckMode,
  runHumanCheck,
  type HumanCheckAction,
} from "./humanCheck";

const CLIENT_VERSION =
  (import.meta.env.VITE_CLIENT_VERSION as string | undefined) ||
  "1.0.4-desktop";

const DEFAULT_TIMEOUT_MS = 15000;
const LYRICS_CONNECT_TIMEOUT_MS = 12000;

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const userSignal = init?.signal;
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  let onUserAbort: (() => void) | null = null;
  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(timer);
      controller.abort(userSignal.reason);
    } else {
      onUserAbort = () => {
        clearTimeout(timer);
        controller.abort(userSignal.reason);
      };
      userSignal.addEventListener("abort", onUserAbort);
    }
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } catch (err: any) {
    if (didTimeout) {
      if (!connectionToastsMuted())
        showToast(translate("common.error_timeout_title"), "error", {
          id: "network-timeout-toast",
          description: translate("common.error_network"),
          action: offlineModeAction(),
        });
      throw new ApiError(
        0,
        "Request timed out. Please check your network connection.",
        "TIMEOUT_ERROR",
      );
    }
    if (userSignal?.aborted) {
      throw err;
    }
    if (!connectionToastsMuted())
      showToast(translate("common.error_network_title"), "error", {
        id: "network-error-toast",
        description: translate("common.error_network"),
        action: offlineModeAction(),
      });
    throw new ApiError(
      0,
      "Network error. Unable to reach server.",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
    if (userSignal && onUserAbort) {
      userSignal.removeEventListener("abort", onUserAbort);
    }
  }
}

function getPlatform(): string {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "desktop";
}

function getActiveSessionId(): string | undefined {
  try {
    const id = usePlayerStore.getState().currentTrack?.id;
    return id && !isLocalTrackId(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function extractSubFromToken(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return undefined;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    const payload = JSON.parse(json);
    return typeof payload.sub === "string" && payload.sub.trim().length > 0
      ? payload.sub.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function getCurrentUserAndToken(): Promise<{ userId: string; token?: string }> {
  const session = getAuthSession();
  const token = (await getValidAccessToken()) || session?.accessToken || undefined;
  const userId =
    session?.user?.id ||
    (token ? extractSubFromToken(token) : undefined) ||
    "local_user";
  return { userId, token };
}

export function mediaUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return getApiBaseUrl() + (path.startsWith("/") ? path : "/" + path);
}

// upgrades youtube/google avatar artwork to maximum native resolution (=s0)
export function toMaxQualityAvatarUrl(url: string | undefined): string {
  if (!url) return "";
  if (
    !/(?:[a-zA-Z0-9_-]+\.googleusercontent\.com|[a-zA-Z0-9_-]+\.ggpht\.com)/i.test(
      url,
    )
  ) {
    return url;
  }
  if (/=w\d+-h\d+/.test(url)) {
    return url.replace(/=w\d+-h\d+(?:-[a-zA-Z0-9_-]+)*/, "=s0");
  }
  if (/=s\d+/.test(url)) {
    return url.replace(/=s\d+(?:-[a-zA-Z0-9_-]+)*/, "=s0");
  }
  return `${url}=s0`;
}

const inFlightGetRequests = new Map<string, Promise<unknown>>();

async function executeRequest<T>(
  path: string,
  init?: RequestInit,
  allowRefresh = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onResponse?: (res: Response) => void,
): Promise<T> {
  const startTime = performance.now();
  const method = (init?.method ?? "GET").toUpperCase();
  const rawBody = typeof init?.body === "string" ? init.body : null;
  const signedHeaders = await signApiRequest(method, path, rawBody);
  const currentSession = getAuthSession();
  let accessToken = allowRefresh ? await getValidAccessToken() : null;

  if (
    allowRefresh &&
    currentSession?.accessToken &&
    !accessToken &&
    !path.startsWith("/v1/auth/")
  ) {
    const expiryMs = getSessionExpiryMs(currentSession);
    if (expiryMs && expiryMs > Date.now()) {
      accessToken = currentSession.accessToken;
    } else {
      recordConnectivityFailure({
        method,
        path: stripQuery(path),
        status: 0,
        latencyMs: Math.round(performance.now() - startTime),
      });
      throw new ApiError(
        0,
        "Network error during token refresh.",
        "NETWORK_ERROR",
      );
    }
  }

  const hasBody = init?.body != null;
  const extraHeaders = (init?.headers as Record<string, string>) ?? {};
  const { Authorization: _ignoredAuth, ...restHeaders } = extraHeaders;

  const requestId =
    extraHeaders["x-request-id"] ||
    extraHeaders["X-Request-Id"] ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  const correlationHeaders: Record<string, string> = {
    "x-request-id": requestId,
    "x-client-version": CLIENT_VERSION,
    "x-platform": getPlatform(),
  };

  const userId =
    currentSession?.user?.id ||
    (accessToken ? extractSubFromToken(accessToken) : undefined);
  if (userId) {
    correlationHeaders["x-user-id"] = userId;
  }
  if (currentSession?.user?.username) {
    correlationHeaders["x-user-name"] = currentSession.user.username;
  }

  const activeSessionId = getActiveSessionId();
  if (activeSessionId) {
    correlationHeaders["x-session-id"] = activeSessionId;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      getApiBaseUrl() + path,
      {
        ...init,
        headers: {
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...correlationHeaders,
          ...signedHeaders,
          ...restHeaders,
        },
      },
      timeoutMs,
    );
  } catch (err: any) {
    if (init?.signal?.aborted || err?.name === "AbortError") {
      throw err;
    }
    const durationMs = Math.round(performance.now() - startTime);
    telemetry.trackNetwork(method, path, 0, durationMs, requestId);
    if (isConnectivityFailure(err) && !isPlaybackPath(path)) {
      recordConnectivityFailure({
        method,
        path: stripQuery(path),
        status: statusOf(err),
        latencyMs: durationMs,
      });
    }
    throw err;
  }

  // sync server time offset from response Date header
  const dateHeader = res.headers?.get?.("date");
  if (dateHeader) {
    syncServerTime(dateHeader);
  }

  if (res.status === 401 && allowRefresh && !path.startsWith("/v1/auth/")) {
    const currentSession = getAuthSession();
    let nextToken =
      currentSession?.accessToken && currentSession.accessToken !== accessToken
        ? currentSession.accessToken
        : null;

    if (!nextToken && currentSession?.refreshToken) {
      const refreshed = await refreshAuthSession();
      nextToken = refreshed?.accessToken ?? null;
      if (!nextToken && getAuthSession()?.refreshToken) {
        throw new ApiError(
          0,
          "Failed to refresh auth session due to network issue",
          "NETWORK_ERROR",
        );
      }
    }

    if (!nextToken) {
      const durationMs = Math.round(performance.now() - startTime);
      telemetry.trackNetwork(method, path, res.status, durationMs, requestId);
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const code = typeof body?.code === "string" ? body.code : undefined;
      const message =
        typeof body?.message === "string"
          ? body.message
          : typeof body?.error === "string"
            ? body.error
            : "Unauthorized";
      throw new ApiError(res.status, message, code, requestId);
    }

    const refreshedSignedHeaders = await signApiRequest(method, path, rawBody);
    try {
      res = await fetchWithTimeout(
        getApiBaseUrl() + path,
        {
          ...init,
          headers: {
            ...(hasBody ? { "Content-Type": "application/json" } : {}),
            ...correlationHeaders,
            ...restHeaders,
            ...refreshedSignedHeaders,
            ...(nextToken ? { Authorization: `Bearer ${nextToken}` } : {}),
          },
        },
        timeoutMs,
      );
      const retryDateHeader = res.headers?.get?.("date");
      if (retryDateHeader) {
        syncServerTime(retryDateHeader);
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      telemetry.trackNetwork(method, path, 0, durationMs, requestId);
      if (isConnectivityFailure(err) && !isPlaybackPath(path)) {
        recordConnectivityFailure({
          method,
          path: stripQuery(path),
          status: statusOf(err),
          latencyMs: durationMs,
        });
      }
      throw err;
    }
  }

  const durationMs = Math.round(performance.now() - startTime);
  telemetry.trackNetwork(method, path, res.status, durationMs, requestId);
  onResponse?.(res);
  if (res.status === 304) return undefined as unknown as T;

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const resRequestId =
      res.headers?.get?.("x-request-id") ||
      (typeof body.reqId === "string"
        ? body.reqId
        : typeof body.requestId === "string"
          ? body.requestId
          : undefined);

    if (res.status >= 500 && !connectionToastsMuted()) {
      showToast(translate("common.error_server_title"), "error", {
        id: `server-error-${res.status}`,
        description: translate("common.error_server"),
        requestId: resRequestId,
      });
    }

    const apiErr = new ApiError(
      res.status,
      typeof body.message === "string" ? body.message : res.statusText,
      typeof body.code === "string" ? body.code : undefined,
      resRequestId,
    );
    if (isConnectivityFailure(apiErr) && !isPlaybackPath(path)) {
      recordConnectivityFailure({
        method,
        path: stripQuery(path),
        status: res.status,
        ...(apiErr.code ? { code: apiErr.code } : {}),
        latencyMs: durationMs,
      });
    }
    throw apiErr;
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export type UserPlaylistRead =
  | { notModified: true }
  | {
      notModified: false;
      etag?: string;
      partial: boolean;
      trackCount: number;
      durationMs: number;
      playlist: ApiUserPlaylist;
      items: ApiUserPlaylistItem[];
    };

async function request<T>(
  path: string,
  init?: RequestInit,
  allowRefresh = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" && !init?.signal) {
    const key = `${path}::${allowRefresh}`;
    const inFlight = inFlightGetRequests.get(key);
    if (inFlight) {
      return inFlight as Promise<T>;
    }
    const promise = executeRequest<T>(
      path,
      init,
      allowRefresh,
      timeoutMs,
    ).finally(() => {
      inFlightGetRequests.delete(key);
    });
    inFlightGetRequests.set(key, promise);
    return promise;
  }
  return executeRequest<T>(path, init, allowRefresh, timeoutMs);
}

export { ApiError } from "./ApiError";
import { ApiError } from "./ApiError";

// maps any thrown error to a localized human-friendly message.
// never surfaces raw api bodies, statuses, or technical jargon.
export function resolveApiErrorMessage(
  err: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("common.error_network");
    if (err.status === 401 || err.status === 403)
      return t("common.error_session_expired");
    if (err.status === 404) return t("common.error_not_found");
    if (err.status === 429) return t("common.error_too_many");
    if (err.status >= 500) return t("common.error_server");
    return t(fallbackKey);
  }
  return t(fallbackKey);
}

// ---- Types from @liner/contracts --------------------------------------------

export type {
  SearchType,
  Cover,
  ApiCover,
  TrackArtist as ApiTrackArtist,
  TrackAlbum as ApiTrackAlbum,
  Track as ApiTrackBase,
  ApiTrack,
  TrackDetails as ApiTrackDetails,
  SearchArtistItem as ApiArtist,
  SearchAlbumItem as ApiAlbum,
  SearchPlaylistItem as ApiPlaylist,
  SearchResult as ApiSearchItem,
  SearchResponse,
  ArtistAlbum as ApiArtistAlbum,
  ArtistRelease as ApiArtistRelease,
  ArtistDetails as ApiArtistDetails,
  AlbumDetails as ApiAlbumDetails,
  CatalogPlaylistDetails as ApiCatalogPlaylistDetails,
  RadioTrack as ApiRadioTrack,
  RadioResponse,
  PlaylistSummary as ApiPlaylistSummary,
  PlaylistDetails as ApiPlaylistDetails,
  UserPlaylist as ApiUserPlaylist,
  UserPlaylistItem as ApiUserPlaylistItem,
  LikedTracksPage as ApiLikedTracksPage,
  LyricsFormat,
  LyricsContentKind,
  LyricsSyncLevel,
  LyricsQuality,
  RawLyricsCandidate,
  LyricsCandidate,
  LyricsStreamEvent,
  ImportReviewReason,
  ImportReview,
  ImportReviewDecision,
  ImportSource,
  ImportJobStatus,
  ImportResult,
  ImportJob,
  ImportedTrack,
  ImportedPlaylist,
  PublicUser,
  UserProfile,
  UpdateProfileInput,
  UserPrivacySettings,
  LeaderboardResponse,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardType,
  AuthTokens,
  AuthResult,
  PlaybackContextType,
  PlaybackContext,
  RecordPlaybackEventRequest,
  PlaybackHistoryItem,
  PlaybackHistoryResponse,
  PopularTimeWindow,
  PopularTrackItem,
  PopularTracksResponse,
  PopularAlbumsResponse,
  MostSavedResponse,
  MostSavedType,
} from "../contracts";

import type {
  SearchType,
  SearchResponse,
  Track as ApiTrackBase,
  ApiTrackDetails,
  RadioResponse,
  ApiAlbumDetails,
  ApiArtistDetails,
  ApiCatalogPlaylistDetails,
  ApiLikedTracksPage,
  ApiUserPlaylist,
  ApiUserPlaylistItem,
  LyricsStreamEvent,
  LyricsSearchResult,
  ImportJob,
  ImportReview,
  ImportReviewDecision,
  RecordPlaybackEventRequest,
  PlaybackHistoryResponse,
  PopularTimeWindow,
  PopularTracksResponse,
  PopularAlbumsResponse,
  MostSavedResponse,
  MostSavedType,
} from "../contracts";

// In-memory cache for daily mixes (10 minutes TTL)
interface CachedDailyMixes {
  timestamp: number;
  userId: string;
  response: DailyMixesResponse;
}
let cachedDailyMixes: CachedDailyMixes | null = null;
const DAILY_MIX_CACHE_TTL_MS = 10 * 60 * 1000;

// ---- Endpoints --------------------------------------------------------------

export const api = {
  async login(email: string, password: string): Promise<AuthTokens> {
    const result = await supabaseApi.login(email, password);
    setAuthSession(result);
    return result;
  },

  async register(
    email: string,
    password: string,
    username: string,
    displayName: string,
  ): Promise<AuthTokens> {
    const result = await supabaseApi.register(
      email,
      password,
      username,
      displayName,
    );
    setAuthSession(result);
    return result;
  },

  async getMe(): Promise<AuthUser> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.getMe(userId, token);
  },

  async updateProfile(data: UpdateProfileInput): Promise<PublicUser> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.updateProfile(userId, data, token);
  },

  async getUserProfile(idOrUsername: string): Promise<UserProfile> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.getUserProfile(idOrUsername, userId, token);
  },

  async searchUsers(query: string): Promise<UserProfile[]> {
    const { token } = await getCurrentUserAndToken();
    return supabaseApi.searchUsers(query, token);
  },

  async followUser(idOrUsername: string): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.followUser(userId, idOrUsername, token);
  },

  async unfollowUser(idOrUsername: string): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.unfollowUser(userId, idOrUsername, token);
  },

  async getUserFollowers(idOrUsername: string): Promise<UserProfile[]> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.getUserFollowers(idOrUsername, userId, token);
  },

  async getUserFollowing(idOrUsername: string): Promise<UserProfile[]> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.getUserFollowing(idOrUsername, userId, token);
  },

  async getUserPlaylists(
    idOrUsername: string,
  ): Promise<{ items: ApiUserPlaylist[] }> {
    const { token } = await getCurrentUserAndToken();
    return supabaseApi.getUserPlaylists(idOrUsername, token);
  },

  async getUserHistory(
    idOrUsername: string,
    cursor?: string,
    limit?: string,
  ): Promise<PlaybackHistoryResponse> {
    const { token } = await getCurrentUserAndToken();
    return supabaseApi.getUserHistory(idOrUsername, cursor, limit, token);
  },

  async getArtistLeaderboard(
    artistId: string,
    period = "monthly",
    limit = 10,
  ): Promise<LeaderboardResponse> {
    const { token } = await getCurrentUserAndToken();
    return supabaseApi.getArtistLeaderboard(artistId, period, limit, token);
  },

  async getGlobalLeaderboard(
    period = "weekly",
    limit = 20,
  ): Promise<LeaderboardResponse> {
    const { token } = await getCurrentUserAndToken();
    return supabaseApi.getGlobalLeaderboard(period, limit, token);
  },

  search(q: string, type: SearchType = "all"): Promise<SearchResponse> {
    return clientCatalog.search(q, type, () => Promise.resolve({ items: [] }));
  },

  getTrack(id: string): Promise<ApiTrackDetails> {
    return clientCatalog.getTrack(id, () =>
      Promise.reject(
        new ApiError(404, "Track not found in catalog", "TRACK_NOT_FOUND"),
      ),
    );
  },

  getRadio(
    id: string,
    options?: {
      history?: string[];
      k?: number;
      drift_rate?: number;
      temperature?: number;
      wave_id?: string;
    },
  ): Promise<RadioResponse> {
    const history = new Set(options?.history ?? []);
    return clientCatalog.getRadio(id, options?.k).then((response) => ({
      items: response.items.filter((item) => !history.has(item.id)),
    }));
  },

  getAlbum(id: string): Promise<ApiAlbumDetails> {
    return clientCatalog.getAlbum(id, () =>
      Promise.reject(
        new ApiError(404, "Album not found in catalog", "ALBUM_NOT_FOUND"),
      ),
    );
  },

  getArtistImage(id: string): Promise<string | undefined> {
    return clientCatalog.getArtistImage(id);
  },

  getArtist(id: string): Promise<ApiArtistDetails> {
    return clientCatalog.getArtist(id, () =>
      Promise.reject(
        new ApiError(404, "Artist not found in catalog", "ARTIST_NOT_FOUND"),
      ),
    );
  },

  getPlaylist(id: string): Promise<ApiCatalogPlaylistDetails> {
    return clientCatalog.getPlaylist(id, async () => {
      const userPl = await api.getUserPlaylist(id);
      return userPl as unknown as ApiCatalogPlaylistDetails;
    });
  },

  async listLikedTracks(
    limit = 100,
    cursor?: string,
  ): Promise<ApiLikedTracksPage> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.listLikedTracks(userId, limit, cursor, token);
  },

  async likeTrack(id: string): Promise<void> {
    if (isLocalTrackId(id)) throw new Error("Local tracks stay on this device");
    const { userId, token } = await getCurrentUserAndToken();
    let track = await clientCatalog.resolveSnapshot(id);
    if (!track) {
      track = (await linerDb.getTrack(id).catch(() => null)) as any;
    }
    return supabaseApi.likeTrack(userId, id, track || { id }, token);
  },

  async unlikeTrack(id: string): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.unlikeTrack(userId, id, token);
  },

  async listSavedCollections(
    type: "albums" | "artists" | "playlists",
  ): Promise<{ items: unknown[] }> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.listSavedCollections(userId, type, token);
  },

  async saveCollection(
    type: "albums" | "artists" | "playlists",
    id: string,
    snapshot?: Record<string, unknown>,
  ): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    let finalSnapshot = snapshot;
    if (!finalSnapshot || Object.keys(finalSnapshot).length === 0) {
      try {
        if (type === "albums") {
          const album = await clientCatalog.getAlbum(id, () =>
            Promise.reject(new Error()),
          );
          if (album) {
            finalSnapshot = {
              id: album.id,
              title: album.title,
              artists: album.artists,
              cover: album.cover,
              year: album.year,
              trackCount: album.tracks?.length || album.trackCount,
            };
          }
        } else if (type === "artists") {
          const artist = await clientCatalog.getArtist(id, () =>
            Promise.reject(new Error()),
          );
          if (artist) {
            finalSnapshot = {
              id: artist.id,
              name: artist.name,
              cover: artist.cover,
            };
          }
        } else if (type === "playlists") {
          const playlist = await api.getPlaylist(id);
          if (playlist) {
            finalSnapshot = {
              id: (playlist as any).playlist?.id || playlist.id,
              title: (playlist as any).playlist?.title || playlist.title,
              author:
                (playlist as any).playlist?.owner?.displayName ||
                playlist.author,
              cover: playlist.cover,
              trackCount:
                (playlist as any).playlist?.trackCount || playlist.trackCount,
            };
          }
        }
      } catch {}
    }
    return supabaseApi.saveCollection(
      userId,
      type,
      id,
      finalSnapshot || { id },
      token,
    );
  },

  async removeCollection(
    type: "albums" | "artists" | "playlists",
    id: string,
  ): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.removeCollection(userId, type, id, token);
  },

  async listPlaylists(): Promise<{ items: ApiUserPlaylist[] }> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.listPlaylists(userId, token);
  },

  async readUserPlaylist(
    id: string,
    options: { limit?: number; etag?: string } = {},
  ): Promise<UserPlaylistRead> {
    const { token } = await getCurrentUserAndToken();
    const data = await supabaseApi.getUserPlaylist(id, token);
    const etag = `rev-${data.playlist.revision}`;
    if (options.etag && options.etag === etag) {
      return { notModified: true };
    }
    const items = options.limit
      ? data.items.slice(0, options.limit)
      : data.items;
    return {
      notModified: false,
      etag,
      partial: options.limit ? options.limit < data.items.length : false,
      trackCount: data.playlist.trackCount ?? data.items.length,
      durationMs: data.items.reduce(
        (sum, item) => sum + (item.track?.durationMs || 0),
        0,
      ),
      playlist: data.playlist,
      items,
    };
  },

  async getUserPlaylist(
    id: string,
  ): Promise<{ playlist: ApiUserPlaylist; items: ApiUserPlaylistItem[] }> {
    const { token } = await getCurrentUserAndToken();
    return supabaseApi.getUserPlaylist(id, token);
  },

  async createPlaylist(input: {
    title: string;
    description?: string;
    isPublic?: boolean;
  }): Promise<ApiUserPlaylist> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.createPlaylist(userId, input, token);
  },

  async updatePlaylist(
    id: string,
    input: { title?: string; description?: string | null; isPublic?: boolean },
  ): Promise<ApiUserPlaylist> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.updatePlaylist(userId, id, input, token);
  },

  async deletePlaylist(id: string): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.deletePlaylist(userId, id, token);
  },

  async addPlaylistTrack(
    playlistId: string,
    trackId: string,
    snapshot?: ApiTrackBase,
  ): Promise<ApiUserPlaylistItem> {
    if (isLocalTrackId(trackId))
      throw new Error("Local tracks stay on this device");
    const { userId, token } = await getCurrentUserAndToken();
    const track =
      snapshot ??
      (await clientCatalog.resolveSnapshot(trackId)) ?? { id: trackId };
    return supabaseApi.addPlaylistTrack(
      userId,
      playlistId,
      trackId,
      track,
      token,
    );
  },

  async addPlaylistTrackSnapshots(
    playlistId: string,
    tracks: ApiTrackBase[],
  ): Promise<{
    items: ApiUserPlaylistItem[];
    added: number;
    rejected: number;
  }> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.addPlaylistTrackSnapshots(
      userId,
      playlistId,
      tracks,
      token,
    );
  },

  async removePlaylistItem(
    playlistId: string,
    itemId: string,
  ): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.removePlaylistItem(userId, playlistId, itemId, token);
  },

  async movePlaylistItem(
    playlistId: string,
    itemId: string,
    beforeItemId: string | null,
    revision: number,
  ): Promise<{ playlist: ApiUserPlaylist; items: ApiUserPlaylistItem[] }> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.movePlaylistItem(
      userId,
      playlistId,
      itemId,
      beforeItemId,
      revision,
      token,
    );
  },

  getPlaylistImport(importId: string): Promise<ImportJob> {
    const job = getLocalImportHandler().getJob(importId);
    return job
      ? Promise.resolve(job)
      : Promise.reject(new ApiError(404, "Import was not found."));
  },

  getPlaylistImportReview(
    importId: string,
  ): Promise<{ items: ImportReview[] }> {
    return Promise.resolve({
      items: getLocalImportHandler().getReview(importId),
    });
  },

  decidePlaylistImportReview(
    importId: string,
    decisions: ImportReviewDecision[],
    tracks?: Track[],
    title?: string,
    description?: string,
  ): Promise<{ approved: string[]; denied: string[]; finalized?: boolean }> {
    return getLocalImportHandler()
      .finalize(importId, tracks ?? [], title, description)
      .then(({ finalized }) => ({
        approved: decisions
          .filter((d) => d.decision === "approve")
          .map((d) => d.reviewId),
        denied: decisions
          .filter((d) => d.decision === "deny")
          .map((d) => d.reviewId),
        finalized,
      }));
  },

  skipPlaylistImportReview(
    importId: string,
    tracks?: Track[],
    title?: string,
    description?: string,
  ): Promise<{ denied: "all"; finalized: boolean }> {
    return getLocalImportHandler()
      .finalize(importId, tracks ?? [], title, description)
      .then(({ finalized }) => ({ denied: "all" as const, finalized }));
  },

  searchLyrics(
    hint: { title: string; artist: string; durationMs?: number },
    signal?: AbortSignal,
  ): Promise<LyricsSearchResult | null> {
    return searchLyricsWithLrclib(hint, signal);
  },

  streamLyrics(
    id: string,
    signal?: AbortSignal,
    hint?: { title: string; artist: string; durationMs?: number },
  ): AsyncGenerator<LyricsStreamEvent> {
    return streamLyricsWithLrclib(id, signal, hint);
  },

  async recordPlaybackEvent(
    payload: RecordPlaybackEventRequest,
  ): Promise<void> {
    const { userId, token } = await getCurrentUserAndToken();
    let trackSnapshot = payload.trackSnapshot;
    if (!trackSnapshot) {
      trackSnapshot = (await linerDb.getTrack(payload.trackId).catch(() => null)) as any;
      if (!trackSnapshot) {
        trackSnapshot = (await clientCatalog
          .resolveSnapshot(payload.trackId)
          .catch(() => null)) as any;
      }
    }
    return supabaseApi.recordPlaybackEvent(
      userId,
      { ...payload, trackSnapshot },
      token,
    );
  },

  async getHistory(
    cursor?: string,
    limit = 30,
  ): Promise<PlaybackHistoryResponse> {
    const { userId, token } = await getCurrentUserAndToken();
    return supabaseApi.getHistory(userId, cursor, limit, token);
  },

  async getPopularTracks(
    window: PopularTimeWindow = "7d",
    limit = 50,
  ): Promise<PopularTracksResponse> {
    const history = await api.getHistory(undefined, 50).catch(() => ({ items: [] }));
    const catalogSearch = await clientCatalog
      .search("top hits", "track", () => Promise.resolve({ items: [] }))
      .catch(() => ({ items: [] }));

    const trackMap = new Map<string, { track: Track; playCount: number }>();

    for (const h of history.items) {
      if (h.track?.id) {
        const contractT = toContractTrack(h.track);
        const existing = trackMap.get(contractT.id) || {
          track: contractT,
          playCount: 0,
        };
        existing.playCount += 1;
        trackMap.set(contractT.id, existing);
      }
    }

    for (const item of catalogSearch.items) {
      if (item && "id" in item && !trackMap.has(item.id)) {
        const contractT = toContractTrack(item as any);
        trackMap.set(contractT.id, { track: contractT, playCount: 1 });
      }
    }

    const sorted = Array.from(trackMap.values())
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, limit);

    return {
      window,
      generatedAt: new Date().toISOString(),
      items: sorted.map((entry, idx) => ({
        rank: idx + 1,
        track: entry.track,
        playCount: entry.playCount,
        uniqueListeners: entry.playCount,
        score: entry.playCount * 10,
      })),
    };
  },

  async getPopularAlbums(
    window: PopularTimeWindow = "7d",
    limit = 20,
  ): Promise<PopularAlbumsResponse> {
    const searchRes = await clientCatalog
      .search("popular albums", "album", () => Promise.resolve({ items: [] }))
      .catch(() => ({ items: [] }));
    const savedRes = await api
      .listSavedCollections("albums")
      .catch(() => ({ items: [] }));

    const albumMap = new Map<string, any>();

    for (const entry of savedRes.items as any[]) {
      const alb = entry.album;
      if (alb?.id) {
        albumMap.set(alb.id, alb);
      }
    }

    for (const it of searchRes.items) {
      if (it && "id" in it && !albumMap.has(it.id)) {
        albumMap.set(it.id, it);
      }
    }

    const items = Array.from(albumMap.values())
      .slice(0, limit)
      .map((a) => {
        const trackCount =
          a.trackCount && a.trackCount >= 5 ? a.trackCount : 10;
        const artistName =
          a.author ||
          (Array.isArray(a.artists)
            ? a.artists
                .map((art: any) =>
                  typeof art === "string" ? art : art.name,
                )
                .join(", ")
            : typeof a.artist === "string"
              ? a.artist
              : "Popular Artist");

        return {
          id: a.id,
          title: a.title || "Album",
          artist: artistName,
          artists: Array.isArray(a.artists)
            ? a.artists
            : [{ id: "artist_0", name: artistName }],
          coverUrl: a.cover?.url || a.coverUrl || null,
          year: a.year || new Date().getFullYear(),
          playCount: 100,
          uniqueListeners: 50,
          trackCount,
          score: 100,
        };
      });

    return {
      window,
      items,
    };
  },

  async getMostSaved(
    type: MostSavedType = "all",
    limit = 20,
  ): Promise<MostSavedResponse> {
    const [savedAlbums, savedPlaylists] = await Promise.all([
      type === "playlist"
        ? Promise.resolve({ items: [] })
        : api.listSavedCollections("albums").catch(() => ({ items: [] })),
      type === "album"
        ? Promise.resolve({ items: [] })
        : api.listSavedCollections("playlists").catch(() => ({ items: [] })),
    ]);

    const entries: any[] = [];

    for (const item of savedAlbums.items as any[]) {
      const alb = item.album;
      if (alb?.id) {
        entries.push({
          type: "album" as const,
          id: alb.id,
          title: alb.title || "Album",
          subtitle: alb.author || "Album",
          artists: alb.artists,
          coverUrl: alb.cover?.url || alb.coverUrl || null,
          saves: 10,
        });
      }
    }

    for (const item of savedPlaylists.items as any[]) {
      const pl = item.playlist;
      if (pl?.id) {
        entries.push({
          type: "playlist" as const,
          id: pl.id,
          title: pl.title || "Playlist",
          subtitle: pl.author || "Playlist",
          coverUrl: pl.cover?.url || pl.coverUrl || null,
          saves: 10,
        });
      }
    }

    if (entries.length < limit) {
      const searchRes = await clientCatalog
        .search("popular playlists", "playlist", () =>
          Promise.resolve({ items: [] }),
        )
        .catch(() => ({ items: [] }));
      for (const it of searchRes.items) {
        if (it && "id" in it && !entries.some((e) => e.id === it.id)) {
          entries.push({
            type: "playlist" as const,
            id: it.id,
            title: (it as any).title || "Playlist",
            subtitle: (it as any).author || "Playlist",
            coverUrl: (it as any).cover?.url || (it as any).coverUrl || null,
            saves: 5,
          });
          if (entries.length >= limit) break;
        }
      }
    }

    return {
      type,
      items: entries.slice(0, limit),
    };
  },

  async getDailyMixes(): Promise<DailyMixesResponse> {
    const { userId } = await getCurrentUserAndToken();
    const now = Date.now();
    if (
      cachedDailyMixes &&
      cachedDailyMixes.userId === userId &&
      now - cachedDailyMixes.timestamp < DAILY_MIX_CACHE_TTL_MS
    ) {
      return cachedDailyMixes.response;
    }

    const historyRes = await api
      .getHistory(undefined, 20)
      .catch(() => ({ items: [] }));
    const likesRes = await api
      .listLikedTracks(20)
      .catch(() => ({ items: [] }));

    const seedCandidates: Track[] = [];
    const seenTrackIds = new Set<string>();

    for (const h of historyRes.items) {
      if (h.track?.id && !seenTrackIds.has(h.track.id)) {
        seenTrackIds.add(h.track.id);
        seedCandidates.push(toContractTrack(h.track));
      }
    }
    for (const l of likesRes.items) {
      if (l.track?.id && !seenTrackIds.has(l.track.id)) {
        seenTrackIds.add(l.track.id);
        seedCandidates.push(toContractTrack(l.track));
      }
    }

    if (seedCandidates.length < 4) {
      const fallbackQueries = [
        "Chill Hits",
        "Top Global Hits",
        "Electronic Vibes",
        "Acoustic Pop",
      ];
      const searchPromises = fallbackQueries.map((q) =>
        clientCatalog
          .search(q, "track", () => Promise.resolve({ items: [] }))
          .catch(() => ({ items: [] })),
      );
      const searchResults = await Promise.all(searchPromises);
      for (const res of searchResults) {
        for (const item of res.items) {
          if (item && "id" in item && !seenTrackIds.has(item.id)) {
            seenTrackIds.add(item.id);
            seedCandidates.push(toContractTrack(item as any));
            break;
          }
        }
      }
    }

    const seeds = seedCandidates.slice(0, 4);
    if (seeds.length === 0) {
      const searchRes = await clientCatalog
        .search("Popular", "track", () => Promise.resolve({ items: [] }))
        .catch(() => ({ items: [] }));
      for (const item of searchRes.items) {
        if (item && "id" in item) {
          seeds.push(toContractTrack(item as any));
          if (seeds.length >= 4) break;
        }
      }
    }

    const mixPromises = seeds.map(async (seed, idx) => {
      const radio = await clientCatalog
        .getRadio(seed.id, 25)
        .catch(() => ({ items: [] }));
      const tracks: Track[] = (radio.items || [])
        .filter((t) => t && t.id)
        .map((t) => toContractTrack(t as any));

      if (tracks.length === 0 && seed) {
        tracks.push(seed);
      }

      const clusterArtists: string[] = Array.from(
        new Set(
          tracks
            .flatMap((t) => t.artists.map((a) => a.name))
            .filter(Boolean),
        ),
      ).slice(0, 5);

      const coverUrl = seed.cover?.url || tracks[0]?.cover?.url || "";
      const cover: Cover | undefined = coverUrl
        ? { url: coverUrl, width: 500, height: 500 }
        : undefined;

      return {
        id: `daily-mix-${idx + 1}`,
        title: `Daily Mix ${idx + 1}`,
        description:
          clusterArtists.length > 0
            ? clusterArtists.join(", ")
            : "Personalized daily playlist",
        clusterArtists,
        cover,
        trackCount: tracks.length,
        tracks,
      };
    });

    const mixItems = await Promise.all(mixPromises);
    const response: DailyMixesResponse = {
      items: mixItems,
      generatedAt: new Date().toISOString(),
    };

    cachedDailyMixes = {
      timestamp: now,
      userId,
      response,
    };

    return response;
  },
};
