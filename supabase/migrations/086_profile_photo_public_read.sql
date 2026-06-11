-- 086_profile_photo_public_read.sql
-- ---------------------------------------------------------------------------
-- Permite que QUALQUER usuario autenticado leia (gere signed URL de) as FOTOS
-- DE PERFIL no bucket privado `documents`.
--
-- PROBLEMA: a foto de perfil do embarcador fica em
--   documents/<userId>/profile_photo_<ts>.<ext>
-- e o bucket e privado. A policy "Users can view their own documents" so deixa
-- o DONO gerar signed URL (auth.uid() = pasta[1]). Por isso a foto do
-- embarcador NAO aparecia no modal do frete do lado do motorista
-- (createSignedUrl retornava erro e a UI caia na inicial).
--
-- SOLUCAO: policy de SELECT adicional restrita SOMENTE a arquivos cujo nome
-- contem `/profile_photo_` (a foto de perfil e identificacao publica, exibida
-- a outros usuarios no modal, no chat, etc). Documentos sensiveis (cnh, crlv,
-- rntrc, comprovantes...) NAO casam esse padrao e continuam privados — visiveis
-- apenas ao dono e aos admins.
-- ---------------------------------------------------------------------------

BEGIN;

DROP POLICY IF EXISTS "Anyone authed can view profile photos" ON storage.objects;

CREATE POLICY "Anyone authed can view profile photos"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND position('/profile_photo_' in name) > 0
  );

COMMIT;

-- VERIFY (smoke test manual):
/*
SELECT polname, polcmd
  FROM pg_policy
 WHERE polrelid = 'storage.objects'::regclass
   AND polname = 'Anyone authed can view profile photos';
*/
