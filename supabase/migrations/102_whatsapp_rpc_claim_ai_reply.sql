-- ============================================================================
-- Migration 102 — whatsapp_claim_ai_reply / whatsapp_finalize_ai_reply (task 16.2)
-- ----------------------------------------------------------------------------
-- RPCs do caminho de AUTO-REPLY sob lock, invocadas pela Edge Function
-- `whatsapp-webhook` (NAO por um Admin_User logado). O chamador e a propria
-- Edge Function via service-role, depois de ingerir a mensagem inbound (task
-- 16.1 / migration 098). Por isso, como a 098, estas RPCs:
--   * NAO usam whatsapp_require_permission/auth.uid() (nao ha sessao de admin);
--   * sao GRANT apenas a `service_role` (REVOKE ALL FROM PUBLIC) — nunca
--     expostas a `authenticated`/`anon`. A autorizacao do endpoint e feita na
--     Edge Function (validacao do token Evolution).
--
-- Por que sob lock? (Req 16.7, 31.5, 31.10, 31.11 — invariante de responsavel
-- unico, propriedade P2.) A DECISAO de auto-responder e tomada lendo o
-- Conversation_Mode com `SELECT ... FOR UPDATE` na conversa, no MESMO caminho
-- que reserva o evento. Assim, um Human_Takeover/Return_To_AI concorrente
-- (task 17.2, que tambem trava a conversa) nunca interleava com a decisao de
-- envio: IA e humano jamais respondem simultaneamente.
--
-- Por que claim por UNIQUE? (Req 16.6, 31.12 — idempotencia, propriedade P9.)
-- A reserva e um `INSERT ... ON CONFLICT(instance_id, provider_event_id) DO
-- NOTHING` em whatsapp_ai_replies. O UNIQUE garante NO MAXIMO 1 ai_reply por
-- evento inbound: reentregas do mesmo provider_event_id (ou corridas) nao
-- conseguem reivindicar de novo => nunca ha auto-reply duplicado.
--
-- Divisao de responsabilidade (a chamada ao provedor de IA e o envio pela
-- Evolution sao I/O de rede e acontecem na Edge Function, FORA da transacao):
--
--   whatsapp_claim_ai_reply(p_instance_id, p_provider_event_id, p_conversation_id)
--     1. Reserva o evento (INSERT ON CONFLICT DO NOTHING). Se ja reservado =>
--        decision 'DUPLICATE' (a Edge nunca auto-responde de novo — P9).
--     2. Reservado com sucesso: trava a conversa (SELECT mode FOR UPDATE) e le
--        a config de IA (enabled, ai_prompt, knowledge_base) e o indicador
--        has_api_key (presenca do segredo de Vault `whatsapp_ai_key_<id>`).
--     3. Decide:
--          - modo AI-allowed (AI_MODE|RETURNED_TO_AI) E enabled E has_api_key
--            => decision 'ALLOW' (status fica 'PENDING' — transitorio; a Edge
--            chama o provedor e finaliza). Retorna ai_prompt/knowledge_base.
--          - caso contrario (HUMAN_MODE/AI_PAUSED ou IA desabilitada ou sem
--            chave) => status 'BLOCKED' (Req 16.5, 16.7, 31.5, 31.11), sem
--            qualquer envio. decision 'BLOCKED'.
--     NUNCA retorna a AI_Api_Key — apenas o indicador has_api_key.
--
--   whatsapp_finalize_ai_reply(p_instance_id, p_provider_event_id, p_status, p_reply_body)
--     Finaliza a reserva 'PENDING' apos a Edge chamar o provedor + enviar:
--          - p_status 'SENT'              => sucesso (Req 16.2). Se houver corpo,
--            persiste a mensagem OUTBOUND no historico e atualiza o "ultimo" da
--            conversa (coerencia do historico para o contexto futuro — Req 31.8).
--          - p_status 'AI_PROVIDER_ERROR' => erro do provedor (Req 16.4): marca o
--            status e NAO envia/persiste resposta.
--     Idempotente: so transiciona quando o status atual e 'PENDING'; reentrega
--     finaliza no-op (already=true). Nunca grava segredo.
--
-- Estados de whatsapp_ai_replies.status:
--   'PENDING'           -> reserva ativa, aguardando finalizacao (transitorio).
--                          Se a Edge cair entre claim e finalize, fica 'PENDING'
--                          (nenhuma resposta enviada; o UNIQUE impede retry) —
--                          terminal seguro equivalente a "sem resposta".
--   'BLOCKED'           -> modo nao-AI-allowed / IA desabilitada / sem chave.
--   'SENT'              -> resposta automatica enviada com sucesso.
--   'AI_PROVIDER_ERROR' -> provedor de IA falhou; nenhuma resposta enviada.
--
-- Depende de objetos criados em 092 (whatsapp foundation):
--   - tabela public.whatsapp_instances
--   - tabela public.whatsapp_conversations (UNIQUE(instance_id, contact_phone))
--   - tabela public.whatsapp_messages      (UNIQUE(instance_id, provider_event_id))
--   - tabela public.whatsapp_ai_replies    (UNIQUE(instance_id, provider_event_id))
--   - tabela public.whatsapp_ai_configs    (UNIQUE(instance_id))
--   - funcao public.whatsapp_instance_secret_name(uuid, text)
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 31.5, 31.10, 31.11_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_ai_replies'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_ai_replies ausente';
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_ai_configs'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_ai_configs ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_instance_secret_name'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_instance_secret_name ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_claim_ai_reply(p_instance_id, p_provider_event_id, p_conversation_id)
-- ----------------------------------------------------------------------------
-- Reserva atomica do evento + decisao de auto-reply sob lock. Retorna jsonb:
--   { claimed: bool, duplicate: bool, decision: text,
--     mode: conversation_mode|null, enabled: bool, has_api_key: bool,
--     ai_prompt: text|null, knowledge_base: text|null }
-- decision ∈ { 'ALLOW', 'BLOCKED', 'DUPLICATE' }.
--   'ALLOW'     => Edge deve gerar e enviar (status fica 'PENDING' ate finalize).
--   'BLOCKED'   => status ja gravado 'BLOCKED'; Edge nao envia nada.
--   'DUPLICATE' => evento ja reservado antes; Edge nao envia nada (P9).
CREATE OR REPLACE FUNCTION whatsapp_claim_ai_reply(
  p_instance_id       uuid,
  p_provider_event_id text,
  p_conversation_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_reply_id       uuid;
  v_claimed        boolean;
  v_mode           text;
  v_enabled        boolean := false;
  v_ai_prompt      text;
  v_knowledge_base text;
  v_has_api_key    boolean := false;
  v_secret_name    text;
  v_ai_allowed     boolean;
BEGIN
  -- (a) Validacoes minimas dos parametros obrigatorios. provider_event_id e a
  --     chave de idempotencia (Req 16.6, 31.12); conversation_id ancora o lock.
  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_claim_ai_reply: instance_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0 THEN
    RAISE EXCEPTION 'whatsapp_claim_ai_reply: provider_event_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_claim_ai_reply: conversation_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  -- (b) Salvaguarda anti-enumeracao/instancia: a Edge ja resolveu o instance_id;
  --     confirmamos defensivamente. Instancia desconhecida/desabilitada =>
  --     marker WHATSAPP_NOT_FOUND.
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_instances
     WHERE id = p_instance_id AND enabled = true
  ) THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (c) CLAIM idempotente do evento (propriedade P9). UNIQUE(instance_id,
  --     provider_event_id) garante <= 1 reserva por evento. RETURNING so
  --     devolve linha quando ELA foi inserida (reserva ganha por ESTA chamada).
  INSERT INTO whatsapp_ai_replies (
    instance_id, provider_event_id, conversation_id, status
  )
  VALUES (
    p_instance_id, btrim(p_provider_event_id), p_conversation_id, 'PENDING'
  )
  ON CONFLICT (instance_id, provider_event_id) DO NOTHING
  RETURNING id INTO v_reply_id;

  v_claimed := v_reply_id IS NOT NULL;

  -- (d) Evento ja reservado antes (reentrega/corrida) => nunca auto-responde de
  --     novo (P9). A Edge trata como no-op.
  IF NOT v_claimed THEN
    RETURN jsonb_build_object(
      'claimed',     false,
      'duplicate',   true,
      'decision',    'DUPLICATE',
      'mode',        NULL,
      'enabled',     false,
      'has_api_key', false,
      'ai_prompt',       NULL,
      'knowledge_base',  NULL
    );
  END IF;

  -- (e) Lock da conversa: a leitura do Conversation_Mode e feita sob
  --     `FOR UPDATE`, serializando a decisao de envio frente a transicoes de
  --     modo concorrentes (Human_Takeover/Return_To_AI — task 17.2), que tambem
  --     travam a conversa. Garante o invariante de responsavel unico (P2,
  --     Req 31.2). A conversa pertence A MESMA instancia (isolamento, Req 16.1).
  SELECT c.mode
    INTO v_mode
    FROM whatsapp_conversations c
   WHERE c.id = p_conversation_id
     AND c.instance_id = p_instance_id
   FOR UPDATE;

  -- Conversa inexistente/cruzada (inconsistencia): bloqueia por seguranca.
  IF NOT FOUND THEN
    UPDATE whatsapp_ai_replies SET status = 'BLOCKED' WHERE id = v_reply_id;
    RETURN jsonb_build_object(
      'claimed',     true,
      'duplicate',   false,
      'decision',    'BLOCKED',
      'mode',        NULL,
      'enabled',     false,
      'has_api_key', false,
      'ai_prompt',       NULL,
      'knowledge_base',  NULL
    );
  END IF;

  -- (f) Config de IA da PROPRIA instancia (Req 16.1, 26.4). Sem linha => IA
  --     desabilitada por padrao (enabled=false). ai_prompt/knowledge_base
  --     alimentam a geracao na Edge.
  SELECT cfg.enabled, cfg.ai_prompt, cfg.knowledge_base
    INTO v_enabled, v_ai_prompt, v_knowledge_base
    FROM whatsapp_ai_configs cfg
   WHERE cfg.instance_id = p_instance_id;

  IF NOT FOUND THEN
    v_enabled := false;
  END IF;

  -- (g) Indicador has_api_key derivado da PRESENCA do segredo no Vault
  --     (`whatsapp_ai_key_<instance_id>`). NUNCA selecionamos o valor da chave —
  --     apenas a existencia (Req 14.2, 14.5, 18.7). A leitura do valor em si
  --     ocorre na Edge (service-role), fora desta RPC. Guardado contra ausencia
  --     do schema vault (fail-closed => has_api_key=false => BLOCKED).
  BEGIN
    v_secret_name := whatsapp_instance_secret_name(p_instance_id, 'AI');
    v_has_api_key := EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_secret_name);
  EXCEPTION WHEN OTHERS THEN
    v_has_api_key := false;
  END;

  -- (h) Decisao: so AI-allowed (AI_MODE|RETURNED_TO_AI) + habilitada + com chave
  --     pode auto-responder (Req 16.1, 16.5, 16.7, 31.5, 31.10, 31.11).
  v_ai_allowed := v_mode IN ('AI_MODE', 'RETURNED_TO_AI');

  IF NOT (v_ai_allowed AND v_enabled AND v_has_api_key) THEN
    -- BLOCKED: nenhum envio. Cobre HUMAN_MODE/AI_PAUSED, IA desabilitada e
    -- ausencia de chave (Req 14.5, 16.5).
    UPDATE whatsapp_ai_replies SET status = 'BLOCKED' WHERE id = v_reply_id;
    RETURN jsonb_build_object(
      'claimed',     true,
      'duplicate',   false,
      'decision',    'BLOCKED',
      'mode',        v_mode,
      'enabled',     v_enabled,
      'has_api_key', v_has_api_key,
      'ai_prompt',       NULL,
      'knowledge_base',  NULL
    );
  END IF;

  -- (i) ALLOW: status fica 'PENDING'; a Edge gera a resposta (prompt+KB+
  --     historico) e finaliza via whatsapp_finalize_ai_reply.
  RETURN jsonb_build_object(
    'claimed',     true,
    'duplicate',   false,
    'decision',    'ALLOW',
    'mode',        v_mode,
    'enabled',     v_enabled,
    'has_api_key', v_has_api_key,
    'ai_prompt',       v_ai_prompt,
    'knowledge_base',  v_knowledge_base
  );
END;
$func$;

-- Postura de seguranca: nunca exposta a PUBLIC/authenticated/anon. So o
-- service_role (usado pela Edge Function whatsapp-webhook) pode executar.
REVOKE ALL ON FUNCTION whatsapp_claim_ai_reply(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_claim_ai_reply(uuid, text, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_finalize_ai_reply(p_instance_id, p_provider_event_id, p_status, p_reply_body)
-- ----------------------------------------------------------------------------
-- Finaliza uma reserva 'PENDING' apos a Edge chamar o provedor de IA + enviar.
-- Retorna jsonb: { ok: bool, status: text, already: bool, reason: text|null }.
--   p_status 'SENT'              => sucesso (Req 16.2). Persiste a mensagem
--     OUTBOUND (se houver corpo) e atualiza o "ultimo" da conversa.
--   p_status 'AI_PROVIDER_ERROR' => erro do provedor (Req 16.4); sem envio.
-- Idempotente: so transiciona quando o status atual e 'PENDING'.
CREATE OR REPLACE FUNCTION whatsapp_finalize_ai_reply(
  p_instance_id       uuid,
  p_provider_event_id text,
  p_status            text,
  p_reply_body        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_reply_id    uuid;
  v_conv_id     uuid;
  v_cur_status  text;
BEGIN
  -- (a) Validacoes de parametros. Status restrito ao dominio finalizavel.
  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_finalize_ai_reply: instance_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0 THEN
    RAISE EXCEPTION 'whatsapp_finalize_ai_reply: provider_event_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('SENT', 'AI_PROVIDER_ERROR') THEN
    RAISE EXCEPTION 'whatsapp_finalize_ai_reply: status invalido "%": esperado SENT|AI_PROVIDER_ERROR', p_status
      USING ERRCODE = '22023';
  END IF;

  -- (b) Localiza a reserva da PROPRIA instancia (escopo, Req 16.1). Trava a
  --     linha para evitar finalizacoes concorrentes do mesmo evento.
  SELECT r.id, r.conversation_id, r.status
    INTO v_reply_id, v_conv_id, v_cur_status
    FROM whatsapp_ai_replies r
   WHERE r.instance_id = p_instance_id
     AND r.provider_event_id = btrim(p_provider_event_id)
   FOR UPDATE;

  -- (c) Sem reserva (claim nunca aconteceu) => nao ha o que finalizar.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'already', false, 'reason', 'NOT_CLAIMED');
  END IF;

  -- (d) Idempotencia: so transiciona a partir de 'PENDING'. Reentrega de
  --     finalizacao (ou reserva ja resolvida em BLOCKED) e no-op seguro.
  IF v_cur_status IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object('ok', true, 'status', v_cur_status, 'already', true, 'reason', NULL);
  END IF;

  -- (e) Grava o status final.
  UPDATE whatsapp_ai_replies SET status = p_status WHERE id = v_reply_id;

  -- (f) Sucesso com corpo: persiste a mensagem OUTBOUND no historico (coerencia
  --     para o contexto futuro — Req 31.8) e atualiza o "ultimo" da conversa.
  --     provider_event_id NULL em OUTBOUND (multiplos NULL nao colidem no UNIQUE).
  IF p_status = 'SENT'
     AND p_reply_body IS NOT NULL
     AND length(btrim(p_reply_body)) > 0
     AND v_conv_id IS NOT NULL
  THEN
    INSERT INTO whatsapp_messages (
      instance_id, conversation_id, direction, body, provider_event_id
    )
    VALUES (
      p_instance_id, v_conv_id, 'OUTBOUND', p_reply_body, NULL
    );

    UPDATE whatsapp_conversations
       SET last_message_preview = left(p_reply_body, 200),
           last_message_at      = now()
     WHERE id = v_conv_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'already', false, 'reason', NULL);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_finalize_ai_reply(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_finalize_ai_reply(uuid, text, text, text) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pre-requisitos: uma instancia habilitada, uma conversa e (para ALLOW) uma
-- config de IA habilitada + segredo de chave no Vault.
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- Ingere uma mensagem inbound (cria a conversa em AI_MODE):
SELECT whatsapp_ingest_inbound_message('<instance_id>', '5511999999999', 'evt-ai-1', 'Ola', NULL);
-- pegue o conversation_id retornado.

-- 1) Sem config / sem chave => decision BLOCKED (status BLOCKED):
SELECT jsonb_pretty(whatsapp_claim_ai_reply('<instance_id>', 'evt-ai-1', '<conversation_id>'));

-- 2) Habilite a IA e grave a chave, ingira novo evento e reivindique => ALLOW:
SELECT whatsapp_save_ai_config('<instance_id>', true, 'Atendente cordial.', NULL, NULL, NULL);
SELECT whatsapp_set_instance_secret('<instance_id>', 'AI', 'sk-test-123');
SELECT whatsapp_ingest_inbound_message('<instance_id>', '5511999999999', 'evt-ai-2', 'Quero ajuda', NULL);
SELECT jsonb_pretty(whatsapp_claim_ai_reply('<instance_id>', 'evt-ai-2', '<conversation_id>'));
--   decision=ALLOW, ai_prompt preenchido, has_api_key=true, status=PENDING

-- 3) Reivindicar o MESMO evento de novo => DUPLICATE (P9, nunca responde 2x):
SELECT jsonb_pretty(whatsapp_claim_ai_reply('<instance_id>', 'evt-ai-2', '<conversation_id>'));

-- 4) Finaliza com sucesso => SENT + persiste OUTBOUND no historico:
SELECT jsonb_pretty(whatsapp_finalize_ai_reply('<instance_id>', 'evt-ai-2', 'SENT', 'Ola! Como posso ajudar?'));

-- 5) Finalizar de novo => already=true (idempotente):
SELECT jsonb_pretty(whatsapp_finalize_ai_reply('<instance_id>', 'evt-ai-2', 'SENT', 'Ola!'));

-- 6) HUMAN_MODE bloqueia mesmo com IA habilitada (Req 31.5/31.11):
UPDATE whatsapp_conversations SET mode='HUMAN_MODE' WHERE id='<conversation_id>';
SELECT whatsapp_ingest_inbound_message('<instance_id>', '5511999999999', 'evt-ai-3', 'oi', NULL);
SELECT (whatsapp_claim_ai_reply('<instance_id>', 'evt-ai-3', '<conversation_id>') ->> 'decision'); -- BLOCKED

-- 7) Status final das reservas:
SELECT provider_event_id, status FROM whatsapp_ai_replies
 WHERE instance_id='<instance_id>' ORDER BY created_at;
*/
