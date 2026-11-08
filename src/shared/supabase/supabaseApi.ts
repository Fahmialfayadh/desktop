import type {
  AuthTokens,
  PublicUser,
  UserProfile,
  UpdateProfileInput,
  PlaybackHistoryResponse,
  RecordPlaybackEventRequest,
  LeaderboardResponse,
} from "@/shared/contracts";
import type {
  ApiUserPlaylist,
  ApiUserPlaylistItem,
  ApiLikedTracksPage,
} from "@/shared/contracts/playlists";
import { isSupabaseConfigured, supabaseAuthRequest, supabaseRestRequest } from "./client";
import { localFallbackApi } from "./localFallback";
import type {
  ProfileRow,
  UserFollowRow,
  PlaylistRow,
  PlaylistItemRow,
  LikedTrackRow,
  SavedCollectionRow,
  PlaybackHistoryRow,
} from "./types";
import { ApiError } from "@/shared/api/ApiError";

function profileToPublicUser(row: ProfileRow): PublicUser {
  return {
    id: row.id,
    email: row.email || undefined,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isPublic: row.is_public,
    showActivity: row.show_activity,
    showHistory: row.show_history,
    showLikedTracks: row.show_liked_tracks,
    participateLeaderboards: row.participate_leaderboards,
  };
}

function normalizeSnapshot(
  snapshot: any,
  id: string,
  singularType: "album" | "artist" | "playlist",
): any {
  const val = snapshot || {};
  const title = val.title || val.name || "Untitled";
  const coverUrl = val.coverUrl || (val.cover?.url ?? "");
  const cover = val.cover ?? (coverUrl ? { url: coverUrl } : undefined);
  return {
    id: val.id || id,
    title: singularType === "artist" ? undefined : title,
    name: singularType === "artist" ? title : undefined,
    cover,
    coverUrl: coverUrl || undefined,
    author:
      val.author ||
      (Array.isArray(val.artists)
        ? val.artists.map((a: any) => (typeof a === "string" ? a : a.name)).join(", ")
        : undefined),
    year: val.year,
    trackCount: val.trackCount ?? val.totalTracks,
    ...val,
  };
}

function normalizePlaylistTrackSnapshot(track: any): any {
  if (!track || typeof track !== "object") return track;
  const cover = track.cover ?? (track.coverUrl ? { url: track.coverUrl } : undefined);
  return {
    ...track,
    cover,
  };
}

export const supabaseApi = {
  async login(email: string, password: string): Promise<AuthTokens> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.login(email);
    }

    const authRes = await supabaseAuthRequest<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      expires_at?: number;
      user: { id: string; email?: string; user_metadata?: Record<string, any> };
    }>("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    });

    const token = authRes.access_token;
    const userId = authRes.user.id;

    // Fetch or create profile
    let profiles = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
      {},
      token,
    ).catch(() => [] as ProfileRow[]);

    let profile: ProfileRow;
    const now = new Date().toISOString();
    if (!profiles || profiles.length === 0) {
      const inserted = await supabaseRestRequest<ProfileRow[]>(
        "/profiles",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            id: userId,
            email: authRes.user.email || email,
            username: authRes.user.user_metadata?.username || email.split("@")[0],
            display_name: authRes.user.user_metadata?.display_name || email.split("@")[0],
            created_at: now,
            updated_at: now,
          }),
        },
        token,
      );
      profile = inserted[0];
    } else {
      profile = profiles[0];
    }

    const expiresAtMs = authRes.expires_at
      ? authRes.expires_at * 1000
      : Date.now() + (authRes.expires_in || 3600) * 1000;

    return {
      accessToken: token,
      refreshToken: authRes.refresh_token,
      accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
      expiresAt: expiresAtMs,
      user: profileToPublicUser(profile),
    };
  },

  async register(
    email: string,
    password: string,
    username: string,
    displayName: string,
  ): Promise<AuthTokens> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.register(email, username, displayName);
    }

    const authRes = await supabaseAuthRequest<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      expires_at?: number;
      user: { id: string; email?: string };
      session?: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        expires_at?: number;
      } | null;
    }>("/signup", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim(),
        password,
        data: {
          username: username.trim().toLowerCase(),
          display_name: displayName.trim(),
        },
      }),
    });

    const token = authRes.session?.access_token || authRes.access_token;
    const refreshToken = authRes.session?.refresh_token || authRes.refresh_token;
    const expiresIn = authRes.session?.expires_in || authRes.expires_in || 3600;
    const expiresAt = authRes.session?.expires_at || authRes.expires_at;

    if (!token) {
      throw new ApiError(
        400,
        "Account created. Please check your email to confirm your account before signing in.",
        "EMAIL_NOT_CONFIRMED",
      );
    }

    const userId = authRes.user.id;
    const now = new Date().toISOString();

    const profiles = await supabaseRestRequest<ProfileRow[]>(
      "/profiles",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          id: userId,
          email: email.trim().toLowerCase(),
          username: username.trim().toLowerCase(),
          display_name: displayName.trim(),
          created_at: now,
          updated_at: now,
        }),
      },
      token,
    );

    const profile = profiles[0] || {
      id: userId,
      email,
      username,
      display_name: displayName,
      avatar_url: null,
      bio: null,
      is_public: true,
      show_activity: true,
      show_history: true,
      show_liked_tracks: true,
      participate_leaderboards: true,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    };

    const expiresAtMs = expiresAt
      ? expiresAt * 1000
      : Date.now() + expiresIn * 1000;

    return {
      accessToken: token,
      refreshToken: refreshToken || "",
      accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
      expiresAt: expiresAtMs,
      user: profileToPublicUser(profile),
    };
  },

  async refresh(refreshToken: string): Promise<AuthTokens | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }
    const res = await supabaseAuthRequest<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      expires_at?: number;
      user: { id: string; email?: string };
    }>("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const token = res.access_token;
    const userId = res.user.id;
    const profiles = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
      {},
      token,
    ).catch(() => [] as ProfileRow[]);

    const profile = profiles[0];
    const expiresAtMs = res.expires_at
      ? res.expires_at * 1000
      : Date.now() + (res.expires_in || 3600) * 1000;

    return {
      accessToken: token,
      refreshToken: res.refresh_token,
      accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
      expiresAt: expiresAtMs,
      user: profile ? profileToPublicUser(profile) : { id: userId, email: res.user.email },
    };
  },

  async logout(accessToken?: string): Promise<void> {
    if (!isSupabaseConfigured() || !accessToken) return;
    await supabaseAuthRequest<void>("/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  },

  async getMe(userId: string, token?: string): Promise<PublicUser> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getMe(userId);
    }
    const rows = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
      {},
      token,
    );
    if (!rows || rows.length === 0) {
      throw new ApiError(404, "User profile not found", "PROFILE_NOT_FOUND");
    }
    return profileToPublicUser(rows[0]);
  },

  async updateProfile(
    userId: string,
    data: UpdateProfileInput,
    token?: string,
  ): Promise<PublicUser> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.updateProfile(userId, data);
    }
    const patch: Partial<ProfileRow> = {
      updated_at: new Date().toISOString(),
    };
    if (data.username !== undefined) patch.username = data.username;
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (data.avatarUrl !== undefined) patch.avatar_url = data.avatarUrl;
    if (data.bio !== undefined) patch.bio = data.bio;
    if (data.isPublic !== undefined) patch.is_public = data.isPublic;
    if (data.showActivity !== undefined) patch.show_activity = data.showActivity;
    if (data.showHistory !== undefined) patch.show_history = data.showHistory;
    if (data.showLikedTracks !== undefined) patch.show_liked_tracks = data.showLikedTracks;
    if (data.participateLeaderboards !== undefined) {
      patch.participate_leaderboards = data.participateLeaderboards;
    }

    const rows = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
      token,
    );

    return profileToPublicUser(rows[0]);
  },

  async getUserProfile(
    idOrUsername: string,
    currentUserId?: string,
    token?: string,
  ): Promise<UserProfile> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getUserProfile(idOrUsername, currentUserId);
    }

    const clean = idOrUsername.trim();
    const rows = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?or=(id.eq.${encodeURIComponent(clean)},username.ilike.${encodeURIComponent(clean)})&select=*`,
      {},
      token,
    );

    if (!rows || rows.length === 0) {
      throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    }
    const profile = rows[0];

    const [followers, following] = await Promise.all([
      supabaseRestRequest<UserFollowRow[]>(
        `/user_follows?following_id=eq.${encodeURIComponent(profile.id)}&select=follower_id`,
        {},
        token,
      ).catch(() => [] as UserFollowRow[]),
      supabaseRestRequest<UserFollowRow[]>(
        `/user_follows?follower_id=eq.${encodeURIComponent(profile.id)}&select=following_id`,
        {},
        token,
      ).catch(() => [] as UserFollowRow[]),
    ]);

    const isFollowing = currentUserId
      ? followers.some((f) => f.follower_id === currentUserId)
      : false;

    return {
      id: profile.id,
      email: profile.email || undefined,
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      bio: profile.bio,
      isPublic: profile.is_public,
      showActivity: profile.show_activity,
      showHistory: profile.show_history,
      showLikedTracks: profile.show_liked_tracks,
      participateLeaderboards: profile.participate_leaderboards,
      followersCount: followers.length,
      followingCount: following.length,
      isFollowing,
      createdAt: profile.created_at,
      privacy: {
        isPublic: profile.is_public,
        showActivity: profile.show_activity,
        showHistory: profile.show_history,
        showLikedTracks: profile.show_liked_tracks,
        participateLeaderboards: profile.participate_leaderboards,
      },
    };
  },

  async searchUsers(query: string, token?: string): Promise<UserProfile[]> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.searchUsers(query);
    }
    const q = query.trim();
    if (!q) return [];
    const rows = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?or=(username.ilike.*${encodeURIComponent(q)}*,display_name.ilike.*${encodeURIComponent(q)}*)&limit=20&select=*`,
      {},
      token,
    );
    return rows.map((p) => ({
      id: p.id,
      email: p.email || undefined,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      bio: p.bio,
      isPublic: p.is_public,
      showActivity: p.show_activity,
      showHistory: p.show_history,
      showLikedTracks: p.show_liked_tracks,
      participateLeaderboards: p.participate_leaderboards,
      followersCount: 0,
      followingCount: 0,
      createdAt: p.created_at,
    }));
  },

  async followUser(
    currentUserId: string,
    targetIdOrUsername: string,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.followUser(currentUserId, targetIdOrUsername);
    }
    const target = await this.getUserProfile(targetIdOrUsername, currentUserId, token);
    if (target.id === currentUserId) return;

    await supabaseRestRequest(
      "/user_follows",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          follower_id: currentUserId,
          following_id: target.id,
          created_at: new Date().toISOString(),
        }),
      },
      token,
    );
  },

  async unfollowUser(
    currentUserId: string,
    targetIdOrUsername: string,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.unfollowUser(currentUserId, targetIdOrUsername);
    }
    const target = await this.getUserProfile(targetIdOrUsername, currentUserId, token);
    await supabaseRestRequest(
      `/user_follows?follower_id=eq.${encodeURIComponent(currentUserId)}&following_id=eq.${encodeURIComponent(target.id)}`,
      { method: "DELETE" },
      token,
    );
  },

  async getUserFollowers(
    idOrUsername: string,
    currentUserId?: string,
    token?: string,
  ): Promise<UserProfile[]> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getUserFollowers(idOrUsername, currentUserId);
    }
    const target = await this.getUserProfile(idOrUsername, currentUserId, token);
    const follows = await supabaseRestRequest<UserFollowRow[]>(
      `/user_follows?following_id=eq.${encodeURIComponent(target.id)}&select=follower_id`,
      {},
      token,
    );
    if (!follows || follows.length === 0) return [];
    const ids = follows.map((f) => f.follower_id);
    const profiles = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=in.(${ids.map(encodeURIComponent).join(",")})&select=*`,
      {},
      token,
    );
    return profiles.map((p) => ({
      id: p.id,
      email: p.email || undefined,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      bio: p.bio,
      isPublic: p.is_public,
      showActivity: p.show_activity,
      showHistory: p.show_history,
      showLikedTracks: p.show_liked_tracks,
      participateLeaderboards: p.participate_leaderboards,
      followersCount: 0,
      followingCount: 0,
      createdAt: p.created_at,
    }));
  },

  async getUserFollowing(
    idOrUsername: string,
    currentUserId?: string,
    token?: string,
  ): Promise<UserProfile[]> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getUserFollowing(idOrUsername, currentUserId);
    }
    const target = await this.getUserProfile(idOrUsername, currentUserId, token);
    const follows = await supabaseRestRequest<UserFollowRow[]>(
      `/user_follows?follower_id=eq.${encodeURIComponent(target.id)}&select=following_id`,
      {},
      token,
    );
    if (!follows || follows.length === 0) return [];
    const ids = follows.map((f) => f.following_id);
    const profiles = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=in.(${ids.map(encodeURIComponent).join(",")})&select=*`,
      {},
      token,
    );
    return profiles.map((p) => ({
      id: p.id,
      email: p.email || undefined,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      bio: p.bio,
      isPublic: p.is_public,
      showActivity: p.show_activity,
      showHistory: p.show_history,
      showLikedTracks: p.show_liked_tracks,
      participateLeaderboards: p.participate_leaderboards,
      followersCount: 0,
      followingCount: 0,
      createdAt: p.created_at,
    }));
  },

  async getUserPlaylists(
    idOrUsername: string,
    token?: string,
  ): Promise<{ items: ApiUserPlaylist[] }> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getUserPlaylists(idOrUsername);
    }
    const target = await this.getUserProfile(idOrUsername, undefined, token);
    const playlists = await supabaseRestRequest<PlaylistRow[]>(
      `/playlists?owner_id=eq.${encodeURIComponent(target.id)}&select=*&order=created_at.desc`,
      {},
      token,
    );

    return {
      items: playlists.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || undefined,
        isPublic: p.is_public,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        revision: p.revision,
        trackCount: p.track_count,
        coverUrls: p.cover_urls || undefined,
        ownerId: p.owner_id,
        owner: {
          id: target.id,
          username: target.username,
          displayName: target.displayName,
          avatarUrl: target.avatarUrl,
        },
      })),
    };
  },

  async getUserHistory(
    idOrUsername: string,
    cursor?: string,
    limit = "30",
    token?: string,
  ): Promise<PlaybackHistoryResponse> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getUserHistory(idOrUsername, cursor, limit);
    }
    const target = await this.getUserProfile(idOrUsername, undefined, token);
    const max = parseInt(limit, 10) || 30;
    let path = `/playback_history?owner_id=eq.${encodeURIComponent(target.id)}&select=*&order=listened_at.desc&limit=${max + 1}`;
    if (cursor) {
      path += `&listened_at=lt.${encodeURIComponent(cursor)}`;
    }
    const rows = await supabaseRestRequest<PlaybackHistoryRow[]>(path, {}, token);
    const hasMore = rows.length > max;
    const slice = rows.slice(0, max);
    const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].listened_at : null;

    return {
      items: slice.map((h) => ({
        id: h.id,
        playbackSessionId: h.playback_session_id,
        listeningSessionId: h.listening_session_id,
        track: h.track_snapshot,
        playedDurationMs: h.played_duration_ms,
        completionRate: h.completion_rate,
        completed: h.completed,
        skipped: h.skipped,
        loopCount: h.loop_count,
        hasSeekBackward: h.has_seek_backward,
        context: h.context,
        listenedAt: h.listened_at,
      })),
      nextCursor,
    };
  },

  async getArtistLeaderboard(
    artistId: string,
    period = "monthly",
    limit = 10,
    token?: string,
  ): Promise<LeaderboardResponse> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getArtistLeaderboard(artistId, period, limit);
    }
    const history = await supabaseRestRequest<PlaybackHistoryRow[]>(
      `/playback_history?select=*&limit=1000&order=listened_at.desc`,
      {},
      token,
    ).catch(() => [] as PlaybackHistoryRow[]);

    const playsByUser = new Map<string, { durationMs: number; count: number }>();
    for (const h of history) {
      const track = h.track_snapshot;
      const match =
        track?.artistId === artistId ||
        (Array.isArray(track?.artists) &&
          track.artists.some((a: any) => a.id === artistId || a.name === artistId)) ||
        (typeof track?.artists === "string" && track.artists.includes(artistId));
      if (!match) continue;

      const current = playsByUser.get(h.owner_id) || { durationMs: 0, count: 0 };
      current.durationMs += h.played_duration_ms || 0;
      current.count += 1;
      playsByUser.set(h.owner_id, current);
    }

    const topEntries = Array.from(playsByUser.entries())
      .sort((a, b) => b[1].durationMs - a[1].durationMs)
      .slice(0, limit);

    const userIds = topEntries.map(([uid]) => uid);
    let profiles: ProfileRow[] = [];
    if (userIds.length > 0) {
      profiles = await supabaseRestRequest<ProfileRow[]>(
        `/profiles?id=in.(${userIds.map(encodeURIComponent).join(",")})&select=*`,
        {},
        token,
      ).catch(() => []);
    }

    const entries = topEntries.map(([userId, stats], idx) => {
      const p = profiles.find((pr) => pr.id === userId);
      return {
        rank: idx + 1,
        user: {
          id: userId,
          username: p?.username || "user",
          displayName: p?.display_name || "User",
          avatarUrl: p?.avatar_url || null,
        },
        playedDurationMs: stats.durationMs,
        playCount: stats.count,
      };
    });

    return {
      type: "artist",
      targetId: artistId,
      period: period as any,
      entries,
      updatedAt: new Date().toISOString(),
    };
  },

  async getGlobalLeaderboard(
    period = "weekly",
    limit = 20,
    token?: string,
  ): Promise<LeaderboardResponse> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getGlobalLeaderboard(period, limit);
    }
    const history = await supabaseRestRequest<PlaybackHistoryRow[]>(
      `/playback_history?select=*&limit=2000&order=listened_at.desc`,
      {},
      token,
    ).catch(() => [] as PlaybackHistoryRow[]);

    const playsByUser = new Map<string, { durationMs: number; count: number }>();
    for (const h of history) {
      const current = playsByUser.get(h.owner_id) || { durationMs: 0, count: 0 };
      current.durationMs += h.played_duration_ms || 0;
      current.count += 1;
      playsByUser.set(h.owner_id, current);
    }

    const topEntries = Array.from(playsByUser.entries())
      .sort((a, b) => b[1].durationMs - a[1].durationMs)
      .slice(0, limit);

    const userIds = topEntries.map(([uid]) => uid);
    let profiles: ProfileRow[] = [];
    if (userIds.length > 0) {
      profiles = await supabaseRestRequest<ProfileRow[]>(
        `/profiles?id=in.(${userIds.map(encodeURIComponent).join(",")})&select=*`,
        {},
        token,
      ).catch(() => []);
    }

    const entries = topEntries.map(([userId, stats], idx) => {
      const p = profiles.find((pr) => pr.id === userId);
      return {
        rank: idx + 1,
        user: {
          id: userId,
          username: p?.username || "user",
          displayName: p?.display_name || "User",
          avatarUrl: p?.avatar_url || null,
        },
        playedDurationMs: stats.durationMs,
        playCount: stats.count,
      };
    });

    return {
      type: "global",
      targetId: "global",
      period: period as any,
      entries,
      updatedAt: new Date().toISOString(),
    };
  },

  async listLikedTracks(
    userId: string,
    limit = 100,
    cursor?: string,
    token?: string,
  ): Promise<ApiLikedTracksPage> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.listLikedTracks(userId, limit, cursor);
    }
    let path = `/liked_tracks?owner_id=eq.${encodeURIComponent(userId)}&select=*&order=liked_at.desc&limit=${limit + 1}`;
    if (cursor) {
      path += `&liked_at=lt.${encodeURIComponent(cursor)}`;
    }
    const rows = await supabaseRestRequest<LikedTrackRow[]>(path, {}, token);
    const hasMore = rows.length > limit;
    const slice = rows.slice(0, limit);
    const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].liked_at : null;

    return {
      items: slice.map((l) => ({
        track: l.track_snapshot,
        likedAt: l.liked_at,
      })),
      nextCursor,
    };
  },

  async likeTrack(
    userId: string,
    trackId: string,
    trackSnapshot: any,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.likeTrack(userId, trackId, trackSnapshot);
    }
    await supabaseRestRequest(
      "/liked_tracks?on_conflict=owner_id,track_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          owner_id: userId,
          track_id: trackId,
          track_snapshot: trackSnapshot,
          liked_at: new Date().toISOString(),
        }),
      },
      token,
    );
  },

  async unlikeTrack(userId: string, trackId: string, token?: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.unlikeTrack(userId, trackId);
    }
    await supabaseRestRequest(
      `/liked_tracks?owner_id=eq.${encodeURIComponent(userId)}&track_id=eq.${encodeURIComponent(trackId)}`,
      { method: "DELETE" },
      token,
    );
  },

  async listSavedCollections(
    userId: string,
    type: "albums" | "artists" | "playlists",
    token?: string,
  ): Promise<{ items: any[] }> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.listSavedCollections(userId, type);
    }
    const singular = type === "albums" ? "album" : type === "artists" ? "artist" : "playlist";
    const rows = await supabaseRestRequest<SavedCollectionRow[]>(
      `/saved_collections?owner_id=eq.${encodeURIComponent(userId)}&collection_type=eq.${encodeURIComponent(type)}&select=*&order=saved_at.desc`,
      {},
      token,
    );

    return {
      items: rows.map((r) => ({
        [singular]: normalizeSnapshot(r.snapshot, r.collection_id, singular),
        savedAt: r.saved_at,
      })),
    };
  },

  async saveCollection(
    userId: string,
    type: "albums" | "artists" | "playlists",
    collectionId: string,
    snapshot: any,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.saveCollection(userId, type, collectionId, snapshot);
    }
    await supabaseRestRequest(
      "/saved_collections?on_conflict=owner_id,collection_type,collection_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          owner_id: userId,
          collection_type: type,
          collection_id: collectionId,
          snapshot,
          saved_at: new Date().toISOString(),
        }),
      },
      token,
    );
  },

  async removeCollection(
    userId: string,
    type: "albums" | "artists" | "playlists",
    collectionId: string,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.removeCollection(userId, type, collectionId);
    }
    await supabaseRestRequest(
      `/saved_collections?owner_id=eq.${encodeURIComponent(userId)}&collection_type=eq.${encodeURIComponent(type)}&collection_id=eq.${encodeURIComponent(collectionId)}`,
      { method: "DELETE" },
      token,
    );
  },

  async listPlaylists(userId: string, token?: string): Promise<{ items: ApiUserPlaylist[] }> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.listPlaylists(userId);
    }
    const [playlists, profiles] = await Promise.all([
      supabaseRestRequest<PlaylistRow[]>(
        `/playlists?owner_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`,
        {},
        token,
      ),
      supabaseRestRequest<ProfileRow[]>(
        `/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
        {},
        token,
      ).catch(() => [] as ProfileRow[]),
    ]);
    const owner = profiles[0];

    return {
      items: playlists.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || undefined,
        isPublic: p.is_public,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        revision: p.revision,
        trackCount: p.track_count,
        coverUrls: p.cover_urls || undefined,
        ownerId: p.owner_id,
        owner: owner
          ? {
              id: owner.id,
              username: owner.username,
              displayName: owner.display_name,
              avatarUrl: owner.avatar_url,
            }
          : undefined,
      })),
    };
  },

  async getUserPlaylist(
    playlistId: string,
    token?: string,
  ): Promise<{ playlist: ApiUserPlaylist; items: ApiUserPlaylistItem[] }> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.getUserPlaylist(playlistId);
    }
    const [playlists, items] = await Promise.all([
      supabaseRestRequest<PlaylistRow[]>(
        `/playlists?id=eq.${encodeURIComponent(playlistId)}&select=*`,
        {},
        token,
      ),
      supabaseRestRequest<PlaylistItemRow[]>(
        `/playlist_items?playlist_id=eq.${encodeURIComponent(playlistId)}&select=*&order=position.asc`,
        {},
        token,
      ),
    ]);

    if (!playlists || playlists.length === 0) {
      throw new ApiError(404, "Playlist not found", "PLAYLIST_NOT_FOUND");
    }
    const playlist = playlists[0];
    const profiles = await supabaseRestRequest<ProfileRow[]>(
      `/profiles?id=eq.${encodeURIComponent(playlist.owner_id)}&select=*`,
      {},
      token,
    ).catch(() => [] as ProfileRow[]);
    const owner = profiles[0];

    return {
      playlist: {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description || undefined,
        isPublic: playlist.is_public,
        createdAt: playlist.created_at,
        updatedAt: playlist.updated_at,
        revision: playlist.revision,
        trackCount: items.length,
        coverUrls: playlist.cover_urls || undefined,
        ownerId: playlist.owner_id,
        owner: owner
          ? {
              id: owner.id,
              username: owner.username,
              displayName: owner.display_name,
              avatarUrl: owner.avatar_url,
            }
          : undefined,
      },
      items: items.map((i) => ({
        id: i.id,
        track: i.track_snapshot,
        position: i.position,
        addedAt: i.added_at,
      })),
    };
  },

  async createPlaylist(
    userId: string,
    input: { title: string; description?: string; isPublic?: boolean },
    token?: string,
  ): Promise<ApiUserPlaylist> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.createPlaylist(userId, input);
    }
    const now = new Date().toISOString();
    const rows = await supabaseRestRequest<PlaylistRow[]>(
      "/playlists",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          owner_id: userId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          is_public: input.isPublic ?? false,
          revision: 1,
          track_count: 0,
          duration_ms: 0,
          cover_urls: [],
          created_at: now,
          updated_at: now,
        }),
      },
      token,
    );
    const p = rows[0];
    return {
      id: p.id,
      title: p.title,
      description: p.description || undefined,
      isPublic: p.is_public,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      revision: p.revision,
      trackCount: 0,
      coverUrls: [],
      ownerId: userId,
    };
  },

  async updatePlaylist(
    userId: string,
    playlistId: string,
    input: { title?: string; description?: string | null; isPublic?: boolean },
    token?: string,
  ): Promise<ApiUserPlaylist> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.updatePlaylist(userId, playlistId, input);
    }
    const current = await this.getUserPlaylist(playlistId, token);
    const patch: Record<string, any> = {
      revision: current.playlist.revision + 1,
      updated_at: new Date().toISOString(),
    };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.isPublic !== undefined) patch.is_public = input.isPublic;

    const rows = await supabaseRestRequest<PlaylistRow[]>(
      `/playlists?id=eq.${encodeURIComponent(playlistId)}&owner_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
      token,
    );
    const p = rows[0];
    return {
      id: p.id,
      title: p.title,
      description: p.description || undefined,
      isPublic: p.is_public,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      revision: p.revision,
      trackCount: p.track_count,
      coverUrls: p.cover_urls || undefined,
      ownerId: p.owner_id,
    };
  },

  async deletePlaylist(userId: string, playlistId: string, token?: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.deletePlaylist(userId, playlistId);
    }
    await supabaseRestRequest(
      `/playlist_items?playlist_id=eq.${encodeURIComponent(playlistId)}`,
      { method: "DELETE" },
      token,
    ).catch(() => {});

    await supabaseRestRequest(
      `/playlists?id=eq.${encodeURIComponent(playlistId)}&owner_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE" },
      token,
    );
  },

  async addPlaylistTrack(
    userId: string,
    playlistId: string,
    trackId: string,
    snapshot: any,
    token?: string,
  ): Promise<ApiUserPlaylistItem> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.addPlaylistTrack(userId, playlistId, trackId, snapshot);
    }
    const current = await this.getUserPlaylist(playlistId, token);
    const nextPosition = current.items.length > 0
      ? current.items[current.items.length - 1].position + 1
      : 0;

    const normalizedSnapshot = normalizePlaylistTrackSnapshot(snapshot);
    const now = new Date().toISOString();
    const inserted = await supabaseRestRequest<PlaylistItemRow[]>(
      "/playlist_items",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          playlist_id: playlistId,
          owner_id: userId,
          track_id: trackId,
          track_snapshot: normalizedSnapshot,
          position: nextPosition,
          added_at: now,
        }),
      },
      token,
    );
    const item = inserted[0];

    const allItems = [...current.items, { ...item, track: normalizedSnapshot }];
    const coverSet = new Set<string>();
    for (const it of allItems) {
      const url = it.track?.cover?.url || it.track?.coverUrl;
      if (url && typeof url === "string") coverSet.add(url);
      if (coverSet.size >= 4) break;
    }

    await supabaseRestRequest(
      `/playlists?id=eq.${encodeURIComponent(playlistId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          track_count: allItems.length,
          duration_ms: allItems.reduce((acc, it) => acc + (it.track?.durationMs || 0), 0),
          cover_urls: Array.from(coverSet),
          revision: current.playlist.revision + 1,
          updated_at: now,
        }),
      },
      token,
    ).catch(() => {});

    return {
      id: item.id,
      track: item.track_snapshot,
      position: item.position,
      addedAt: item.added_at,
    };
  },

  async addPlaylistTrackSnapshots(
    userId: string,
    playlistId: string,
    tracks: any[],
    token?: string,
  ): Promise<{ items: ApiUserPlaylistItem[]; added: number; rejected: number }> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.addPlaylistTrackSnapshots(userId, playlistId, tracks);
    }
    const current = await this.getUserPlaylist(playlistId, token);
    let nextPos = current.items.length > 0
      ? current.items[current.items.length - 1].position + 1
      : 0;
    const now = new Date().toISOString();
    const rows = tracks.filter((t) => t && t.id).map((t) => ({
      playlist_id: playlistId,
      owner_id: userId,
      track_id: t.id,
      track_snapshot: normalizePlaylistTrackSnapshot(t),
      position: nextPos++,
      added_at: now,
    }));

    if (rows.length === 0) {
      return { items: [], added: 0, rejected: tracks.length };
    }

    const inserted = await supabaseRestRequest<PlaylistItemRow[]>(
      "/playlist_items",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows),
      },
      token,
    );

    const allItems = [...current.items, ...inserted.map((i) => ({ ...i, track: i.track_snapshot }))];
    const coverSet = new Set<string>();
    for (const it of allItems) {
      const url = it.track?.cover?.url || it.track?.coverUrl;
      if (url && typeof url === "string") coverSet.add(url);
      if (coverSet.size >= 4) break;
    }

    await supabaseRestRequest(
      `/playlists?id=eq.${encodeURIComponent(playlistId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          track_count: allItems.length,
          duration_ms: allItems.reduce((acc, it) => acc + (it.track?.durationMs || 0), 0),
          cover_urls: Array.from(coverSet),
          revision: current.playlist.revision + 1,
          updated_at: now,
        }),
      },
      token,
    ).catch(() => {});

    return {
      items: inserted.map((i) => ({
        id: i.id,
        track: i.track_snapshot,
        position: i.position,
        addedAt: i.added_at,
      })),
      added: inserted.length,
      rejected: tracks.length - inserted.length,
    };
  },

  async removePlaylistItem(
    userId: string,
    playlistId: string,
    itemId: string,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.removePlaylistItem(userId, playlistId, itemId);
    }
    await supabaseRestRequest(
      `/playlist_items?id=eq.${encodeURIComponent(itemId)}&playlist_id=eq.${encodeURIComponent(playlistId)}`,
      { method: "DELETE" },
      token,
    );

    const remaining = await supabaseRestRequest<PlaylistItemRow[]>(
      `/playlist_items?playlist_id=eq.${encodeURIComponent(playlistId)}&select=*&order=position.asc`,
      {},
      token,
    );

    const coverSet = new Set<string>();
    for (const it of remaining) {
      const url = it.track_snapshot?.cover?.url || it.track_snapshot?.coverUrl;
      if (url && typeof url === "string") coverSet.add(url);
      if (coverSet.size >= 4) break;
    }

    await supabaseRestRequest(
      `/playlists?id=eq.${encodeURIComponent(playlistId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          track_count: remaining.length,
          duration_ms: remaining.reduce((acc, it) => acc + (it.track_snapshot?.durationMs || 0), 0),
          cover_urls: Array.from(coverSet),
          updated_at: new Date().toISOString(),
        }),
      },
      token,
    ).catch(() => {});
  },

  async movePlaylistItem(
    userId: string,
    playlistId: string,
    itemId: string,
    beforeItemId: string | null,
    revision: number,
    token?: string,
  ): Promise<{ playlist: ApiUserPlaylist; items: ApiUserPlaylistItem[] }> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.movePlaylistItem(userId, playlistId, itemId, beforeItemId, revision);
    }
    const current = await this.getUserPlaylist(playlistId, token);
    const items = [...current.items];
    const targetIdx = items.findIndex((i) => i.id === itemId);
    if (targetIdx === -1) throw new ApiError(404, "Item not found", "ITEM_NOT_FOUND");

    const [moving] = items.splice(targetIdx, 1);
    if (beforeItemId) {
      const beforeIdx = items.findIndex((i) => i.id === beforeItemId);
      if (beforeIdx >= 0) items.splice(beforeIdx, 0, moving);
      else items.push(moving);
    } else {
      items.push(moving);
    }

    await Promise.all(
      items.map((it, idx) =>
        supabaseRestRequest(
          `/playlist_items?id=eq.${encodeURIComponent(it.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ position: idx }),
          },
          token,
        ),
      ),
    );

    await supabaseRestRequest(
      `/playlists?id=eq.${encodeURIComponent(playlistId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          revision: revision + 1,
          updated_at: new Date().toISOString(),
        }),
      },
      token,
    ).catch(() => {});

    return this.getUserPlaylist(playlistId, token);
  },

  async recordPlaybackEvent(
    userId: string,
    payload: RecordPlaybackEventRequest,
    token?: string,
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      return localFallbackApi.recordPlaybackEvent(userId, payload);
    }
    await supabaseRestRequest(
      "/playback_history",
      {
        method: "POST",
        body: JSON.stringify({
          owner_id: userId,
          playback_session_id: payload.playbackSessionId,
          listening_session_id: payload.listeningSessionId,
          track_id: payload.trackId,
          track_snapshot: payload.trackSnapshot,
          played_duration_ms: payload.playedDurationMs,
          track_duration_ms: payload.trackDurationMs ?? null,
          completion_rate: payload.completionRate,
          completed: payload.completed ?? false,
          skipped: payload.skipped ?? false,
          loop_count: payload.loopCount ?? 0,
          has_seek_backward: payload.hasSeekBackward ?? false,
          context: payload.context,
          listened_at: new Date().toISOString(),
        }),
      },
      token,
    );
  },

  async getHistory(
    userId: string,
    cursor?: string,
    limit = 30,
    token?: string,
  ): Promise<PlaybackHistoryResponse> {
    return this.getUserHistory(userId, cursor, String(limit), token);
  },

  async updateLastSeen(userId: string, token?: string): Promise<void> {
    if (!isSupabaseConfigured() || !token) return;
    await supabaseRestRequest(
      `/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      },
      token,
    ).catch(() => {});
  },
};
