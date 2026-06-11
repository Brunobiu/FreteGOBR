-- 086_profile_photo_public_read_rollback.sql
-- Reverte 086: remove a policy de leitura publica das fotos de perfil.
-- Documentacao, nao auto-aplicada.

BEGIN;

DROP POLICY IF EXISTS "Anyone authed can view profile photos" ON storage.objects;

COMMIT;
