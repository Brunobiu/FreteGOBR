-- 089_tutorials.sql
-- ---------------------------------------------------------------------------
-- Tutoriais em vídeo gerenciados pelo admin, exibidos para motorista e
-- embarcador. O admin adiciona vídeos (link do YouTube OU upload) por público
-- (duas abas: motorista / embarcador). Cada usuário pode marcar um vídeo como
-- concluído (tutorial_progress).
-- ---------------------------------------------------------------------------

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema='public' AND routine_name='is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada';
  END IF;
END
$check$;

CREATE TABLE IF NOT EXISTS public.tutorial_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('motorista', 'embarcador')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  source_type text NOT NULL CHECK (source_type IN ('youtube', 'upload')),
  youtube_url text CHECK (youtube_url IS NULL OR char_length(youtube_url) <= 500),
  storage_path text CHECK (storage_path IS NULL OR char_length(storage_path) <= 500),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tutorial_source_consistency CHECK (
    (source_type = 'youtube' AND youtube_url IS NOT NULL) OR
    (source_type = 'upload' AND storage_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tutorial_videos_audience
  ON public.tutorial_videos(audience, sort_order) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.tutorial_progress (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.tutorial_videos(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

ALTER TABLE public.tutorial_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutorial_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tutorial_videos_select ON public.tutorial_videos;
CREATE POLICY tutorial_videos_select ON public.tutorial_videos
  FOR SELECT TO authenticated
  USING (is_active = true OR is_admin_with_permission('SETTINGS_VIEW'));

DROP POLICY IF EXISTS tutorial_videos_insert ON public.tutorial_videos;
CREATE POLICY tutorial_videos_insert ON public.tutorial_videos
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_with_permission('SETTINGS_EDIT'));

DROP POLICY IF EXISTS tutorial_videos_update ON public.tutorial_videos;
CREATE POLICY tutorial_videos_update ON public.tutorial_videos
  FOR UPDATE TO authenticated
  USING (is_admin_with_permission('SETTINGS_EDIT'))
  WITH CHECK (is_admin_with_permission('SETTINGS_EDIT'));

DROP POLICY IF EXISTS tutorial_videos_delete ON public.tutorial_videos;
CREATE POLICY tutorial_videos_delete ON public.tutorial_videos
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('SETTINGS_EDIT'));

DROP POLICY IF EXISTS tutorial_progress_select ON public.tutorial_progress;
CREATE POLICY tutorial_progress_select ON public.tutorial_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS tutorial_progress_insert ON public.tutorial_progress;
CREATE POLICY tutorial_progress_insert ON public.tutorial_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tutorial_progress_delete ON public.tutorial_progress;
CREATE POLICY tutorial_progress_delete ON public.tutorial_progress
  FOR DELETE TO authenticated USING (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tutorial_videos', 'tutorial_videos', true, 524288000,
        ARRAY['video/mp4','video/webm','video/quicktime','video/x-m4v'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS tutorial_videos_storage_read ON storage.objects;
CREATE POLICY tutorial_videos_storage_read ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'tutorial_videos');

DROP POLICY IF EXISTS tutorial_videos_storage_write ON storage.objects;
CREATE POLICY tutorial_videos_storage_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tutorial_videos' AND is_admin_with_permission('SETTINGS_EDIT'));

DROP POLICY IF EXISTS tutorial_videos_storage_delete ON storage.objects;
CREATE POLICY tutorial_videos_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'tutorial_videos' AND is_admin_with_permission('SETTINGS_EDIT'));

COMMIT;
