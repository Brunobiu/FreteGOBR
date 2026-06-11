-- 089_tutorials_rollback.sql
-- Reverte 089. Documentacao, nao auto-aplicada.

BEGIN;

DROP POLICY IF EXISTS tutorial_videos_storage_delete ON storage.objects;
DROP POLICY IF EXISTS tutorial_videos_storage_write ON storage.objects;
DROP POLICY IF EXISTS tutorial_videos_storage_read ON storage.objects;

DROP TABLE IF EXISTS public.tutorial_progress;
DROP TABLE IF EXISTS public.tutorial_videos;

-- Bucket mantido (pode conter arquivos). Para remover manualmente:
-- DELETE FROM storage.buckets WHERE id = 'tutorial_videos';

COMMIT;
