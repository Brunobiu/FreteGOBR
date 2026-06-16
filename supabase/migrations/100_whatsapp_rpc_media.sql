-- ============================================================================
-- Migration 100 — Content_Media RPCs (task 9.2)
-- ----------------------------------------------------------------------------
-- RPCs SECURITY DEFINER para anexar/remover midias (WhatsApp_Content_Media) de
-- um WhatsApp_Content, escopadas por instance_id. Um Content aceita QUALQUER
-- combinacao de texto + imagem/video/audio/documento (Req 6.2); estas RPCs
-- tratam apenas a parte de MIDIA. O upload do arquivo em si vai para o bucket
-- privado `whatsapp-media` (path <instance_id>/<content_id>/<filename>, criado
-- na 092) na camada de servico (src/services/admin/whatsapp/media.ts); aqui
-- apenas REGISTRAMOS/REMOVEMOS a linha em whatsapp_content_media e recalculamos
-- a validade do Content-pai (Req 6.5: texto OU >=1 midia).
--
--   whatsapp_add_content_media(p_instance_id, p_content_id, p_media_type,
--                              p_storage_path, p_mime_type)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8, 30.8).
--     - Entidade-filho validada pelo pai: o Content PRECISA pertencer ao mesmo
--       instance_id (isolamento multi-instancia).
--     - Valida media_type (dominio fechado IMAGE|VIDEO|AUDIO|DOCUMENT) e exige
--       storage_path/mime_type nao vazios. A validacao de MIME suportado
--       (INVALID_FILE_TYPE — Req 6.3) ja ocorre antes do upload na camada de
--       servico (validateMimeType); aqui garantimos apenas a integridade basica.
--     - Insere a linha e RECALCULA is_valid do Content (texto OU >=1 midia).
--     - Retorna o jsonb da midia criada.
--
--   whatsapp_remove_content_media(p_instance_id, p_media_id)
--     - ESCRITA, gating SETTINGS_EDIT.
--     - Anti-enumeracao via whatsapp_assert_instance; midia inexistente ou de
--       outra instancia => WHATSAPP_NOT_FOUND (P0001), sem revelar existencia.
--     - Remove a linha e RECALCULA is_valid do Content-pai. Retorna o id, o
--       content_id, o storage_path (para a camada de servico apagar o objeto no
--       bucket) e a contagem de midias restantes no Content.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) para evitar conflitos de
-- edicao na migration principal. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)  (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)     (SECTION 14 da 092)
--   - dominio public.media_type                        (SECTION 2 da 092)
--   - tabela public.whatsapp_contents                  (SECTION 5 da 092)
--   - tabela public.whatsapp_content_media             (SECTION 5 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- anti-enumeracao via whatsapp_assert_instance; REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO authenticated. Nunca exposta ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 6.2, 6.3, 6.4, 6.5, 2.5_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_require_permission'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_require_permission ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_assert_instance'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_assert_instance ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_content_media'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_content_media ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_contents'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_contents ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- Helper interno: recalcula is_valid de um Content (Req 6.5) a partir do texto
-- atual e da contagem real de midias. Centraliza a regra usada por add/remove.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_recompute_content_validity(
  p_instance_id uuid,
  p_content_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_has_text    boolean;
  v_media_count bigint;
BEGIN
  SELECT (body IS NOT NULL AND length(btrim(body)) > 0)
    INTO v_has_text
    FROM whatsapp_contents
   WHERE id = p_content_id
     AND instance_id = p_instance_id;

  SELECT count(*)
    INTO v_media_count
    FROM whatsapp_content_media
   WHERE content_id = p_content_id
     AND instance_id = p_instance_id;

  UPDATE whatsapp_contents
     SET is_valid = COALESCE(v_has_text, false) OR v_media_count >= 1
   WHERE id = p_content_id
     AND instance_id = p_instance_id;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_recompute_content_validity(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_recompute_content_validity(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_add_content_media(...)
-- ----------------------------------------------------------------------------
-- Registra uma midia ja enviada ao bucket whatsapp-media e a associa ao Content,
-- escopada por instance_id. Recalcula is_valid do Content (texto OU >=1 midia).
CREATE OR REPLACE FUNCTION whatsapp_add_content_media(
  p_instance_id  uuid,
  p_content_id   uuid,
  p_media_type   text,
  p_storage_path text,
  p_mime_type    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_media_id uuid;
  v_result   jsonb;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao de input basica.
  IF p_content_id IS NULL THEN
    RAISE EXCEPTION
      'whatsapp_add_content_media: content_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  IF p_media_type IS NULL OR p_media_type NOT IN ('IMAGE','VIDEO','AUDIO','DOCUMENT') THEN
    RAISE EXCEPTION
      'whatsapp_add_content_media: media_type invalido "%": esperado IMAGE|VIDEO|AUDIO|DOCUMENT',
      p_media_type
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NULL OR length(btrim(p_storage_path)) = 0 THEN
    RAISE EXCEPTION
      'whatsapp_add_content_media: storage_path obrigatorio' USING ERRCODE = '22023';
  END IF;

  IF p_mime_type IS NULL OR length(btrim(p_mime_type)) = 0 THEN
    RAISE EXCEPTION
      'whatsapp_add_content_media: mime_type obrigatorio' USING ERRCODE = '22023';
  END IF;

  -- (d) Entidade-filho validada pelo pai: o Content PRECISA pertencer a mesma
  --     instancia (isolamento multi-instancia). Inexistente/cruzado => anti-enum.
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_contents c
     WHERE c.id = p_content_id
       AND c.instance_id = p_instance_id
  ) THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Insere a midia escopada por instancia.
  INSERT INTO whatsapp_content_media (instance_id, content_id, media_type, storage_path, mime_type)
  VALUES (p_instance_id, p_content_id, p_media_type::media_type, p_storage_path, p_mime_type)
  RETURNING id INTO v_media_id;

  -- (f) Recalcula a validade do Content-pai (texto OU >=1 midia).
  PERFORM whatsapp_recompute_content_validity(p_instance_id, p_content_id);

  SELECT jsonb_build_object(
           'id',           m.id,
           'instance_id',  m.instance_id,
           'content_id',   m.content_id,
           'media_type',   m.media_type,
           'storage_path', m.storage_path,
           'mime_type',    m.mime_type,
           'created_at',   m.created_at,
           'updated_at',   m.updated_at
         )
    INTO v_result
    FROM whatsapp_content_media m
   WHERE m.id = v_media_id
     AND m.instance_id = p_instance_id;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_add_content_media(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_add_content_media(uuid, uuid, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_remove_content_media(p_instance_id uuid, p_media_id uuid)
-- ----------------------------------------------------------------------------
-- Remove uma midia escopada por instance_id e recalcula is_valid do Content-pai.
-- Midia inexistente/cruzada => WHATSAPP_NOT_FOUND. Retorna id, content_id,
-- storage_path (para a camada de servico apagar o objeto) e midias restantes.
CREATE OR REPLACE FUNCTION whatsapp_remove_content_media(
  p_instance_id uuid,
  p_media_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_content_id   uuid;
  v_storage_path text;
  v_rows         int;
  v_remaining    bigint;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  IF p_media_id IS NULL THEN
    RAISE EXCEPTION
      'whatsapp_remove_content_media: media_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  -- (c) Pre-fetch escopado por instancia: inexistente/cruzado => anti-enum.
  SELECT content_id, storage_path
    INTO v_content_id, v_storage_path
    FROM whatsapp_content_media
   WHERE id = p_media_id
     AND instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Remocao escopada por instancia.
  DELETE FROM whatsapp_content_media
   WHERE id = p_media_id
     AND instance_id = p_instance_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Recalcula a validade do Content-pai (texto OU >=1 midia).
  PERFORM whatsapp_recompute_content_validity(p_instance_id, v_content_id);

  -- (f) Contagem de midias restantes no mesmo Content.
  SELECT count(*) INTO v_remaining
    FROM whatsapp_content_media
   WHERE content_id = v_content_id
     AND instance_id = p_instance_id;

  RETURN jsonb_build_object(
           'id',           p_media_id,
           'content_id',   v_content_id,
           'storage_path', v_storage_path,
           'remaining',    v_remaining
         );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_remove_content_media(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_remove_content_media(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e crie um Content:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT whatsapp_upsert_content('<instance_id>', 0, NULL, NULL);  -- sem texto => is_valid false

-- 1) Anexar uma midia => Content vira valido (Req 6.5):
SELECT jsonb_pretty(whatsapp_add_content_media(
  '<instance_id>', '<content_id>', 'IMAGE',
  '<instance_id>/<content_id>/foto.jpg', 'image/jpeg'));

-- 2) media_type invalido => 22023:
SELECT whatsapp_add_content_media('<instance_id>', '<content_id>', 'GIFANIM',
  '<instance_id>/<content_id>/x', 'image/gif');

-- 3) Content de outra instancia / inexistente => WHATSAPP_NOT_FOUND (P0001):
SELECT whatsapp_add_content_media('<instance_id>',
  '00000000-0000-0000-0000-000000000000', 'IMAGE', 'x/y/z', 'image/png');

-- 4) Remover a midia => retorna storage_path para apagar o objeto:
SELECT jsonb_pretty(whatsapp_remove_content_media('<instance_id>', '<media_id>'));

-- 5) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
