import type { AuthTokens, PublicUser, UserProfile, UpdateProfileInput } from "@/shared/contracts";
import type {
  ApiUserPlaylist,
  ApiUserPlaylistItem,
  ApiLikedTracksPage,
} from "@/shared/contracts/playlists";
import type {
  PlaybackHistoryResponse,
  RecordPlaybackEventRequest,
  LeaderboardResponse,
} from "@/shared/contracts";
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

const LOCAL_ACCOUNT_KEY = "liner_local_account_v1";
const LOCAL_LIBRARY_KEY = "liner_local_library_v1";

interface LocalLibraryDb {
  profiles: ProfileRow[];
  userFollows: UserFollowRow[];
  playlists: PlaylistRow[];
  playlistItems: PlaylistItemRow[];
  likedTracks: LikedTrackRow[];
  savedCollections: SavedCollectionRow[];
  playbackHistory: PlaybackHistoryRow[];
}

function emptyDb(): LocalLibraryDb {
  return {
    profiles: [],
    userFollows: [],
    playlists: [],
    playlistItems: [],
    likedTracks: [],
    savedCollections: [],
    playbackHistory: [],
  };
}

function readDb(): LocalLibraryDb {
  if (typeof window === "undefined" || !window.localStorage) return emptyDb();
  try {
    const raw = localStorage.getItem(LOCAL_LIBRARY_KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw);
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      userFollows: Array.isArray(parsed.userFollows) ? parsed.userFollows : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      playlistItems: Array.isArray(parsed.playlistItems) ? parsed.playlistItems : [],
      likedTracks: Array.isArray(parsed.likedTracks) ? parsed.likedTracks : [],
      savedCollections: Array.isArray(parsed.savedCollections) ? parsed.savedCollections : [],
      playbackHistory: Array.isArray(parsed.playbackHistory) ? parsed.playbackHistory : [],
    };
  } catch {
    return emptyDb();
  }
}

function writeDb(db: LocalLibraryDb): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(db));
  } catch {}
}

export function readLocalAccount(): { user: PublicUser; password?: string } | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLocalAccount(account: { user: PublicUser; password?: string } | null): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (account) {
      localStorage.setItem(LOCAL_ACCOUNT_KEY, JSON.stringify(account));
    } else {
      localStorage.removeItem(LOCAL_ACCOUNT_KEY);
    }
  } catch {}
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function makeTokens(user: PublicUser): AuthTokens {
  const expiresAtMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return {
    accessToken: `local_access_${user.id}`,
    refreshToken: `local_refresh_${user.id}`,
    accessTokenExpiresAt: new Date(expiresAtMs).toISOString(),
    expiresAt: expiresAtMs,
    user,
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

export const localFallbackApi = {
  login(email: string): AuthTokens {
    const existing = readLocalAccount();
    if (existing && existing.user.email?.toLowerCase() === email.toLowerCase()) {
      return makeTokens(existing.user);
    }

    const userId = generateId();
    const user: PublicUser = {
      id: userId,
      email: email.trim().toLowerCase(),
      username: email.split("@")[0] || "user",
      displayName: email.split("@")[0] || "User",
      isPublic: true,
      showActivity: true,
      showHistory: true,
      showLikedTracks: true,
      participateLeaderboards: true,
    };
    writeLocalAccount({ user });

    const db = readDb();
    const now = new Date().toISOString();
    const profile: ProfileRow = {
      id: userId,
      email: user.email,
      username: user.username || null,
      display_name: user.displayName || null,
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
    db.profiles.push(profile);
    writeDb(db);

    return makeTokens(user);
  },

  register(
    email: string,
    username: string,
    displayName: string,
  ): AuthTokens {
    const userId = generateId();
    const user: PublicUser = {
      id: userId,
      email: email.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      displayName: displayName.trim(),
      isPublic: true,
      showActivity: true,
      showHistory: true,
      showLikedTracks: true,
      participateLeaderboards: true,
    };
    writeLocalAccount({ user });

    const db = readDb();
    const now = new Date().toISOString();
    const profile: ProfileRow = {
      id: userId,
      email: user.email,
      username: user.username || null,
      display_name: user.displayName || null,
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
    const idx = db.profiles.findIndex((p) => p.id === userId);
    if (idx >= 0) db.profiles[idx] = profile;
    else db.profiles.push(profile);
    writeDb(db);

    return makeTokens(user);
  },

  getMe(userId: string): PublicUser {
    const account = readLocalAccount();
    if (account && account.user.id === userId) {
      return account.user;
    }
    const db = readDb();
    const profile = db.profiles.find((p) => p.id === userId);
    if (profile) {
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
      };
    }
    return {
      id: userId,
      username: "user",
      displayName: "User",
      isPublic: true,
    };
  },

  updateProfile(userId: string, data: UpdateProfileInput): PublicUser {
    const db = readDb();
    let profile = db.profiles.find((p) => p.id === userId);
    const now = new Date().toISOString();
    if (!profile) {
      profile = {
        id: userId,
        email: null,
        username: data.username || "user",
        display_name: data.displayName || null,
        avatar_url: data.avatarUrl || null,
        bio: data.bio || null,
        is_public: data.isPublic ?? true,
        show_activity: data.showActivity ?? true,
        show_history: data.showHistory ?? true,
        show_liked_tracks: data.showLikedTracks ?? true,
        participate_leaderboards: data.participateLeaderboards ?? true,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      };
      db.profiles.push(profile);
    } else {
      if (data.username !== undefined) profile.username = data.username;
      if (data.displayName !== undefined) profile.display_name = data.displayName;
      if (data.avatarUrl !== undefined) profile.avatar_url = data.avatarUrl;
      if (data.bio !== undefined) profile.bio = data.bio;
      if (data.isPublic !== undefined) profile.is_public = data.isPublic;
      if (data.showActivity !== undefined) profile.show_activity = data.showActivity;
      if (data.showHistory !== undefined) profile.show_history = data.showHistory;
      if (data.showLikedTracks !== undefined) profile.show_liked_tracks = data.showLikedTracks;
      if (data.participateLeaderboards !== undefined) {
        profile.participate_leaderboards = data.participateLeaderboards;
      }
      profile.updated_at = now;
    }
    writeDb(db);

    const user: PublicUser = {
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
    };

    const account = readLocalAccount();
    if (account && account.user.id === userId) {
      writeLocalAccount({ ...account, user });
    }

    return user;
  },

  getUserProfile(idOrUsername: string, currentUserId?: string): UserProfile {
    const db = readDb();
    const profile = db.profiles.find(
      (p) =>
        p.id === idOrUsername ||
        p.username?.toLowerCase() === idOrUsername.toLowerCase(),
    );

    if (!profile) {
      throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    }

    const followers = db.userFollows.filter((f) => f.following_id === profile.id);
    const following = db.userFollows.filter((f) => f.follower_id === profile.id);
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

  searchUsers(query: string): UserProfile[] {
    const db = readDb();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return db.profiles
      .filter(
        (p) =>
          p.username?.toLowerCase().includes(q) ||
          p.display_name?.toLowerCase().includes(q),
      )
      .slice(0, 20)
      .map((p) => this.getUserProfile(p.id));
  },

  followUser(currentUserId: string, targetIdOrUsername: string): void {
    const db = readDb();
    const target = db.profiles.find(
      (p) =>
        p.id === targetIdOrUsername ||
        p.username?.toLowerCase() === targetIdOrUsername.toLowerCase(),
    );
    if (!target) throw new ApiError(404, "User not found", "USER_NOT_FOUND");
    if (target.id === currentUserId) return;

    const exists = db.userFollows.some(
      (f) => f.follower_id === currentUserId && f.following_id === target.id,
    );
    if (!exists) {
      db.userFollows.push({
        follower_id: currentUserId,
        following_id: target.id,
        created_at: new Date().toISOString(),
      });
      writeDb(db);
    }
  },

  unfollowUser(currentUserId: string, targetIdOrUsername: string): void {
    const db = readDb();
    const target = db.profiles.find(
      (p) =>
        p.id === targetIdOrUsername ||
        p.username?.toLowerCase() === targetIdOrUsername.toLowerCase(),
    );
    if (!target) return;
    db.userFollows = db.userFollows.filter(
      (f) => !(f.follower_id === currentUserId && f.following_id === target.id),
    );
    writeDb(db);
  },

  getUserFollowers(idOrUsername: string, currentUserId?: string): UserProfile[] {
    const db = readDb();
    const target = db.profiles.find(
      (p) =>
        p.id === idOrUsername ||
        p.username?.toLowerCase() === idOrUsername.toLowerCase(),
    );
    if (!target) return [];
    const followerIds = db.userFollows
      .filter((f) => f.following_id === target.id)
      .map((f) => f.follower_id);
    return followerIds
      .map((fid) => {
        try {
          return this.getUserProfile(fid, currentUserId);
        } catch {
          return null;
        }
      })
      .filter((u): u is UserProfile => u !== null);
  },

  getUserFollowing(idOrUsername: string, currentUserId?: string): UserProfile[] {
    const db = readDb();
    const target = db.profiles.find(
      (p) =>
        p.id === idOrUsername ||
        p.username?.toLowerCase() === idOrUsername.toLowerCase(),
    );
    if (!target) return [];
    const followingIds = db.userFollows
      .filter((f) => f.follower_id === target.id)
      .map((f) => f.following_id);
    return followingIds
      .map((fid) => {
        try {
          return this.getUserProfile(fid, currentUserId);
        } catch {
          return null;
        }
      })
      .filter((u): u is UserProfile => u !== null);
  },

  getUserPlaylists(idOrUsername: string): { items: ApiUserPlaylist[] } {
    const db = readDb();
    const target = db.profiles.find(
      (p) =>
        p.id === idOrUsername ||
        p.username?.toLowerCase() === idOrUsername.toLowerCase(),
    );
    if (!target) return { items: [] };

    const playlists = db.playlists.filter((p) => p.owner_id === target.id);
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
          displayName: target.display_name,
          avatarUrl: target.avatar_url,
        },
      })),
    };
  },

  getUserHistory(
    idOrUsername: string,
    cursor?: string,
    limit = "30",
  ): PlaybackHistoryResponse {
    const db = readDb();
    const target = db.profiles.find(
      (p) =>
        p.id === idOrUsername ||
        p.username?.toLowerCase() === idOrUsername.toLowerCase(),
    );
    if (!target) return { items: [], nextCursor: null };

    const max = parseInt(limit, 10) || 30;
    const history = db.playbackHistory
      .filter((h) => h.owner_id === target.id)
      .sort((a, b) => new Date(b.listened_at).getTime() - new Date(a.listened_at).getTime());

    let startIndex = 0;
    if (cursor) {
      const idx = history.findIndex((h) => h.id === cursor);
      if (idx >= 0) startIndex = idx + 1;
    }

    const slice = history.slice(startIndex, startIndex + max);
    const hasMore = startIndex + max < history.length;
    const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : null;

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

  getArtistLeaderboard(
    artistId: string,
    period = "monthly",
    limit = 10,
  ): LeaderboardResponse {
    const db = readDb();
    const playsByUser = new Map<string, { durationMs: number; count: number }>();

    for (const h of db.playbackHistory) {
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

    const entries = Array.from(playsByUser.entries())
      .sort((a, b) => b[1].durationMs - a[1].durationMs)
      .slice(0, limit)
      .map(([userId, stats], idx) => {
        const profile = db.profiles.find((p) => p.id === userId);
        return {
          rank: idx + 1,
          user: {
            id: userId,
            username: profile?.username || "user",
            displayName: profile?.display_name || "User",
            avatarUrl: profile?.avatar_url || null,
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

  getGlobalLeaderboard(period = "weekly", limit = 20): LeaderboardResponse {
    const db = readDb();
    const playsByUser = new Map<string, { durationMs: number; count: number }>();

    for (const h of db.playbackHistory) {
      const current = playsByUser.get(h.owner_id) || { durationMs: 0, count: 0 };
      current.durationMs += h.played_duration_ms || 0;
      current.count += 1;
      playsByUser.set(h.owner_id, current);
    }

    const entries = Array.from(playsByUser.entries())
      .sort((a, b) => b[1].durationMs - a[1].durationMs)
      .slice(0, limit)
      .map(([userId, stats], idx) => {
        const profile = db.profiles.find((p) => p.id === userId);
        return {
          rank: idx + 1,
          user: {
            id: userId,
            username: profile?.username || "user",
            displayName: profile?.display_name || "User",
            avatarUrl: profile?.avatar_url || null,
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

  listLikedTracks(userId: string, limit = 100, cursor?: string): ApiLikedTracksPage {
    const db = readDb();
    const likes = db.likedTracks
      .filter((l) => l.owner_id === userId)
      .sort((a, b) => new Date(b.liked_at).getTime() - new Date(a.liked_at).getTime());

    let startIndex = 0;
    if (cursor) {
      const idx = likes.findIndex((l) => l.track_id === cursor);
      if (idx >= 0) startIndex = idx + 1;
    }

    const slice = likes.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < likes.length;
    const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].track_id : null;

    return {
      items: slice.map((l) => ({
        track: l.track_snapshot,
        likedAt: l.liked_at,
      })),
      nextCursor,
    };
  },

  likeTrack(userId: string, trackId: string, trackSnapshot: any): void {
    const db = readDb();
    const existingIdx = db.likedTracks.findIndex(
      (l) => l.owner_id === userId && l.track_id === trackId,
    );
    const now = new Date().toISOString();
    const row: LikedTrackRow = {
      owner_id: userId,
      track_id: trackId,
      track_snapshot: trackSnapshot,
      liked_at: now,
    };
    if (existingIdx >= 0) {
      db.likedTracks[existingIdx] = row;
    } else {
      db.likedTracks.unshift(row);
    }
    writeDb(db);
  },

  unlikeTrack(userId: string, trackId: string): void {
    const db = readDb();
    db.likedTracks = db.likedTracks.filter(
      (l) => !(l.owner_id === userId && l.track_id === trackId),
    );
    writeDb(db);
  },

  listSavedCollections(
    userId: string,
    type: "albums" | "artists" | "playlists",
  ): { items: any[] } {
    const db = readDb();
    const singular = type === "albums" ? "album" : type === "artists" ? "artist" : "playlist";
    const rows = db.savedCollections
      .filter((s) => s.owner_id === userId && s.collection_type === type)
      .sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime());

    return {
      items: rows.map((r) => {
        const val = r.snapshot || {};
        const title = val.title || val.name || "Untitled";
        const coverUrl = val.coverUrl || (val.cover?.url ?? "");
        const cover = val.cover ?? (coverUrl ? { url: coverUrl } : undefined);
        const normalized = {
          id: val.id || r.collection_id,
          title: singular === "artist" ? undefined : title,
          name: singular === "artist" ? title : undefined,
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
        return {
          [singular]: normalized,
          savedAt: r.saved_at,
        };
      }),
    };
  },

  saveCollection(
    userId: string,
    type: "albums" | "artists" | "playlists",
    collectionId: string,
    snapshot: any,
  ): void {
    const db = readDb();
    const existingIdx = db.savedCollections.findIndex(
      (s) =>
        s.owner_id === userId &&
        s.collection_type === type &&
        s.collection_id === collectionId,
    );
    const row: SavedCollectionRow = {
      owner_id: userId,
      collection_type: type,
      collection_id: collectionId,
      snapshot,
      saved_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      db.savedCollections[existingIdx] = row;
    } else {
      db.savedCollections.unshift(row);
    }
    writeDb(db);
  },

  removeCollection(
    userId: string,
    type: "albums" | "artists" | "playlists",
    collectionId: string,
  ): void {
    const db = readDb();
    db.savedCollections = db.savedCollections.filter(
      (s) =>
        !(
          s.owner_id === userId &&
          s.collection_type === type &&
          s.collection_id === collectionId
        ),
    );
    writeDb(db);
  },

  listPlaylists(userId: string): { items: ApiUserPlaylist[] } {
    const db = readDb();
    const rows = db.playlists.filter((p) => p.owner_id === userId);
    const profile = db.profiles.find((pr) => pr.id === userId);
    return {
      items: rows.map((p) => ({
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
        owner: profile
          ? {
              id: profile.id,
              username: profile.username,
              displayName: profile.display_name,
              avatarUrl: profile.avatar_url,
            }
          : undefined,
      })),
    };
  },

  getUserPlaylist(playlistId: string): {
    playlist: ApiUserPlaylist;
    items: ApiUserPlaylistItem[];
  } {
    const db = readDb();
    const playlist = db.playlists.find((p) => p.id === playlistId);
    if (!playlist) {
      throw new ApiError(404, "Playlist not found", "PLAYLIST_NOT_FOUND");
    }

    const profile = db.profiles.find((pr) => pr.id === playlist.owner_id);
    const items = db.playlistItems
      .filter((i) => i.playlist_id === playlistId)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        track: i.track_snapshot,
        position: i.position,
        addedAt: i.added_at,
      }));

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
        owner: profile
          ? {
              id: profile.id,
              username: profile.username,
              displayName: profile.display_name,
              avatarUrl: profile.avatar_url,
            }
          : undefined,
      },
      items,
    };
  },

  createPlaylist(
    userId: string,
    input: { title: string; description?: string; isPublic?: boolean },
  ): ApiUserPlaylist {
    const db = readDb();
    const now = new Date().toISOString();
    const id = generateId();
    const row: PlaylistRow = {
      id,
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
    };
    db.playlists.push(row);
    writeDb(db);

    const profile = db.profiles.find((p) => p.id === userId);
    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      isPublic: row.is_public,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      trackCount: 0,
      coverUrls: [],
      ownerId: userId,
      owner: profile
        ? {
            id: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
          }
        : undefined,
    };
  },

  updatePlaylist(
    userId: string,
    playlistId: string,
    input: { title?: string; description?: string | null; isPublic?: boolean },
  ): ApiUserPlaylist {
    const db = readDb();
    const p = db.playlists.find((pl) => pl.id === playlistId && pl.owner_id === userId);
    if (!p) throw new ApiError(404, "Playlist not found", "PLAYLIST_NOT_FOUND");

    if (input.title !== undefined) p.title = input.title.trim();
    if (input.description !== undefined) p.description = input.description?.trim() || null;
    if (input.isPublic !== undefined) p.is_public = input.isPublic;
    p.revision += 1;
    p.updated_at = new Date().toISOString();
    writeDb(db);

    const profile = db.profiles.find((pr) => pr.id === userId);
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
      owner: profile
        ? {
            id: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
          }
        : undefined,
    };
  },

  deletePlaylist(userId: string, playlistId: string): void {
    const db = readDb();
    db.playlists = db.playlists.filter(
      (p) => !(p.id === playlistId && p.owner_id === userId),
    );
    db.playlistItems = db.playlistItems.filter((i) => i.playlist_id !== playlistId);
    writeDb(db);
  },

  addPlaylistTrack(
    userId: string,
    playlistId: string,
    trackId: string,
    snapshot: any,
  ): ApiUserPlaylistItem {
    const db = readDb();
    const playlist = db.playlists.find((p) => p.id === playlistId && p.owner_id === userId);
    if (!playlist) throw new ApiError(404, "Playlist not found", "PLAYLIST_NOT_FOUND");

    const existingItems = db.playlistItems
      .filter((i) => i.playlist_id === playlistId)
      .sort((a, b) => a.position - b.position);

    const nextPosition = existingItems.length > 0
      ? existingItems[existingItems.length - 1].position + 1
      : 0;

    const normalizedSnapshot = normalizePlaylistTrackSnapshot(snapshot);
    const id = generateId();
    const now = new Date().toISOString();
    const row: PlaylistItemRow = {
      id,
      playlist_id: playlistId,
      owner_id: userId,
      track_id: trackId,
      track_snapshot: normalizedSnapshot,
      position: nextPosition,
      added_at: now,
    };
    db.playlistItems.push(row);

    const allItems = [...existingItems, row];
    playlist.track_count = allItems.length;
    playlist.duration_ms = allItems.reduce(
      (sum, item) => sum + (item.track_snapshot?.durationMs || 0),
      0,
    );
    const coverSet = new Set<string>();
    for (const item of allItems) {
      const url = item.track_snapshot?.cover?.url || item.track_snapshot?.coverUrl;
      if (url && typeof url === "string") coverSet.add(url);
      if (coverSet.size >= 4) break;
    }
    playlist.cover_urls = Array.from(coverSet);
    playlist.revision += 1;
    playlist.updated_at = now;
    writeDb(db);

    return {
      id: row.id,
      track: row.track_snapshot,
      position: row.position,
      addedAt: row.added_at,
    };
  },

  addPlaylistTrackSnapshots(
    userId: string,
    playlistId: string,
    tracks: any[],
  ): { items: ApiUserPlaylistItem[]; added: number; rejected: number } {
    const db = readDb();
    const playlist = db.playlists.find((p) => p.id === playlistId && p.owner_id === userId);
    if (!playlist) throw new ApiError(404, "Playlist not found", "PLAYLIST_NOT_FOUND");

    const existingItems = db.playlistItems
      .filter((i) => i.playlist_id === playlistId)
      .sort((a, b) => a.position - b.position);

    let nextPosition = existingItems.length > 0
      ? existingItems[existingItems.length - 1].position + 1
      : 0;

    const addedRows: PlaylistItemRow[] = [];
    const now = new Date().toISOString();

    for (const track of tracks) {
      if (!track || !track.id) continue;
      const id = generateId();
      const row: PlaylistItemRow = {
        id,
        playlist_id: playlistId,
        owner_id: userId,
        track_id: track.id,
        track_snapshot: normalizePlaylistTrackSnapshot(track),
        position: nextPosition++,
        added_at: now,
      };
      db.playlistItems.push(row);
      addedRows.push(row);
    }

    const allItems = [...existingItems, ...addedRows];
    playlist.track_count = allItems.length;
    playlist.duration_ms = allItems.reduce(
      (sum, item) => sum + (item.track_snapshot?.durationMs || 0),
      0,
    );
    const coverSet = new Set<string>();
    for (const item of allItems) {
      const url = item.track_snapshot?.cover?.url || item.track_snapshot?.coverUrl;
      if (url && typeof url === "string") coverSet.add(url);
      if (coverSet.size >= 4) break;
    }
    playlist.cover_urls = Array.from(coverSet);
    playlist.revision += 1;
    playlist.updated_at = now;
    writeDb(db);

    return {
      items: addedRows.map((r) => ({
        id: r.id,
        track: r.track_snapshot,
        position: r.position,
        addedAt: r.added_at,
      })),
      added: addedRows.length,
      rejected: tracks.length - addedRows.length,
    };
  },

  removePlaylistItem(userId: string, playlistId: string, itemId: string): void {
    const db = readDb();
    const playlist = db.playlists.find((p) => p.id === playlistId && p.owner_id === userId);
    if (!playlist) return;

    db.playlistItems = db.playlistItems.filter(
      (i) => !(i.playlist_id === playlistId && i.id === itemId),
    );

    const remaining = db.playlistItems
      .filter((i) => i.playlist_id === playlistId)
      .sort((a, b) => a.position - b.position);

    playlist.track_count = remaining.length;
    playlist.duration_ms = remaining.reduce(
      (sum, item) => sum + (item.track_snapshot?.durationMs || 0),
      0,
    );
    const coverSet = new Set<string>();
    for (const item of remaining) {
      const url = item.track_snapshot?.cover?.url || item.track_snapshot?.coverUrl;
      if (url && typeof url === "string") coverSet.add(url);
      if (coverSet.size >= 4) break;
    }
    playlist.cover_urls = Array.from(coverSet);
    playlist.revision += 1;
    playlist.updated_at = new Date().toISOString();
    writeDb(db);
  },

  movePlaylistItem(
    userId: string,
    playlistId: string,
    itemId: string,
    beforeItemId: string | null,
    _revision: number,
  ): { playlist: ApiUserPlaylist; items: ApiUserPlaylistItem[] } {
    const db = readDb();
    const playlist = db.playlists.find((p) => p.id === playlistId && p.owner_id === userId);
    if (!playlist) throw new ApiError(404, "Playlist not found", "PLAYLIST_NOT_FOUND");

    const items = db.playlistItems
      .filter((i) => i.playlist_id === playlistId)
      .sort((a, b) => a.position - b.position);

    const targetIndex = items.findIndex((i) => i.id === itemId);
    if (targetIndex === -1) throw new ApiError(404, "Item not found", "ITEM_NOT_FOUND");

    const [movingItem] = items.splice(targetIndex, 1);
    if (beforeItemId) {
      const beforeIndex = items.findIndex((i) => i.id === beforeItemId);
      if (beforeIndex >= 0) {
        items.splice(beforeIndex, 0, movingItem);
      } else {
        items.push(movingItem);
      }
    } else {
      items.push(movingItem);
    }

    items.forEach((item, idx) => {
      item.position = idx;
    });

    playlist.revision += 1;
    playlist.updated_at = new Date().toISOString();
    writeDb(db);

    return this.getUserPlaylist(playlistId);
  },

  recordPlaybackEvent(userId: string, payload: RecordPlaybackEventRequest): void {
    const db = readDb();
    const id = generateId();
    const row: PlaybackHistoryRow = {
      id,
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
    };
    db.playbackHistory.unshift(row);
    // keep latest 1000 items locally
    if (db.playbackHistory.length > 1000) {
      db.playbackHistory.length = 1000;
    }
    writeDb(db);
  },

  getHistory(userId: string, cursor?: string, limit = 30): PlaybackHistoryResponse {
    return this.getUserHistory(userId, cursor, String(limit));
  },
};
