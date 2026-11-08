-- Supabase Schema for Liner Desktop
-- Enables RLS across all personal metadata and social sync tables.

-- Ensure pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  username text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  bio text,
  is_public boolean NOT NULL DEFAULT true,
  show_activity boolean NOT NULL DEFAULT true,
  show_history boolean NOT NULL DEFAULT true,
  show_liked_tracks boolean NOT NULL DEFAULT true,
  participate_leaderboards boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    OR is_public = true
    OR auth.uid() = id
  );

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Function: updated_at refresher
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Function: Auto-provision profile on auth.users creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_user text;
  base_username text;
  candidate_username text;
  suffix text;
BEGIN
  raw_user := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  base_username := lower(regexp_replace(raw_user, '[^a-zA-Z0-9_]', '', 'g'));
  IF length(base_username) < 3 THEN
    base_username := 'user';
  END IF;

  candidate_username := base_username;

  LOOP
    BEGIN
      INSERT INTO public.profiles (
        id,
        email,
        username,
        display_name,
        avatar_url,
        created_at,
        updated_at
      ) VALUES (
        new.id,
        new.email,
        candidate_username,
        coalesce(
          new.raw_user_meta_data->>'display_name',
          new.raw_user_meta_data->>'full_name',
          candidate_username
        ),
        coalesce(
          new.raw_user_meta_data->>'avatar_url',
          new.raw_user_meta_data->>'picture'
        ),
        now(),
        now()
      );
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      suffix := substr(md5(random()::text || clock_timestamp()::text), 1, 6);
      candidate_username := substr(base_username, 1, 20) || '_' || suffix;
    END;
  END LOOP;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. USER FOLLOWS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_follows_select_policy" ON public.user_follows;
CREATE POLICY "user_follows_select_policy" ON public.user_follows
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user_follows_insert_policy" ON public.user_follows;
CREATE POLICY "user_follows_insert_policy" ON public.user_follows
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "user_follows_delete_policy" ON public.user_follows;
CREATE POLICY "user_follows_delete_policy" ON public.user_follows
  FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id);

-- ============================================================================
-- 3. PLAYLISTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  track_count integer NOT NULL DEFAULT 0,
  duration_ms bigint NOT NULL DEFAULT 0,
  cover_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlists_owner_updated
  ON public.playlists (owner_id, updated_at DESC);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlists_select_policy" ON public.playlists;
CREATE POLICY "playlists_select_policy" ON public.playlists
  FOR SELECT
  USING (auth.uid() = owner_id OR is_public = true);

DROP POLICY IF EXISTS "playlists_insert_policy" ON public.playlists;
CREATE POLICY "playlists_insert_policy" ON public.playlists
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "playlists_update_policy" ON public.playlists;
CREATE POLICY "playlists_update_policy" ON public.playlists
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "playlists_delete_policy" ON public.playlists;
CREATE POLICY "playlists_delete_policy" ON public.playlists
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS set_playlists_updated_at ON public.playlists;
CREATE TRIGGER set_playlists_updated_at
  BEFORE UPDATE ON public.playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. PLAYLIST ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  track_id text NOT NULL,
  track_snapshot jsonb NOT NULL,
  position double precision NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_pos
  ON public.playlist_items (playlist_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_playlist_items_owner
  ON public.playlist_items (owner_id);

ALTER TABLE public.playlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlist_items_select_policy" ON public.playlist_items;
CREATE POLICY "playlist_items_select_policy" ON public.playlist_items
  FOR SELECT
  USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.playlists p
      WHERE p.id = playlist_items.playlist_id AND p.is_public = true
    )
  );

DROP POLICY IF EXISTS "playlist_items_insert_policy" ON public.playlist_items;
CREATE POLICY "playlist_items_insert_policy" ON public.playlist_items
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "playlist_items_update_policy" ON public.playlist_items;
CREATE POLICY "playlist_items_update_policy" ON public.playlist_items
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "playlist_items_delete_policy" ON public.playlist_items;
CREATE POLICY "playlist_items_delete_policy" ON public.playlist_items
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- ============================================================================
-- 5. LIKED TRACKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.liked_tracks (
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  track_id text NOT NULL,
  track_snapshot jsonb NOT NULL,
  liked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_liked_tracks_owner_liked
  ON public.liked_tracks (owner_id, liked_at DESC);

ALTER TABLE public.liked_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "liked_tracks_select_policy" ON public.liked_tracks;
CREATE POLICY "liked_tracks_select_policy" ON public.liked_tracks
  FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "liked_tracks_insert_policy" ON public.liked_tracks;
CREATE POLICY "liked_tracks_insert_policy" ON public.liked_tracks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "liked_tracks_update_policy" ON public.liked_tracks;
CREATE POLICY "liked_tracks_update_policy" ON public.liked_tracks
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "liked_tracks_delete_policy" ON public.liked_tracks;
CREATE POLICY "liked_tracks_delete_policy" ON public.liked_tracks
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- ============================================================================
-- 6. SAVED COLLECTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.saved_collections (
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  collection_type text NOT NULL CHECK (collection_type IN ('albums', 'artists', 'playlists')),
  collection_id text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, collection_type, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_collections_owner
  ON public.saved_collections (owner_id, collection_type, saved_at DESC);

ALTER TABLE public.saved_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_collections_select_policy" ON public.saved_collections;
CREATE POLICY "saved_collections_select_policy" ON public.saved_collections
  FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "saved_collections_insert_policy" ON public.saved_collections;
CREATE POLICY "saved_collections_insert_policy" ON public.saved_collections
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "saved_collections_update_policy" ON public.saved_collections;
CREATE POLICY "saved_collections_update_policy" ON public.saved_collections
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "saved_collections_delete_policy" ON public.saved_collections;
CREATE POLICY "saved_collections_delete_policy" ON public.saved_collections
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- ============================================================================
-- 7. PLAYBACK HISTORY
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.playback_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  playback_session_id text NOT NULL,
  listening_session_id text NOT NULL,
  track_id text NOT NULL,
  track_snapshot jsonb NOT NULL,
  played_duration_ms integer NOT NULL DEFAULT 0,
  track_duration_ms integer,
  completion_rate double precision NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  skipped boolean NOT NULL DEFAULT false,
  loop_count integer NOT NULL DEFAULT 0,
  has_seek_backward boolean NOT NULL DEFAULT false,
  context jsonb,
  listened_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playback_history_owner
  ON public.playback_history (owner_id, listened_at DESC);

CREATE INDEX IF NOT EXISTS idx_playback_history_track
  ON public.playback_history (track_id);

ALTER TABLE public.playback_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playback_history_select_policy" ON public.playback_history;
CREATE POLICY "playback_history_select_policy" ON public.playback_history
  FOR SELECT
  USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = playback_history.owner_id AND p.show_history = true
    )
  );

DROP POLICY IF EXISTS "playback_history_insert_policy" ON public.playback_history;
CREATE POLICY "playback_history_insert_policy" ON public.playback_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "playback_history_delete_policy" ON public.playback_history;
CREATE POLICY "playback_history_delete_policy" ON public.playback_history
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);
