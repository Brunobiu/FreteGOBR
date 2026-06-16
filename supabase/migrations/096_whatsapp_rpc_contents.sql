-- ============================================================================
-- Migration 096 — Content RPCs (task 9.1)
-- ----------------------------------------------------------------------------
-- RPCs SECURITY DEFINER para gerenciar os WhatsApp_Contents de um disparo,
-- escopados por instance_id. Um disparo suporta MULTIPLOS Contents (Req 6.1),
-- ordenados por `position` para a distribuicao BLOCK/INTERLEAVED (Req 7.3). A
-- validade do Content (`is_valid`) e a regra: tem TEXTO (body nao vazio) OU tem
-- AO MENOS UMA midia associada (whatsapp_content_media). Essa regra (Req 6.5) e
-- enforced server-side: cada upsert RECALCULA is_valid a partir do body recebido
-- e da contagem real de linhas em whatsapp_content_media — o cliente nao decide
-- a validade.
--
--   whatsapp_upsert_content(p_instance_id, p_position, p_content_id = NULL,
--                           p_body = NULL, p_dispatch_job_id = NULL,
--                           p_expected_updated_at = NULL)
--     - ESCRITA, gating SETTINGS_EDIT. Cria (p_content_id NULL) ou atualiza
--       (p_content_id informado) um Content. No update usa versionamento
--       otimista (expected_updated_at) => STALE_VERSION em divergencia.
--     - Persiste com instance_id; valida o dispatch_job_id (quando informado)
--       contra o mesmo instance_id (entidade-filho validada pelo pai).
--     - Recalcula is_valid = (body tem texto) OR (>=1 content_media).
--
--   whatsapp_list_contents(p_instance_id, p_dispatch_job_id = NULL)
--     - LEITURA, gating SETTINGS_VIEW. Lista os Contents da instancia, opcional-
--       mente filtrando por dispatch_job_id, ordenados por position. Inclui
--       media_count e is_valid recalculado.
--
--   whatsapp_delete_content(p_instance_id, p_content_id, p_expected_updated_at = NULL)
--     - ESCRITA, gating SETTINGS_EDIT. Remove o Content (cascade nas midias),
--       escopado por instance_id, com versionamento otimista opcional.
--
-- NOTA: o upload do arquivo de midia + validacao de MIME e a task 9.2
-- (MediaUploader). Aqui apenas LEMOS a contagem de whatsapp_content_media para
-- computar is_valid; nao gravamos midias.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) para evitar conflitos de
-- edicao na migration principal. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)  (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)     (SECTION 14 da 092)
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
-- _Requirements: 6.1, 6.5, 6.6, 2.5_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_contents'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_contents ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_content_media'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_content_media ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- Helper interno: monta o jsonb de um Content recalculando is_valid e a
-- contagem real de midias. Centraliza a regra Req 6.5 (texto OU >=1 midia) e a
-- forma de retorno usada por upsert/list.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_content_to_jsonb(
  p_instance_id uuid,
  p_content_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
           'id',              c.id,
           'instance_id',     c.instance_id,
           'dispatch_job_id', c.dispatch_job_id,
           'body',            c.body,
           'position',        c.position,
           'is_valid',        c.is_valid,
           'media_count',     (
                                 SELECT count(*)
                                   FROM whatsapp_content_media m
                                  WHERE m.content_id = c.id
                                    AND m.instance_id = p_instance_id
                               ),
           'created_at',      c.created_at,
           'updated_at',      c.updated_at
         )
    INTO v_result
    FROM whatsapp_contents c
   WHERE c.id = p_content_id
     AND c.instance_id = p_instance_id;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_content_to_jsonb(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_content_to_jsonb(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_upsert_content(...)
-- ----------------------------------------------------------------------------
-- Cria (p_content_id NULL) ou atualiza (p_content_id informado) um Content
-- escopado por instance_id. is_valid e SEMPRE recalculado server-side:
--   is_valid := (body tem texto nao vazio) OR (>=1 linha em content_media).
-- Em CREATE nao ha midias ainda (sao adicionadas pela task 9.2), entao a
-- validade depende do texto; o upsert posterior (apos anexar midia) recalcula.
CREATE OR REPLACE FUNCTION whatsapp_upsert_content(
  p_instance_id         uuid,
  p_position            int,
  p_content_id          uuid        DEFAULT NULL,
  p_body                text        DEFAULT NULL,
  p_dispatch_job_id     uuid        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_content_id   uuid;
  v_current      timestamptz;
  v_has_text     boolean := (p_body IS NOT NULL AND length(btrim(p_body)) > 0);
  v_media_count  bigint  := 0;
  v_is_valid     boolean;
  v_rows         int;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao de input: position obrigatoria (ordem da distribuicao).
  IF p_position IS NULL THEN
    RAISE EXCEPTION
      'whatsapp_upsert_content: position obrigatoria' USING ERRCODE = '22023';
  END IF;

  -- (d) Entidade-filho validada pelo pai: se um dispatch_job_id e informado,
  --     ele PRECISA pertencer ao mesmo instance_id (isolamento multi-instancia).
  IF p_dispatch_job_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM whatsapp_dispatch_jobs j
       WHERE j.id = p_dispatch_job_id
         AND j.instance_id = p_instance_id
    ) THEN
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_content_id IS NULL THEN
    -- ------------------------------------------------------------------ CREATE
    -- Content novo ainda nao tem midias => is_valid depende apenas do texto.
    v_is_valid := v_has_text;  -- v_media_count = 0

    INSERT INTO whatsapp_contents (instance_id, dispatch_job_id, body, position, is_valid)
    VALUES (p_instance_id, p_dispatch_job_id, p_body, p_position, v_is_valid)
    RETURNING id INTO v_content_id;
  ELSE
    -- ------------------------------------------------------------------ UPDATE
    -- Pre-fetch escopado por instancia: distingue NOT_FOUND de STALE_VERSION.
    SELECT updated_at INTO v_current
      FROM whatsapp_contents
     WHERE id = p_content_id
       AND instance_id = p_instance_id;

    IF NOT FOUND THEN
      -- Inexistente OU de outra instancia => anti-enumeracao (nao revela).
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    -- Versionamento otimista (admin-patterns #3): quando o cliente envia a
    -- versao esperada e ela diverge, aborta com STALE_VERSION.
    IF p_expected_updated_at IS NOT NULL AND v_current <> p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    END IF;

    v_content_id := p_content_id;

    -- Recalcula is_valid com o body novo + a contagem real de midias ja anexadas.
    SELECT count(*) INTO v_media_count
      FROM whatsapp_content_media
     WHERE content_id = v_content_id
       AND instance_id = p_instance_id;

    v_is_valid := v_has_text OR v_media_count >= 1;

    UPDATE whatsapp_contents
       SET body            = p_body,
           position        = p_position,
           dispatch_job_id = COALESCE(p_dispatch_job_id, dispatch_job_id),
           is_valid        = v_is_valid
     WHERE id = v_content_id
       AND instance_id = p_instance_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      -- Corrida: linha removida entre o pre-fetch e o UPDATE.
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN whatsapp_content_to_jsonb(p_instance_id, v_content_id);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_upsert_content(uuid, int, uuid, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_upsert_content(uuid, int, uuid, text, uuid, timestamptz) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_list_contents(p_instance_id uuid, p_dispatch_job_id uuid = NULL)
-- ----------------------------------------------------------------------------
-- LEITURA dos Contents da instancia, ordenados por position. Quando
-- p_dispatch_job_id e informado, filtra os Contents daquele disparo; caso
-- contrario, lista todos os Contents da instancia. Cada item inclui media_count
-- e is_valid (recalculado a partir das midias reais para refletir a regra 6.5
-- mesmo que a coluna persistida esteja defasada).
CREATE OR REPLACE FUNCTION whatsapp_list_contents(
  p_instance_id     uuid,
  p_dispatch_job_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Projecao escopada por instancia, ordenada por position. media_count e
  --     is_valid recalculado refletem a regra Req 6.5 (texto OU >=1 midia).
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',              c.id,
               'instance_id',     c.instance_id,
               'dispatch_job_id', c.dispatch_job_id,
               'body',            c.body,
               'position',        c.position,
               'media_count',     c.media_count,
               'is_valid',        (
                                    (c.body IS NOT NULL AND length(btrim(c.body)) > 0)
                                    OR c.media_count >= 1
                                  ),
               'created_at',      c.created_at,
               'updated_at',      c.updated_at
             )
             ORDER BY c.position, c.created_at
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM (
      SELECT ct.*,
             (
               SELECT count(*)
                 FROM whatsapp_content_media m
                WHERE m.content_id = ct.id
                  AND m.instance_id = p_instance_id
             ) AS media_count
        FROM whatsapp_contents ct
       WHERE ct.instance_id = p_instance_id
         AND (p_dispatch_job_id IS NULL OR ct.dispatch_job_id = p_dispatch_job_id)
    ) c;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_contents(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_contents(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_delete_content(p_instance_id uuid, p_content_id uuid,
--                              p_expected_updated_at timestamptz = NULL)
-- ----------------------------------------------------------------------------
-- ESCRITA: remove um Content escopado por instance_id (cascade nas midias via
-- FK ON DELETE CASCADE em whatsapp_content_media). Versionamento otimista
-- opcional (expected_updated_at) => STALE_VERSION. Content inexistente ou de
-- outra instancia => anti-enumeracao (WHATSAPP_NOT_FOUND). Retorna o id e a
-- contagem de Contents restantes do mesmo disparo.
CREATE OR REPLACE FUNCTION whatsapp_delete_content(
  p_instance_id         uuid,
  p_content_id          uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_current         timestamptz;
  v_dispatch_job_id uuid;
  v_rows            int;
  v_remaining       bigint;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  IF p_content_id IS NULL THEN
    RAISE EXCEPTION
      'whatsapp_delete_content: content_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  -- (c) Pre-fetch escopado por instancia: distingue NOT_FOUND de STALE_VERSION.
  SELECT updated_at, dispatch_job_id
    INTO v_current, v_dispatch_job_id
    FROM whatsapp_contents
   WHERE id = p_content_id
     AND instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_current <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Remocao escopada por instancia (cascade nas midias).
  DELETE FROM whatsapp_contents
   WHERE id = p_content_id
     AND instance_id = p_instance_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Contagem de Contents restantes do mesmo disparo (para a UI reavaliar
  --     se o disparo ainda tem ao menos um Content valido).
  SELECT count(*) INTO v_remaining
    FROM whatsapp_contents
   WHERE instance_id = p_instance_id
     AND (v_dispatch_job_id IS NULL OR dispatch_job_id = v_dispatch_job_id);

  RETURN jsonb_build_object(
           'id',              p_content_id,
           'dispatch_job_id', v_dispatch_job_id,
           'remaining',       v_remaining
         );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_delete_content(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_delete_content(uuid, uuid, timestamptz) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Criar um Content com texto => is_valid = true:
SELECT jsonb_pretty(whatsapp_upsert_content('<instance_id>', 0, NULL, 'Ola {{nome}}'));

-- 2) Criar um Content SEM texto e SEM midia => is_valid = false (so texto/midia valida):
SELECT jsonb_pretty(whatsapp_upsert_content('<instance_id>', 1, NULL, NULL));

-- 3) Listar Contents da instancia (ordenados por position):
SELECT jsonb_pretty(whatsapp_list_contents('<instance_id>'));

-- 4) Atualizar com versao esperada divergente => STALE_VERSION:
SELECT whatsapp_upsert_content('<instance_id>', 0, '<content_id>', 'novo texto',
                               NULL, '1999-01-01T00:00:00Z');

-- 5) Content de outra instancia / inexistente => WHATSAPP_NOT_FOUND (P0001):
SELECT whatsapp_upsert_content('<instance_id>', 0,
                               '00000000-0000-0000-0000-000000000000', 'x');

-- 6) Remover Content:
SELECT jsonb_pretty(whatsapp_delete_content('<instance_id>', '<content_id>'));

-- 7) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
