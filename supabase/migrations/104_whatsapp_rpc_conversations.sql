-- ============================================================================
-- Migration 104 — whatsapp_list_conversations / whatsapp_get_conversation (task 17.1)
-- ----------------------------------------------------------------------------
-- RPCs de LEITURA da Central de Conversas (Conversation_Inbox, Req 30). Ambas
-- escopadas por instance_id, materializando o isolamento multi-instancia: uma
-- conversa pertence a EXATAMENTE um instance_id e nunca e listada/aberta a
-- partir de outra instancia (Req 30.1, 30.6, 30.8, 31.18).
--
--   whatsapp_list_conversations(p_instance_id, p_mode, p_limit, p_offset)
--     - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC, Req 30.7).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8, 30.8).
--     - Lista as Conversations da instancia em ordem cronologica inversa
--       (last_message_at DESC NULLS LAST) — a mais recente primeiro. Filtro
--       opcional por Conversation_Mode (dominio fechado). Cada item carrega o
--       identificador do contato, a previa da ultima mensagem, o horario da
--       ultima mensagem e o Conversation_Mode atual (Req 30.2).
--     - Paginacao leve por p_limit/p_offset (default 50/0).
--     - Retorna SEMPRE um array jsonb (vazio quando nao ha conversas).
--
--   whatsapp_get_conversation(p_instance_id, p_conversation_id)
--     - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC, Req 30.7).
--     - Anti-enumeracao via whatsapp_assert_instance (instancia) e por conversa:
--       conversation_id inexistente OU de OUTRA instancia => marker canonico
--       WHATSAPP_NOT_FOUND (ERRCODE P0001), sem revelar a existencia (Req 30.8).
--     - Retorna a conversa (contato, modo, previa, horario, updated_at) + o
--       historico COMPLETO de mensagens (recebidas e enviadas) em ordem
--       cronologica ascendente (created_at ASC) — Req 30.3.
--
-- ESCOPO 17.1: apenas LEITURA (listagem/detalhe). As transicoes de modo
-- (Human_Takeover / Return_To_AI) sao a task 17.2 e NAO fazem parte desta
-- migration.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs para
-- evitar conflitos de edicao. Numero 104 reservado para esta onda (103/105+
-- pertencem a outras ondas). Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_conversations              (SECTION 8 da 092)
--   - tabela public.whatsapp_messages                   (SECTION 8 da 092)
--   - dominio public.conversation_mode                  (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- ('SETTINGS_VIEW') no topo do corpo (camada 2 do RBAC, com log negativo
-- WHATSAPP_VIEW_DENIED em falha); anti-enumeracao via whatsapp_assert_instance;
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta ao
-- role anon. Nenhuma resposta/log carrega segredo.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 30.1, 30.2, 30.3, 30.6, 30.7, 30.8_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_conversations ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_messages ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_list_conversations(p_instance_id, p_mode, p_limit, p_offset)
-- ----------------------------------------------------------------------------
-- LEITURA da lista de Conversations da instancia (Req 30.1, 30.2, 30.6). Cada
-- item do array jsonb carrega:
--   - id                   : uuid da conversa
--   - contact_phone        : identificador do contato (Contact_Number)
--   - mode                 : Conversation_Mode atual (indicador na UI)
--   - responder_lock       : 'AI' | 'HUMAN' | NULL (responsavel unico)
--   - last_message_preview : previa da ultima mensagem
--   - last_message_at      : horario da ultima mensagem
--   - created_at / updated_at : timestamps de versao
--
-- Ordenacao: last_message_at DESC NULLS LAST, depois created_at DESC — a
-- conversa mais recente primeiro. p_mode opcional filtra por Conversation_Mode
-- (dominio fechado); NULL = todas. Paginacao por p_limit/p_offset.
CREATE OR REPLACE FUNCTION whatsapp_list_conversations(
  p_instance_id uuid,
  p_mode        text DEFAULT NULL,
  p_limit       int  DEFAULT 50,
  p_offset      int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  -- Limites defensivos de paginacao (evita scans gigantes).
  c_max_limit constant int := 200;
  v_limit  int;
  v_offset int;
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard. Em falha grava
  --     WHATSAPP_VIEW_DENIED e lanca permission_denied (ERRCODE 42501). Req 30.7.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada; caso
  --     contrario, marker canonico WHATSAPP_NOT_FOUND (Req 2.8, 30.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao do filtro de modo (dominio fechado). NULL = sem filtro.
  IF p_mode IS NOT NULL
     AND p_mode NOT IN ('AI_MODE','HUMAN_MODE','AI_PAUSED','RETURNED_TO_AI') THEN
    RAISE EXCEPTION 'INVALID_CONVERSATION_MODE' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Normaliza a paginacao (defaults seguros, dentro do limite hard).
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), c_max_limit);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- (e) Lista escopada por instance_id, ordem cronologica inversa. Sempre array.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',                   c.id,
               'contact_phone',        c.contact_phone,
               'mode',                 c.mode,
               'responder_lock',       c.responder_lock,
               'last_message_preview', c.last_message_preview,
               'last_message_at',      c.last_message_at,
               'created_at',           c.created_at,
               'updated_at',           c.updated_at
             )
             ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM (
      SELECT *
        FROM whatsapp_conversations w
       WHERE w.instance_id = p_instance_id
         AND (p_mode IS NULL OR w.mode = p_mode)
       ORDER BY w.last_message_at DESC NULLS LAST, w.created_at DESC
       LIMIT v_limit OFFSET v_offset
    ) c;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_conversations(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_conversations(uuid, text, int, int) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_conversation(p_instance_id, p_conversation_id)
-- ----------------------------------------------------------------------------
-- LEITURA do detalhe de UMA Conversation + historico cronologico completo
-- (Req 30.3). Retorna jsonb:
--   {
--     id, contact_phone, mode, responder_lock,
--     last_message_preview, last_message_at, created_at, updated_at,
--     messages: [ { id, direction, body, created_at }, ... ]  -- created_at ASC
--   }
--
-- Isolamento por instancia (Req 30.6, 30.8, 31.18): conversation_id inexistente
-- OU pertencente a OUTRA instancia => marker canonico WHATSAPP_NOT_FOUND
-- (ERRCODE P0001), resposta indistinguivel (sem revelar existencia).
CREATE OR REPLACE FUNCTION whatsapp_get_conversation(
  p_instance_id    uuid,
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_conv   whatsapp_conversations%ROWTYPE;
  v_msgs   jsonb;
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard. Req 30.7.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao de instancia (Req 2.8, 30.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Carrega a conversa SOMENTE quando pertence a esta instancia. Conversa
  --     inexistente ou cruzada => WHATSAPP_NOT_FOUND (anti-enumeracao, Req 30.8).
  SELECT * INTO v_conv
    FROM whatsapp_conversations c
   WHERE c.id = p_conversation_id
     AND c.instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Historico completo (recebidas e enviadas) em ordem cronologica ASC
  --     (Req 30.3). Escopado pela conversa E pela instancia (defesa extra).
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',         m.id,
               'direction',  m.direction,
               'body',       m.body,
               'created_at', m.created_at
             )
             ORDER BY m.created_at ASC, m.id ASC
           ),
           '[]'::jsonb
         )
    INTO v_msgs
    FROM whatsapp_messages m
   WHERE m.conversation_id = v_conv.id
     AND m.instance_id = p_instance_id;

  -- (e) Monta o detalhe da conversa + historico.
  v_result := jsonb_build_object(
    'id',                   v_conv.id,
    'contact_phone',        v_conv.contact_phone,
    'mode',                 v_conv.mode,
    'responder_lock',       v_conv.responder_lock,
    'last_message_preview', v_conv.last_message_preview,
    'last_message_at',      v_conv.last_message_at,
    'created_at',           v_conv.created_at,
    'updated_at',           v_conv.updated_at,
    'messages',             v_msgs
  );

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_conversation(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Lista (array vazio quando nao ha conversas):
SELECT jsonb_pretty(whatsapp_list_conversations('<instance_id>'));

-- 2) Lista filtrada por modo HUMAN_MODE:
SELECT jsonb_pretty(whatsapp_list_conversations('<instance_id>', 'HUMAN_MODE'));

-- 3) Filtro de modo invalido => INVALID_CONVERSATION_MODE:
SELECT whatsapp_list_conversations('<instance_id>', 'BOGUS');

-- 4) Detalhe com historico cronologico:
SELECT jsonb_pretty(whatsapp_get_conversation('<instance_id>', '<conversation_id>'));

-- 5) Conversa de outra instancia/inexistente => WHATSAPP_NOT_FOUND (P0001):
SELECT whatsapp_get_conversation('<instance_id>', '00000000-0000-0000-0000-000000000000');

-- 6) Instancia inexistente => anti-enumeracao (WHATSAPP_NOT_FOUND / P0001):
SELECT whatsapp_list_conversations('00000000-0000-0000-0000-000000000000');

-- 7) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
