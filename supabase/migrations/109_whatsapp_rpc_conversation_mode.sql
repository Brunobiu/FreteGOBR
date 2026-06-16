-- ============================================================================
-- Migration 109 — whatsapp_transition_conversation_mode (task 17.2)
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que aplica a MAQUINA DE ESTADOS do Conversation_Mode
-- (Req 31) para as transicoes de responsavel unico de uma Conversation.
-- Escopada por `instance_id` da Active_Instance e por `conversation_id`. E a
-- contraparte server-side dos botoes "Assumir Atendimento" (Human_Takeover) e
-- "Retornar para IA" (Return_To_AI) do Conversation_Inbox, e tambem do handoff
-- AUTOMATICO disparado pela IA quando nao ha resposta adequada.
--
--   whatsapp_transition_conversation_mode(p_instance_id, p_conversation_id,
--                                         p_action, p_expected_updated_at)
--
-- Acoes (dominio fechado) e transicoes (espelham design.md > Conversation_Mode SM):
--   * HUMAN_TAKEOVER : {AI_MODE, RETURNED_TO_AI, AI_PAUSED} -> HUMAN_MODE
--       "Assumir Atendimento" (Req 31.6): trava a IA imediatamente, responsavel
--       passa a ser humano (responder_lock = 'HUMAN').
--   * AI_HANDOFF     : {AI_MODE, RETURNED_TO_AI}            -> HUMAN_MODE
--       Handoff AUTOMATICO da IA (Req 31.4): registra a AI_Handoff_Message da
--       instancia (whatsapp_ai_configs.handoff_message) como mensagem OUTBOUND
--       no historico e trava em HUMAN_MODE (responder_lock = 'HUMAN').
--   * RETURN_TO_AI   : {HUMAN_MODE, AI_PAUSED}              -> RETURNED_TO_AI
--       "Retornar para IA" (Req 31.7): devolve o atendimento a IA, que volta a
--       responder usando o historico COMPLETO preservado (Req 31.8, 31.19);
--       responder_lock = 'AI'.
--
-- Semantica de resultado (admin-patterns #3, #4):
--   * JA APLICADA (Req 31.15): o Conversation_Mode atual ja corresponde ao
--     destino logico da acao (ex.: Human_Takeover em conversa ja HUMAN_MODE; ou
--     Return_To_AI em conversa ja em modo AI-allowed AI_MODE/RETURNED_TO_AI):
--     IDEMPOTENCIA — NAO muta, grava audit `<ACTION>_SKIPPED` DENTRO desta RPC
--     (skip nao usa executeAdminMutation) e retorna { skipped:true, reason }.
--   * Versionamento otimista (Req 31.14): a UPDATE da transicao valida filtra
--     por `updated_at = p_expected_updated_at`. ROW_COUNT = 0 => distingue, via
--     re-SELECT, STALE_VERSION (outra escrita concorrente) de WHATSAPP_NOT_FOUND
--     (linha sumiu) e lanca o marker apropriado.
--   * FORA DO DOMINIO (Req 31.20): p_action que nao pertence ao conjunto
--     fechado {HUMAN_TAKEOVER, AI_HANDOFF, RETURN_TO_AI} => marker
--     INVALID_CONVERSATION_MODE (ERRCODE P0001), aborta sem efeito.
--   * VALIDA: muta `mode` (+ responder_lock e, no AI_HANDOFF, registra a
--     AI_Handoff_Message no historico) e retorna { ok:true, id, instance_id,
--     action, previous_mode, mode, updated_at }. O AUDIT da transicao valida
--     (Req 31.13: modo anterior/novo + instance_id + conversa) e gravado pela
--     camada TS (conversations.ts via executeAdminMutation, task 17.2), que
--     recebe previous_mode/mode/instance_id no retorno desta RPC.
--
-- RESPONSAVEL UNICO SOB LOCK (Req 31.2): a leitura do modo atual e feita com
-- `SELECT mode ... FOR UPDATE` na linha da Conversation, no mesmo caminho que
-- decide e aplica a transicao. Isso serializa transicoes concorrentes e elimina
-- a corrida entre handoff/takeover e o auto-reply do webhook (que tambem trava
-- a conversation com FOR UPDATE — migration 102/098), garantindo que nunca haja
-- IA e humano respondendo simultaneamente.
--
-- HISTORICO PRESERVADO (Req 31.19): a RPC nunca apaga whatsapp_messages; apenas
-- INSERE (AI_Handoff_Message) e atualiza o `mode`/`responder_lock`. Em caso de
-- STALE_VERSION/NOT_FOUND, o RAISE aborta a transacao e desfaz qualquer INSERT.
--
-- ISOLAMENTO POR INSTANCIA/CONVERSA (Req 31.17, 31.18): toda leitura/escrita e
-- escopada por (id = p_conversation_id AND instance_id = p_instance_id); uma
-- conversa inexistente OU de OUTRA instancia => WHATSAPP_NOT_FOUND
-- (anti-enumeracao, Req 30.8). Uma transicao jamais le/altera outra conversa.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs
-- (093..105) para evitar conflitos de edicao. Numero 109 reservado para esta
-- onda. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_conversations              (SECTION 8 da 092)
--   - tabela public.whatsapp_messages                   (SECTION 8 da 092)
--   - tabela public.whatsapp_ai_configs                 (SECTION 8 da 092)
--   - dominio public.conversation_mode / msg_direction  (SECTION 2 da 092)
--   - trigger trg_whatsapp_conversations_touch (touch de updated_at) (SECTION 8)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- ('SETTINGS_EDIT') no topo do corpo (camada 2 do RBAC, com log negativo
-- WHATSAPP_VIEW_DENIED em falha); anti-enumeracao via whatsapp_assert_instance;
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta a anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 30.4, 30.9, 31.1, 31.4, 31.6, 31.7, 31.8, 31.13, 31.14, 31.15,
--                31.16, 31.17, 31.18, 31.19, 31.20_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- Aborta cedo (sem criar objetos orfaos) se os pre-requisitos faltarem.
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

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_ai_configs'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_ai_configs ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_transition_conversation_mode(...)
-- ----------------------------------------------------------------------------
-- p_action e um text de dominio fechado {HUMAN_TAKEOVER, AI_HANDOFF, RETURN_TO_AI};
-- valores fora do dominio abortam com INVALID_CONVERSATION_MODE (Req 31.20).
-- p_expected_updated_at carrega o updated_at lido pelo cliente antes de acionar
-- a transicao (versionamento otimista, admin-patterns #3, Req 31.14).
CREATE OR REPLACE FUNCTION whatsapp_transition_conversation_mode(
  p_instance_id         uuid,
  p_conversation_id     uuid,
  p_action              text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid;
  v_action         text;
  v_current_mode   text;    -- Conversation_Mode atual (lido sob FOR UPDATE)
  v_target_mode    text;    -- modo-alvo da acao
  v_target_lock    text;    -- responder_lock resultante ('AI' | 'HUMAN')
  v_is_skip        boolean := false;  -- a acao ja esta aplicada (idempotencia)?
  v_skip_reason    text;
  v_handoff        text;    -- AI_Handoff_Message (apenas AI_HANDOFF)
  v_handoff_sent   boolean := false;
  v_new_updated_at timestamptz;
  v_rows           int;
  v_still_exists   boolean;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard (Req 31.16). Em falha
  --     grava WHATSAPP_VIEW_DENIED e aborta com permission_denied (42501).
  v_caller := whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao de instancia: inexistente/desabilitada/cruzada =>
  --     WHATSAPP_NOT_FOUND (Req 2.8). Mapeado para Canonical_Message no TS.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Dominio fechado da acao (Req 31.20). Acao fora do conjunto =>
  --     INVALID_CONVERSATION_MODE (revalidado no backend; o frontend tambem
  --     valida — defesa em profundidade).
  v_action := upper(btrim(COALESCE(p_action, '')));
  IF v_action NOT IN ('HUMAN_TAKEOVER', 'AI_HANDOFF', 'RETURN_TO_AI') THEN
    RAISE EXCEPTION 'INVALID_CONVERSATION_MODE' USING ERRCODE = 'P0001';
  END IF;

  -- (d) LOCK do responsavel unico (Req 31.2): carrega o modo atual com
  --     FOR UPDATE, escopado por (conversa + instancia). Conversa inexistente
  --     OU de OUTRA instancia => WHATSAPP_NOT_FOUND (anti-enum, Req 30.8, 31.18).
  SELECT mode::text
    INTO v_current_mode
    FROM whatsapp_conversations
   WHERE id = p_conversation_id
     AND instance_id = p_instance_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Resolve o modo-alvo, o responder_lock e a condicao de idempotencia.
  CASE v_action
    WHEN 'HUMAN_TAKEOVER' THEN
      v_target_mode := 'HUMAN_MODE';
      v_target_lock := 'HUMAN';
      -- ja aplicada se a conversa ja esta sob responsabilidade humana.
      v_is_skip := (v_current_mode = 'HUMAN_MODE');
    WHEN 'AI_HANDOFF' THEN
      v_target_mode := 'HUMAN_MODE';
      v_target_lock := 'HUMAN';
      v_is_skip := (v_current_mode = 'HUMAN_MODE');
    WHEN 'RETURN_TO_AI' THEN
      v_target_mode := 'RETURNED_TO_AI';
      v_target_lock := 'AI';
      -- ja aplicada se a conversa ja esta em modo AI-allowed (IA ja responde).
      v_is_skip := (v_current_mode IN ('AI_MODE', 'RETURNED_TO_AI'));
  END CASE;

  -- (f) IDEMPOTENCIA (Req 31.15): a acao ja esta aplicada => NAO muta. Grava o
  --     audit `<ACTION>_SKIPPED` DENTRO desta RPC (admin-patterns #4: skip nao
  --     usa executeAdminMutation) e retorna skip. Tem precedencia sobre o
  --     versionamento (no-op nao depende da versao informada).
  IF v_is_skip THEN
    v_skip_reason := 'ALREADY_' || v_current_mode;

    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    )
    VALUES (
      v_caller,
      'WHATSAPP_CONVERSATION_' || v_action || '_SKIPPED',
      'whatsapp_conversations',
      p_conversation_id,
      jsonb_build_object('instance_id', p_instance_id, 'mode', v_current_mode),
      jsonb_build_object('instance_id', p_instance_id, 'reason', v_skip_reason)
    );

    RETURN jsonb_build_object('skipped', true, 'reason', v_skip_reason);
  END IF;

  -- (g) Handoff AUTOMATICO da IA (Req 31.4): registra a AI_Handoff_Message da
  --     instancia como mensagem OUTBOUND no historico ANTES de travar em
  --     HUMAN_MODE. Apenas INSERT (historico preservado, Req 31.19). Se nao ha
  --     handoff_message configurada, apenas transiciona (sem mensagem).
  IF v_action = 'AI_HANDOFF' THEN
    SELECT handoff_message
      INTO v_handoff
      FROM whatsapp_ai_configs
     WHERE instance_id = p_instance_id;

    IF v_handoff IS NOT NULL AND btrim(v_handoff) <> '' THEN
      INSERT INTO whatsapp_messages(instance_id, conversation_id, direction, body)
      VALUES (p_instance_id, p_conversation_id, 'OUTBOUND', v_handoff);
      v_handoff_sent := true;
    END IF;
  END IF;

  -- (h) TRANSICAO VALIDA com versionamento otimista (Req 31.14). O trigger
  --     trg_whatsapp_conversations_touch atualiza updated_at apos o match do
  --     WHERE (que usa o updated_at ANTIGO informado pelo cliente). Quando a
  --     AI_Handoff_Message foi registrada, atualiza tambem a previa/horario da
  --     ultima mensagem para refletir no Conversation_Inbox.
  UPDATE whatsapp_conversations
     SET mode                 = v_target_mode::conversation_mode,
         responder_lock       = v_target_lock,
         last_message_preview = CASE WHEN v_handoff_sent
                                     THEN left(v_handoff, 200)
                                     ELSE last_message_preview END,
         last_message_at      = CASE WHEN v_handoff_sent
                                     THEN now()
                                     ELSE last_message_at END
   WHERE id = p_conversation_id
     AND instance_id = p_instance_id
     AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_new_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- (i) ROW_COUNT = 0: o pre-fetch (d) encontrou a linha (e a travou), logo o
  --     nao-match aqui e por versao desatualizada (p_expected_updated_at !=
  --     updated_at atual) OU por delecao concorrente. Distingue via re-SELECT.
  IF v_rows = 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM whatsapp_conversations
       WHERE id = p_conversation_id AND instance_id = p_instance_id
    ) INTO v_still_exists;

    IF v_still_exists THEN
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (j) Retorno da transicao valida. previous_mode/mode/instance_id sao
  --     consumidos pela camada TS (task 17.2) para o audit via
  --     executeAdminMutation (Req 31.13). updated_at e a nova versao otimista.
  RETURN jsonb_build_object(
    'ok',            true,
    'id',            p_conversation_id,
    'instance_id',   p_instance_id,
    'action',        v_action,
    'previous_mode', v_current_mode,
    'mode',          v_target_mode,
    'updated_at',    v_new_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_transition_conversation_mode(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_transition_conversation_mode(uuid, uuid, text, timestamptz) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e uma conversa dela:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT id, mode, updated_at FROM whatsapp_conversations WHERE instance_id = '<inst>' LIMIT 1;

-- 1) Human_Takeover valido (AI_MODE -> HUMAN_MODE). Use o updated_at lido acima:
SELECT jsonb_pretty(whatsapp_transition_conversation_mode('<inst>','<conv>','HUMAN_TAKEOVER','<updated_at>'));
-- => { ok:true, previous_mode:'AI_MODE', mode:'HUMAN_MODE', updated_at:<novo> }

-- 2) Human_Takeover de novo (ja HUMAN_MODE) => idempotencia _SKIPPED:
SELECT jsonb_pretty(whatsapp_transition_conversation_mode('<inst>','<conv>','HUMAN_TAKEOVER','<novo_updated_at>'));
-- => { skipped:true, reason:'ALREADY_HUMAN_MODE' }
SELECT action, before_data, after_data FROM admin_audit_logs
 WHERE action='WHATSAPP_CONVERSATION_HUMAN_TAKEOVER_SKIPPED' ORDER BY created_at DESC LIMIT 1;

-- 3) Return_To_AI valido (HUMAN_MODE -> RETURNED_TO_AI):
SELECT jsonb_pretty(whatsapp_transition_conversation_mode('<inst>','<conv>','RETURN_TO_AI','<novo_updated_at>'));
-- => { ok:true, previous_mode:'HUMAN_MODE', mode:'RETURNED_TO_AI', updated_at:<novo> }

-- 4) Return_To_AI de novo (ja AI-allowed) => idempotencia _SKIPPED (ALREADY_RETURNED_TO_AI):
SELECT jsonb_pretty(whatsapp_transition_conversation_mode('<inst>','<conv>','RETURN_TO_AI','<novo_updated_at>'));

-- 5) Handoff automatico (AI_MODE/RETURNED_TO_AI -> HUMAN_MODE) registra AI_Handoff_Message:
SELECT jsonb_pretty(whatsapp_transition_conversation_mode('<inst>','<conv>','AI_HANDOFF','<novo_updated_at>'));
SELECT direction, body FROM whatsapp_messages WHERE conversation_id='<conv>' ORDER BY created_at DESC LIMIT 1;

-- 6) Acao fora do dominio => INVALID_CONVERSATION_MODE (P0001):
SELECT whatsapp_transition_conversation_mode('<inst>','<conv>','BOGUS','<updated_at>');

-- 7) Versao desatualizada => STALE_VERSION (P0001): use um updated_at antigo:
SELECT whatsapp_transition_conversation_mode('<inst>','<conv>','RETURN_TO_AI','2000-01-01T00:00:00Z');

-- 8) Conversa/instancia inexistente ou cruzada => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_transition_conversation_mode('<inst>','00000000-0000-0000-0000-000000000000','HUMAN_TAKEOVER',now());

-- 9) Historico preservado: a contagem de mensagens nunca diminui apos transicoes:
SELECT count(*) FROM whatsapp_messages WHERE conversation_id='<conv>';

-- 10) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action='WHATSAPP_VIEW_DENIED' ORDER BY created_at DESC LIMIT 1;
*/
