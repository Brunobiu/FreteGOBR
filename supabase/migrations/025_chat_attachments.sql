-- ============================================================================
-- Migration 025: Anexos no chat (imagens, áudios, arquivos)
-- ============================================================================
-- Idempotente. Adiciona campos `attachment_*` em `messages` e cria o bucket
-- `chat-attachments` com RLS por participante da conversa. Também cria a
-- RPC `get_conversation_peer` que retorna informações ricas do "outro
-- usuário" da conversa (foto, empresa do embarcador, caminhão do motorista).
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Colunas de anexo em messages
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_path  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type  TEXT
    CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'audio', 'file')),
  ADD COLUMN IF NOT EXISTS attachment_name  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size  BIGINT,
  ADD COLUMN IF NOT EXISTS attachment_mime  TEXT;

-- Permite mensagens com somente anexo (sem texto). Já que `content NOT NULL`
-- estava ativo, relaxamos pra string vazia ser válida (compatível com data
-- existente).
ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Bucket de anexos do chat
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  20971520, -- 20MB por arquivo
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp','image/heic',
    'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-m4a',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','application/zip'
  ]
)
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS no bucket — formato do path: <conversation_id>/<sender_id>/<file>
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_attachments_insert  ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_select  ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_delete  ON storage.objects;

CREATE POLICY chat_attachments_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id::text = (storage.foldername(name))[1]
         AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
    )
  );

CREATE POLICY chat_attachments_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id::text = (storage.foldername(name))[1]
         AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
    )
  );

CREATE POLICY chat_attachments_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC get_conversation_peer — dados ricos do "outro lado"
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_conversation_peer(UUID);

CREATE OR REPLACE FUNCTION get_conversation_peer(p_conversation_id UUID)
RETURNS TABLE (
  user_id          UUID,
  name             TEXT,
  user_type        TEXT,
  profile_photo    TEXT,
  -- Embarcador
  company_name     TEXT,
  company_logo     TEXT,
  -- Motorista
  vehicle_model    TEXT,
  vehicle_plate    TEXT,
  trailer_axles    INTEGER,
  cargo_capacity   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_caller       UUID := auth.uid();
  v_motorista    UUID;
  v_embarcador   UUID;
  v_other        UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.motorista_id, c.embarcador_id
    INTO v_motorista, v_embarcador
    FROM conversations c
   WHERE c.id = p_conversation_id;

  IF v_motorista IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF v_caller <> v_motorista AND v_caller <> v_embarcador THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  v_other := CASE WHEN v_caller = v_motorista THEN v_embarcador ELSE v_motorista END;

  RETURN QUERY
  SELECT
    u.id,
    u.name::TEXT,
    u.user_type::TEXT,
    u.profile_photo_url::TEXT,
    e.company_name::TEXT,
    e.company_logo_url::TEXT,
    m.vehicle_model::TEXT,
    m.vehicle_plate::TEXT,
    m.trailer_axles,
    m.cargo_capacity_ton
    FROM users u
    LEFT JOIN embarcadores e ON e.id = u.id
    LEFT JOIN motoristas   m ON m.id = u.id
   WHERE u.id = v_other;
END;
$fn$;

GRANT EXECUTE ON FUNCTION get_conversation_peer(UUID) TO authenticated;

COMMIT;
