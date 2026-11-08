export interface ProfileRow {
  id: string;
  email?: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_public: boolean;
  show_activity: boolean;
  show_history: boolean;
  show_liked_tracks: boolean;
  participate_leaderboards: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFollowRow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface PlaylistRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  revision: number;
  track_count: number;
  duration_ms: number;
  cover_urls: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItemRow {
  id: string;
  playlist_id: string;
  owner_id: string;
  track_id: string;
  track_snapshot: any;
  position: number;
  added_at: string;
}

export interface LikedTrackRow {
  owner_id: string;
  track_id: string;
  track_snapshot: any;
  liked_at: string;
}

export interface SavedCollectionRow {
  owner_id: string;
  collection_type: "albums" | "artists" | "playlists";
  collection_id: string;
  snapshot: any;
  saved_at: string;
}

export interface PlaybackHistoryRow {
  id: string;
  owner_id: string;
  playback_session_id: string;
  listening_session_id: string;
  track_id: string;
  track_snapshot: any;
  played_duration_ms: number;
  track_duration_ms: number | null;
  completion_rate: number;
  completed: boolean;
  skipped: boolean;
  loop_count: number;
  has_seek_backward: boolean;
  context: any;
  listened_at: string;
}
