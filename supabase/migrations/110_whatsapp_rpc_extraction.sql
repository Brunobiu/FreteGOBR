-- ============================================================================
-- Migration 110 — whatsapp_record_extraction (task 18.1)
-- ----------------------------------------------------------------------------
-- RPC de PERSISTENCIA de uma Contact_Extraction (Req 17). Recebe a lista de
-- Contact_Numbers extraidos dos participantes dos WhatsApp_Groups selecionados
-- (ja obtidos pela camada de servico via proxy Evolution `listParticipants`,
-- com degradacao parcial por grupo) e os grava em `whatsapp_extracted_contacts`
-- sob um unico `extraction_id` gerado pela propria RPC, SEMPRE escopado ao
-- `instance_id` informado (Req 17.15 — opera so sobre a Active_Instance).
--
--   whatsapp_record_extraction(p_instance_id uuid, p_contacts jsonb)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC) via
--       whatsapp_require_permission, com log negativo WHATSAPP_VIEW_DENIED em
--       falha (admin-patterns #1, #2, #10).
--     - Anti-enumeracao via whatsapp_assert_instance: instancia inexistente OU
--       cruzada => WHATSAPP_NOT_FOUND (P0001), resposta indistinguivel
--       (Req 2.8, 30.8).
--     - p_contacts: array JSON de objetos
--         { "phone": text, "source_group_jid": text|null, "is_valid": bool? }.
--       Itens sem phone sao ignorados. is_valid default true (a deduplicacao /
--       revalidacao fina pertence a task 18.2; aqui apenas persiste o bruto).
--     - Gera v_extraction_id (gen_random_uuid) agrupando todos os contatos
--       desta operacao e insere as linhas escopadas por (instance_id,
--       extraction_id).
--     - Retorna { extraction_id, instance_id, total_count, recorded_at }.
--
-- O AUDIT positivo (com `instance_id` e nº de grupos analisados — Req 17.16) e
-- gravado por construcao na camada de servico (`extraction.ts`) via
-- `executeAdminMutation`, que envolve esta RPC. A degradacao parcial (grupos
-- que falharam sem abortar) e a indisponibilidade total (todos falharam =>
-- Canonical_Message `Nao foi possivel concluir a operacao.`) sao decididas na
-- camada de servico ANTES de chamar esta RPC — aqui so chega o conjunto dos
-- contatos dos grupos bem-sucedidos.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs para
-- evitar conflitos de edicao. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_extracted_contacts         (SECTION 7 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (log negativo WHATSAPP_VIEW_DENIED em falha); anti-enumeracao
-- via whatsapp_assert_instance; REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
-- authenticated. Nunca exposta ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 17.4, 17.11, 17.12, 17.13, 17.16_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_extracted_contacts'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_extracted_contacts ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_record_extraction(p_instance_id uuid, p_contacts jsonb)
-- ----------------------------------------------------------------------------
-- Persiste os Contact_Numbers de uma Contact_Extraction sob um unico
-- extraction_id, escopado por instance_id. ESCRITA — gating SETTINGS_EDIT.
CREATE OR REPLACE FUNCTION whatsapp_record_extraction(
  p_instance_id uuid,
  p_contacts    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_extraction_id uuid := gen_random_uuid();
  v_recorded_at   timestamptz := now();
  v_total_count   bigint := 0;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard. Loga
  --     WHATSAPP_VIEW_DENIED e aborta com permission_denied em falha.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada; caso
  --     contrario, marker canonico WHATSAPP_NOT_FOUND (Req 2.8, 30.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Insere os contatos extraidos sob o mesmo extraction_id, SEMPRE
  --     escopados por p_instance_id (Req 17.15). Itens sem phone sao ignorados.
  --     is_valid default true (revalidacao/deduplicacao fina e task 18.2).
  INSERT INTO whatsapp_extracted_contacts (
    instance_id, extraction_id, source_group_jid, phone, is_valid
  )
  SELECT
    p_instance_id,
    v_extraction_id,
    NULLIF(c->>'source_group_jid', ''),
    c->>'phone',
    COALESCE((c->>'is_valid')::boolean, true)
  FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) AS c
  WHERE COALESCE(c->>'phone', '') <> '';

  GET DIAGNOSTICS v_total_count = ROW_COUNT;

  -- (d) Contrato estavel para a camada de servico.
  RETURN jsonb_build_object(
    'extraction_id', v_extraction_id,
    'instance_id',   p_instance_id,
    'total_count',   v_total_count,
    'recorded_at',   v_recorded_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_record_extraction(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_record_extraction(uuid, jsonb) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Grava uma extracao com 2 contatos de grupos distintos:
SELECT jsonb_pretty(whatsapp_record_extraction(
  '<instance_id>',
  '[{"phone":"5511999999999","source_group_jid":"123@g.us"},
    {"phone":"5511888888888","source_group_jid":"456@g.us","is_valid":true}]'::jsonb
));

-- 2) Confere as linhas persistidas sob o extraction_id retornado:
SELECT extraction_id, source_group_jid, phone, is_valid
  FROM whatsapp_extracted_contacts
 WHERE instance_id = '<instance_id>'
 ORDER BY created_at DESC LIMIT 10;

-- 3) Lista vazia / sem phone => 0 linhas, mas gera extraction_id valido:
SELECT whatsapp_record_extraction('<instance_id>', '[]'::jsonb);

-- 4) Instancia inexistente => anti-enumeracao (WHATSAPP_NOT_FOUND / P0001):
SELECT whatsapp_record_extraction('00000000-0000-0000-0000-000000000000', '[]'::jsonb);

-- 5) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
