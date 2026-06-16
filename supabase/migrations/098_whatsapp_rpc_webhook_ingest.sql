-- ============================================================================
-- Migration 098 — whatsapp_ingest_inbound_message (task 16.1)
-- ----------------------------------------------------------------------------
-- RPC de INGESTAO idempotente de mensagens inbound recebidas da Evolution API
-- pela Edge Function `whatsapp-webhook` (Req 16.6, 31.3, 31.12). Diferente das
-- demais RPCs do modulo (tasks 6.x/8.x/15.x), esta NAO e chamada por um
-- Admin_User logado: o chamador e a propria Edge Function `whatsapp-webhook`,
-- que valida o token/assinatura da Evolution e invoca esta RPC via service-role.
-- Por isso ela:
--   * NAO usa whatsapp_require_permission/auth.uid() (nao ha sessao de admin);
--   * e GRANT apenas a `service_role` (REVOKE ALL FROM PUBLIC) — nunca exposta
--     a `authenticated` nem `anon`. A autorizacao do endpoint e feita na Edge
--     Function (validacao do token Evolution). O service_role ja contorna a RLS
--     das tabelas whatsapp_*, mas encapsulamos a ingestao numa unica RPC para
--     garantir ATOMICIDADE (upsert da conversa + insert idempotente da mensagem)
--     e centralizar a regra de idempotencia.
--
-- Responsabilidade (APENAS o caminho de ingestao — o auto-reply e a task 16.2):
--   1. Valida defensivamente que a instancia existe e esta habilitada. Instancia
--      desconhecida => marker WHATSAPP_NOT_FOUND (a Edge ja resolve o instance_id
--      pelo evolution_instance_name antes de chamar; este check e a salvaguarda).
--   2. Faz UPSERT da Conversation por (instance_id, contact_phone): cria em
--      'AI_MODE' se nova (Req 31.3); UNIQUE(instance_id, contact_phone) garante 1
--      conversa por contato/instancia.
--   3. INSERT da mensagem inbound ON CONFLICT(instance_id, provider_event_id)
--      DO NOTHING => idempotencia por evento (Req 16.6, 31.12). Reentrega do
--      mesmo provider_event_id e no-op (nenhuma mensagem duplicada).
--   4. So quando a mensagem e NOVA atualiza last_message_preview/last_message_at
--      da conversa (reprocessar um evento ja visto nao "reabre" a conversa).
--   5. Retorna { inserted, duplicate, conversation_id, mode, message_id } para a
--      Edge Function decidir o caminho de auto-reply (task 16.2) — sempre usando
--      o modo/escopo da PROPRIA instancia que recebeu a mensagem (Req 16.1, 26.4).
--
-- O corpo da mensagem (p_body/p_preview) e DADO NAO CONFIAVEL vindo do webhook:
-- aqui apenas o persistimos como texto (parametrizado, sem interpolacao) e
-- truncamos o preview; nenhuma logica confia no formato. A Edge Function ja
-- normaliza/valida o payload antes de chamar.
--
-- Depende de objetos criados em 092 (whatsapp foundation):
--   - tabela public.whatsapp_instances
--   - tabela public.whatsapp_conversations (UNIQUE(instance_id, contact_phone))
--   - tabela public.whatsapp_messages (UNIQUE(instance_id, provider_event_id))
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 16.6, 31.3, 31.12_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_instances'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_instances ausente';
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
-- RPC: whatsapp_ingest_inbound_message(p_instance_id, p_contact_phone,
--          p_provider_event_id, p_body, p_preview)
-- ----------------------------------------------------------------------------
-- Ingestao idempotente de UMA mensagem inbound. Retorna jsonb:
--   { inserted: bool, duplicate: bool, conversation_id: uuid,
--     mode: conversation_mode, message_id: uuid|null }
-- `inserted=true` => mensagem nova persistida (e conversa atualizada).
-- `duplicate=true` => provider_event_id ja processado (no-op idempotente).
CREATE OR REPLACE FUNCTION whatsapp_ingest_inbound_message(
  p_instance_id       uuid,
  p_contact_phone     text,
  p_provider_event_id text,
  p_body              text,
  p_preview           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_conv_id  uuid;
  v_mode     text;
  v_msg_id   uuid;
  v_inserted boolean;
BEGIN
  -- (a) Validacoes minimas dos parametros obrigatorios. provider_event_id e a
  --     chave de idempotencia: sem ele nao ha como deduplicar (Req 16.6, 31.12).
  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_ingest_inbound_message: instance_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_contact_phone IS NULL OR length(btrim(p_contact_phone)) = 0 THEN
    RAISE EXCEPTION 'whatsapp_ingest_inbound_message: contact_phone obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0 THEN
    RAISE EXCEPTION 'whatsapp_ingest_inbound_message: provider_event_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  -- (b) Salvaguarda anti-enumeracao/instancia: a Edge ja resolve o instance_id
  --     pelo evolution_instance_name e so chama para instancias habilitadas;
  --     aqui confirmamos defensivamente. Instancia desconhecida/desabilitada =>
  --     marker WHATSAPP_NOT_FOUND (mapeado para Canonical_Message na borda).
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_instances
     WHERE id = p_instance_id AND enabled = true
  ) THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (c) Garante a Conversation por (instance_id, contact_phone). Cria em
  --     'AI_MODE' se nova (Req 31.3). ON CONFLICT DO NOTHING torna seguro o
  --     reprocessamento concorrente do mesmo contato.
  INSERT INTO whatsapp_conversations (instance_id, contact_phone, mode)
  VALUES (p_instance_id, btrim(p_contact_phone), 'AI_MODE')
  ON CONFLICT (instance_id, contact_phone) DO NOTHING;

  SELECT c.id, c.mode
    INTO v_conv_id, v_mode
    FROM whatsapp_conversations c
   WHERE c.instance_id = p_instance_id
     AND c.contact_phone = btrim(p_contact_phone);

  -- (d) Insercao idempotente da mensagem inbound. ON CONFLICT(instance_id,
  --     provider_event_id) DO NOTHING => reentrega do mesmo evento e no-op
  --     (Req 16.6, 31.12). RETURNING so devolve linha quando ELA foi inserida.
  INSERT INTO whatsapp_messages (
    instance_id, conversation_id, direction, body, provider_event_id
  )
  VALUES (
    p_instance_id, v_conv_id, 'INBOUND', p_body, btrim(p_provider_event_id)
  )
  ON CONFLICT (instance_id, provider_event_id) DO NOTHING
  RETURNING id INTO v_msg_id;

  v_inserted := v_msg_id IS NOT NULL;

  -- (e) So atualiza o "ultimo" da conversa quando a mensagem e NOVA. Reprocessar
  --     um evento ja visto nao deve reordenar/reabrir a conversa.
  IF v_inserted THEN
    UPDATE whatsapp_conversations
       SET last_message_preview = left(coalesce(p_preview, p_body, ''), 200),
           last_message_at      = now()
     WHERE id = v_conv_id;
  END IF;

  RETURN jsonb_build_object(
    'inserted',        v_inserted,
    'duplicate',       NOT v_inserted,
    'conversation_id', v_conv_id,
    'mode',            v_mode,
    'message_id',      v_msg_id
  );
END;
$func$;

-- Postura de seguranca: nunca exposta a PUBLIC/authenticated/anon. So o
-- service_role (usado pela Edge Function whatsapp-webhook) pode executar.
REVOKE ALL ON FUNCTION whatsapp_ingest_inbound_message(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_ingest_inbound_message(uuid, text, text, text, text) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Primeira ingestao: cria conversa em AI_MODE e persiste a mensagem.
SELECT jsonb_pretty(whatsapp_ingest_inbound_message(
  '<instance_id>', '5511999999999', 'evt-001', 'Ola, tudo bem?', NULL
));  -- inserted=true, duplicate=false, mode=AI_MODE

-- 2) Reentrega do MESMO provider_event_id => idempotente (no-op).
SELECT jsonb_pretty(whatsapp_ingest_inbound_message(
  '<instance_id>', '5511999999999', 'evt-001', 'Ola, tudo bem?', NULL
));  -- inserted=false, duplicate=true

-- 3) Segunda mensagem do mesmo contato reusa a conversa e atualiza o "ultimo".
SELECT jsonb_pretty(whatsapp_ingest_inbound_message(
  '<instance_id>', '5511999999999', 'evt-002', 'Quero um orcamento', NULL
));  -- inserted=true

SELECT contact_phone, mode, last_message_preview, last_message_at
  FROM whatsapp_conversations
 WHERE instance_id = '<instance_id>' AND contact_phone = '5511999999999';

-- 4) Instancia inexistente => WHATSAPP_NOT_FOUND (P0001).
SELECT whatsapp_ingest_inbound_message(
  '00000000-0000-0000-0000-000000000000', '5511999999999', 'evt-x', 'oi', NULL
);
*/
