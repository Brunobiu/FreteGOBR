-- ============================================================================
-- Migration 115b: Suporte_Inteligente — RPCs SECURITY DEFINER
-- ============================================================================
-- Spec: .kiro/specs/suporte-inteligente/{requirements,design,tasks}.md (Task 4).
-- Depende da 115 (schema/RBAC/RLS/trigger). Idempotente (CREATE OR REPLACE).
--
-- RPCs entregues:
--   Mutações de admin (gated SUPORTE_REPLY):
--     support_change_status, support_set_priority, support_handoff_to_human*,
--     support_return_to_ai, support_insert_human_reply
--   Fluxo de IA (service-role, chamado pela Edge support-ai-reply):
--     support_claim_ai_reply, support_insert_ai_reply
--   FAQ (gated FAQ_EDIT): support_create_faq, support_update_faq, support_delete_faq
--   Config IA (gated SUPORTE_AI_CONFIG): support_update_ai_config
--   Leituras gated: support_admin_list_tickets (SUPORTE_VIEW), support_list_faq (FAQ_VIEW)
--   (* handoff aceita também service-role, pois a Edge aciona handoff quando a
--      IA não pode responder.)
--
-- POSTURA (admin-patterns §10): SET search_path=public; auth.uid() nulo no
--   caminho de admin ⇒ permission_denied (42501); gating com LOG NEGATIVO
--   (SUPORTE_VIEW_DENIED / FAQ_VIEW_DENIED) antes de abortar (precedência sobre
--   validação); versionamento otimista (expected_updated_at ⇒ STALE_VERSION);
--   idempotência _SKIPPED; REVOKE ALL FROM PUBLIC + GRANT EXECUTE explícito.
--   O audit POSITIVO de mutação é gravado pela camada TS (executeAdminMutation);
--   os logs _SKIPPED / *_VIEW_DENIED são gravados DENTRO da RPC.
--
-- NOTA (limitação de auditoria do caminho service-role): admin_audit_logs.admin_id
--   é NOT NULL (migration 030). O fluxo de IA (service-role, auth.uid() nulo) NÃO
--   pode gravar admin_audit_logs; a tabela support_ai_claims abaixo é o traço
--   auditável persistido da atividade de IA (claim + status do ciclo de vida).
--
-- Par documentado (não auto-aplicado): 115b_suporte_inteligente_rpcs_rollback.sql.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validações defensivas (a 115 precisa estar aplicada)
-- ────────────────────────────────────────────────────────────────────────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='support_tickets'
                    AND column_name='responder_mode') THEN
    RAISE EXCEPTION 'Migration 115 nao aplicada: support_tickets.responder_mode ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='support_ticket_messages'
                    AND column_name='author_kind') THEN
    RAISE EXCEPTION 'Migration 115 nao aplicada: support_ticket_messages.author_kind ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='support_kb_entries') THEN
    RAISE EXCEPTION 'Migration 115 nao aplicada: support_kb_entries ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='support_ai_config') THEN
    RAISE EXCEPTION 'Migration 115 nao aplicada: support_ai_config ausente';
  END IF;
END
$check$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. support_ai_claims — reserva idempotente de auto-reply da IA (P9 / CP1)
-- ────────────────────────────────────────────────────────────────────────────
-- Espelha o padrão de whatsapp_ai_replies (migration 102): UNIQUE(ticket_id,
-- idempotency_key) garante no máximo 1 claim por gatilho ⇒ a Edge nunca
-- responde 2x. Acesso só via RPC service-role (RLS bloqueia DML direto).
CREATE TABLE IF NOT EXISTS support_ai_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ALLOW','BLOCKED','REPLIED')),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_support_ai_claims UNIQUE (ticket_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_ai_claims_ticket
  ON support_ai_claims (ticket_id, created_at DESC);

ALTER TABLE support_ai_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_ai_claims_no_dml ON support_ai_claims;
CREATE POLICY support_ai_claims_no_dml ON support_ai_claims
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE support_ai_claims IS
  'Reserva idempotente de auto-reply da Support_AI (UNIQUE ticket_id+idempotency_key). Traço auditável da atividade de IA. Acesso só via RPC service-role (suporte-inteligente 115b).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Helper: máquina de transição em SQL (espelha statusMachine.ts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_is_valid_transition(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $func$
  SELECT CASE p_from
    WHEN 'open'             THEN p_to IN ('in_progress','waiting_customer','resolved','closed')
    WHEN 'in_progress'      THEN p_to IN ('waiting_customer','resolved','closed')
    WHEN 'waiting_customer' THEN p_to IN ('in_progress','resolved','closed')
    WHEN 'resolved'         THEN p_to IN ('in_progress','closed')
    ELSE false  -- closed terminal / status desconhecido
  END;
$func$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. support_change_status (SUPORTE_REPLY) — máquina de estados + _SKIPPED + STALE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_change_status(
  p_ticket_id           uuid,
  p_target_status       text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_status  text;
  v_updated timestamptz;
  v_new     timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'change_status'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required' USING ERRCODE = '42501';
  END IF;

  IF p_target_status IS NULL OR p_target_status NOT IN
       ('open','in_progress','waiting_customer','resolved','closed') THEN
    RAISE EXCEPTION 'INVALID_INPUT: status invalido' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, updated_at INTO v_status, v_updated
    FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotência: mesmo status ⇒ _SKIPPED (sem mutar), log na própria RPC.
  IF v_status = p_target_status THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_STATUS_SKIPPED', 'support_tickets', p_ticket_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_' || upper(v_status)));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_' || upper(v_status));
  END IF;

  -- Transição fora do conjunto permitido (inclui closed terminal).
  IF NOT support_is_valid_transition(v_status, p_target_status) THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  -- Versionamento otimista (relaxado quando expected é NULL).
  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_tickets
     SET status = p_target_status,
         resolved_at = CASE WHEN p_target_status = 'resolved' THEN NOW() ELSE resolved_at END,
         resolved_by = CASE WHEN p_target_status = 'resolved' THEN v_caller ELSE resolved_by END
   WHERE id = p_ticket_id
   RETURNING updated_at INTO v_new;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new);
END;
$func$;

REVOKE ALL ON FUNCTION support_change_status(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_change_status(uuid, text, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. support_set_priority (SUPORTE_REPLY) — valida 1..3 + _SKIPPED + STALE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_set_priority(
  p_ticket_id           uuid,
  p_level               int,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_level   smallint;
  v_updated timestamptz;
  v_new     timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'set_priority'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required' USING ERRCODE = '42501';
  END IF;

  IF p_level IS NULL OR p_level NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'INVALID_INPUT: priority_level deve ser 1, 2 ou 3' USING ERRCODE = 'P0001';
  END IF;

  SELECT priority_level, updated_at INTO v_level, v_updated
    FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_level = p_level THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_PRIORITY_SKIPPED', 'support_tickets', p_ticket_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_LEVEL_' || p_level));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_LEVEL_' || p_level);
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_tickets SET priority_level = p_level
   WHERE id = p_ticket_id
   RETURNING updated_at INTO v_new;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new);
END;
$func$;

REVOKE ALL ON FUNCTION support_set_priority(uuid, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_set_priority(uuid, int, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. support_handoff_to_human (SUPORTE_REPLY OU service-role) — sob lock
-- ────────────────────────────────────────────────────────────────────────────
-- Gating dual: caminho de admin (auth.uid() não nulo) exige SUPORTE_REPLY;
-- caminho da Edge (service-role, auth.uid() nulo) é permitido — anon não recebe
-- GRANT, então auth.uid() nulo aqui ⇒ service-role confiável.
CREATE OR REPLACE FUNCTION support_handoff_to_human(
  p_ticket_id           uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_mode    text;
  v_status  text;
  v_updated timestamptz;
  v_new     timestamptz;
BEGIN
  -- Gating só no caminho de admin; service-role (caller nulo) é confiável.
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'handoff'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required' USING ERRCODE = '42501';
  END IF;

  SELECT responder_mode, status, updated_at INTO v_mode, v_status, v_updated
    FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotente: já 'human' ⇒ _SKIPPED (sem nova mensagem nem mutação).
  IF v_mode = 'human' THEN
    IF v_caller IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'SUPORTE_HANDOFF_SKIPPED', 'support_tickets', p_ticket_id::text, NULL,
              jsonb_build_object('reason', 'ALREADY_HUMAN'));
    END IF;
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_HUMAN');
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_tickets
     SET responder_mode = 'human',
         handoff_at = NOW(),
         status = CASE WHEN status = 'closed' THEN status ELSE 'in_progress' END
   WHERE id = p_ticket_id
   RETURNING updated_at INTO v_new;

  -- Mensagem de aviso ao cliente (best-effort): falha na inserção NÃO bloqueia
  -- o handoff (Req 7.7). author_kind='admin' (não dispara o trigger de reabertura).
  BEGIN
    INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_admin, author_kind)
    VALUES (p_ticket_id, v_caller,
            'Um atendente humano vai dar continuidade ao seu atendimento.', true, 'admin');
  EXCEPTION WHEN OTHERS THEN
    -- Degradação controlada: handoff concluído mesmo sem a mensagem de aviso.
    NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new);
END;
$func$;

REVOKE ALL ON FUNCTION support_handoff_to_human(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_handoff_to_human(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION support_handoff_to_human(uuid, timestamptz) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. support_return_to_ai (SUPORTE_REPLY) — human→ai idempotente
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_return_to_ai(
  p_ticket_id           uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_mode    text;
  v_updated timestamptz;
  v_new     timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'return_to_ai'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required' USING ERRCODE = '42501';
  END IF;

  SELECT responder_mode, updated_at INTO v_mode, v_updated
    FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_mode = 'ai' THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_RETURN_TO_AI_SKIPPED', 'support_tickets', p_ticket_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_AI'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_AI');
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_tickets
     SET responder_mode = 'ai', returned_to_ai_at = NOW()
   WHERE id = p_ticket_id
   RETURNING updated_at INTO v_new;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new);
END;
$func$;

REVOKE ALL ON FUNCTION support_return_to_ai(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_return_to_ai(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. support_insert_human_reply (SUPORTE_REPLY) — flip atômico ai→human + insere
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_insert_human_reply(
  p_ticket_id           uuid,
  p_body                text,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_mode     text;
  v_status   text;
  v_updated  timestamptz;
  v_msg_id   uuid;
  v_flipped  boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'insert_human_reply'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required' USING ERRCODE = '42501';
  END IF;

  IF p_body IS NULL OR char_length(btrim(p_body)) < 1 OR char_length(btrim(p_body)) > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: corpo deve ter entre 1 e 5000 caracteres' USING ERRCODE = 'P0001';
  END IF;

  SELECT responder_mode, status, updated_at INTO v_mode, v_status, v_updated
    FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- Flip atômico ai→human ANTES de aceitar a resposta humana (Req 7.6, 8.4).
  IF v_mode = 'ai' THEN
    v_flipped := true;
    UPDATE support_tickets
       SET responder_mode = 'human',
           handoff_at = NOW(),
           status = CASE WHEN status = 'closed' THEN status ELSE 'in_progress' END
     WHERE id = p_ticket_id;
  END IF;

  INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_admin, author_kind)
  VALUES (p_ticket_id, v_caller, btrim(p_body), true, 'admin')
  RETURNING id INTO v_msg_id;

  SELECT updated_at INTO v_updated FROM support_tickets WHERE id = p_ticket_id;

  RETURN jsonb_build_object('ok', true, 'message_id', v_msg_id,
                            'updated_at', v_updated, 'handed_off', v_flipped);
END;
$func$;

REVOKE ALL ON FUNCTION support_insert_human_reply(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_insert_human_reply(uuid, text, timestamptz) TO authenticated;

COMMIT;

-- ============================================================================
-- Parte 2: fluxo de IA (service-role), FAQ CRUD, config IA e leituras gated.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. support_claim_ai_reply (service-role) — reserva idempotente + decisão sob lock
-- ────────────────────────────────────────────────────────────────────────────
-- decision ∈ { 'ALLOW', 'BLOCKED', 'DUPLICATE' }. Idempotente por idempotency_key
-- (UNIQUE) ⇒ nunca responde 2x. A decisão lê responder_mode sob FOR UPDATE,
-- serializando frente a handoff/return_to_ai concorrentes (base de CP1).
CREATE OR REPLACE FUNCTION support_claim_ai_reply(
  p_ticket_id       uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_claim_id  uuid;
  v_mode      text;
  v_enabled   boolean := false;
  v_threshold numeric;
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: ticket_id obrigatorio' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: idempotency_key obrigatorio' USING ERRCODE = '22023';
  END IF;

  -- Claim idempotente: <= 1 por (ticket, idempotency_key). RETURNING só devolve
  -- linha se ESTA chamada inseriu (venceu a corrida).
  INSERT INTO support_ai_claims (ticket_id, idempotency_key, status)
  VALUES (p_ticket_id, btrim(p_idempotency_key), 'PENDING')
  ON CONFLICT (ticket_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    RETURN jsonb_build_object('decision', 'DUPLICATE', 'claimed', false, 'duplicate', true);
  END IF;

  -- Lock do ticket: serializa a decisão frente a handoff/return concorrentes.
  SELECT responder_mode INTO v_mode FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE support_ai_claims SET status = 'BLOCKED' WHERE id = v_claim_id;
    RETURN jsonb_build_object('decision', 'BLOCKED', 'claimed', true, 'duplicate', false,
                              'reason', 'TICKET_NOT_FOUND');
  END IF;

  SELECT enabled, confidence_threshold INTO v_enabled, v_threshold
    FROM support_ai_config WHERE id = true;
  IF NOT FOUND THEN
    v_enabled := false;
  END IF;

  -- ALLOW só se modo 'ai' E IA habilitada. Caso contrário BLOCKED (sem envio).
  IF v_mode = 'ai' AND v_enabled THEN
    UPDATE support_ai_claims SET status = 'ALLOW' WHERE id = v_claim_id;
    RETURN jsonb_build_object('decision', 'ALLOW', 'claimed', true, 'duplicate', false,
                              'enabled', true, 'confidence_threshold', v_threshold);
  END IF;

  UPDATE support_ai_claims SET status = 'BLOCKED' WHERE id = v_claim_id;
  RETURN jsonb_build_object('decision', 'BLOCKED', 'claimed', true, 'duplicate', false,
                            'reason', CASE WHEN v_mode = 'human' THEN 'AI_LOCKED' ELSE 'AI_DISABLED' END,
                            'enabled', v_enabled, 'confidence_threshold', v_threshold);
END;
$func$;

REVOKE ALL ON FUNCTION support_claim_ai_reply(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_claim_ai_reply(uuid, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. support_insert_ai_reply (service-role) — reconfere modo sob lock (CP1)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_insert_ai_reply(
  p_ticket_id           uuid,
  p_body                text,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_mode    text;
  v_updated timestamptz;
  v_msg_id  uuid;
BEGIN
  IF p_body IS NULL OR char_length(btrim(p_body)) < 1 OR char_length(btrim(p_body)) > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: corpo invalido' USING ERRCODE = 'P0001';
  END IF;

  SELECT responder_mode, updated_at INTO v_mode, v_updated
    FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- CP1: reconfere modo='ai' sob o lock; se humano assumiu, NADA é persistido.
  IF v_mode <> 'ai' THEN
    RAISE EXCEPTION 'AI_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- Mensagem de IA: author_kind='ai', is_admin=true (lado-suporte p/ os triggers
  -- de notificação de 041), author_id=NULL (sem humano).
  INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_admin, author_kind)
  VALUES (p_ticket_id, NULL, btrim(p_body), true, 'ai')
  RETURNING id INTO v_msg_id;

  UPDATE support_tickets
     SET status = CASE WHEN status = 'closed' THEN status ELSE 'resolved' END,
         resolved_at = CASE WHEN status = 'closed' THEN resolved_at ELSE NOW() END,
         priority_level = 1
   WHERE id = p_ticket_id;

  -- Marca a reserva ALLOW como REPLIED (traço auditável da resposta da IA).
  UPDATE support_ai_claims SET status = 'REPLIED'
   WHERE ticket_id = p_ticket_id AND status = 'ALLOW';

  RETURN jsonb_build_object('ok', true, 'message_id', v_msg_id);
END;
$func$;

REVOKE ALL ON FUNCTION support_insert_ai_reply(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_insert_ai_reply(uuid, text, timestamptz) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. FAQ CRUD (FAQ_EDIT) — valores armazenados já com trim (paridade validation.ts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_create_faq(
  p_question          text,
  p_answer            text,
  p_category          text,
  p_publication_state text DEFAULT 'rascunho'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_id     uuid;
  v_upd    timestamptz;
  v_pub    text := COALESCE(p_publication_state, 'rascunho');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FAQ_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'FAQ_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'create_faq'));
    RAISE EXCEPTION 'permission_denied: FAQ_EDIT required' USING ERRCODE = '42501';
  END IF;

  IF p_question IS NULL OR char_length(btrim(p_question)) < 3 OR char_length(btrim(p_question)) > 300 THEN
    RAISE EXCEPTION 'INVALID_INPUT: pergunta deve ter entre 3 e 300 caracteres' USING ERRCODE = 'P0001';
  END IF;
  IF p_answer IS NULL OR char_length(btrim(p_answer)) < 1 OR char_length(btrim(p_answer)) > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: resposta deve ter entre 1 e 5000 caracteres' USING ERRCODE = 'P0001';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('geral','financeiro','tecnico','administrativo','conta','planos') THEN
    RAISE EXCEPTION 'INVALID_INPUT: categoria invalida' USING ERRCODE = 'P0001';
  END IF;
  IF v_pub NOT IN ('rascunho','publicada') THEN
    RAISE EXCEPTION 'INVALID_INPUT: publication_state invalido' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO support_kb_entries (question, answer, category, publication_state, created_by)
  VALUES (btrim(p_question), btrim(p_answer), p_category, v_pub, v_caller)
  RETURNING id, updated_at INTO v_id, v_upd;

  RETURN jsonb_build_object('id', v_id, 'updated_at', v_upd);
END;
$func$;

REVOKE ALL ON FUNCTION support_create_faq(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_create_faq(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION support_update_faq(
  p_id                  uuid,
  p_patch               jsonb,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_updated timestamptz;
  v_new     timestamptz;
  v_q       text;
  v_a       text;
  v_cat     text;
  v_pub     text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FAQ_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'FAQ_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'update_faq'));
    RAISE EXCEPTION 'permission_denied: FAQ_EDIT required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT: patch deve ser objeto' USING ERRCODE = 'P0001';
  END IF;

  -- Validação dos campos presentes no patch.
  IF p_patch ? 'question' THEN
    v_q := p_patch ->> 'question';
    IF v_q IS NULL OR char_length(btrim(v_q)) < 3 OR char_length(btrim(v_q)) > 300 THEN
      RAISE EXCEPTION 'INVALID_INPUT: pergunta deve ter entre 3 e 300 caracteres' USING ERRCODE = 'P0001';
    END IF;
    v_q := btrim(v_q);
  END IF;
  IF p_patch ? 'answer' THEN
    v_a := p_patch ->> 'answer';
    IF v_a IS NULL OR char_length(btrim(v_a)) < 1 OR char_length(btrim(v_a)) > 5000 THEN
      RAISE EXCEPTION 'INVALID_INPUT: resposta deve ter entre 1 e 5000 caracteres' USING ERRCODE = 'P0001';
    END IF;
    v_a := btrim(v_a);
  END IF;
  IF p_patch ? 'category' THEN
    v_cat := p_patch ->> 'category';
    IF v_cat NOT IN ('geral','financeiro','tecnico','administrativo','conta','planos') THEN
      RAISE EXCEPTION 'INVALID_INPUT: categoria invalida' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_patch ? 'publication_state' THEN
    v_pub := p_patch ->> 'publication_state';
    IF v_pub NOT IN ('rascunho','publicada') THEN
      RAISE EXCEPTION 'INVALID_INPUT: publication_state invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT updated_at INTO v_updated FROM support_kb_entries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_kb_entries SET
    question          = COALESCE(v_q, question),
    answer            = COALESCE(v_a, answer),
    category          = COALESCE(v_cat, category),
    publication_state = COALESCE(v_pub, publication_state)
  WHERE id = p_id
  RETURNING updated_at INTO v_new;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new);
END;
$func$;

REVOKE ALL ON FUNCTION support_update_faq(uuid, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_update_faq(uuid, jsonb, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION support_delete_faq(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FAQ_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'FAQ_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'delete_faq'));
    RAISE EXCEPTION 'permission_denied: FAQ_EDIT required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM support_kb_entries WHERE id = p_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Idempotência: FAQ já inexistente ⇒ _SKIPPED ALREADY_REMOVED (log na RPC).
  IF v_rows = 0 THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'FAQ_DELETE_SKIPPED', 'support_kb_entries', p_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_REMOVED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_REMOVED');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$func$;

REVOKE ALL ON FUNCTION support_delete_faq(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_delete_faq(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. support_update_ai_config (SUPORTE_AI_CONFIG) — valida threshold [0,1] + STALE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_update_ai_config(
  p_patch               jsonb,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_updated   timestamptz;
  v_new       timestamptz;
  v_enabled   boolean;
  v_threshold numeric;
  v_model     text;
  v_thr_json  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPORTE_AI_CONFIG') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'update_ai_config'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_AI_CONFIG required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT: patch deve ser objeto' USING ERRCODE = 'P0001';
  END IF;

  IF p_patch ? 'enabled' THEN
    IF jsonb_typeof(p_patch -> 'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_INPUT: enabled deve ser booleano' USING ERRCODE = 'P0001';
    END IF;
    v_enabled := (p_patch ->> 'enabled')::boolean;
  END IF;
  IF p_patch ? 'confidence_threshold' THEN
    v_thr_json := p_patch -> 'confidence_threshold';
    IF jsonb_typeof(v_thr_json) <> 'number' THEN
      RAISE EXCEPTION 'INVALID_INPUT: confidence_threshold deve ser numero em [0,1]' USING ERRCODE = 'P0001';
    END IF;
    v_threshold := (v_thr_json::text)::numeric;
    IF v_threshold < 0 OR v_threshold > 1 THEN
      RAISE EXCEPTION 'INVALID_INPUT: confidence_threshold deve estar em [0,1]' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_patch ? 'support_model' THEN
    v_model := p_patch ->> 'support_model';
    IF v_model IS NULL OR char_length(btrim(v_model)) = 0 OR char_length(v_model) > 120 THEN
      RAISE EXCEPTION 'INVALID_INPUT: support_model invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT updated_at INTO v_updated FROM support_ai_config WHERE id = true FOR UPDATE;
  IF p_expected_updated_at IS NOT NULL AND v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_ai_config SET
    enabled              = COALESCE(v_enabled, enabled),
    confidence_threshold = COALESCE(v_threshold, confidence_threshold),
    support_model        = COALESCE(v_model, support_model)
  WHERE id = true
  RETURNING updated_at INTO v_new;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new);
END;
$func$;

REVOKE ALL ON FUNCTION support_update_ai_config(jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_update_ai_config(jsonb, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. support_admin_list_tickets (SUPORTE_VIEW) — filtros + paginação server-side
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_admin_list_tickets(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit   int   DEFAULT 10,
  p_offset  int   DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_limit    int;
  v_offset   int;
  v_status   text;
  v_priority int;
  v_mode     text;
  v_search   text;
  v_from     timestamptz;
  v_to       timestamptz;
  v_like     text;
  v_result   jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPORTE_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPORTE_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'list_tickets'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Parse dos filtros APÓS o gating (precedência de permission_denied sobre
  -- erros de validação de input — Req 11.3). Casts tolerantes: input malformado
  -- vira INVALID_INPUT, nunca um erro de cast cru.
  v_status := p_filters ->> 'status';
  v_mode   := p_filters ->> 'responder_mode';
  v_search := NULLIF(btrim(COALESCE(p_filters ->> 'search', '')), '');
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit  := CASE WHEN p_limit IN (10, 50, 100) THEN p_limit ELSE 10 END;  -- pageSize default 10
  BEGIN
    v_priority := NULLIF(p_filters ->> 'priority_level', '')::int;
    v_from     := NULLIF(p_filters ->> 'date_from', '')::timestamptz;
    v_to       := NULLIF(p_filters ->> 'date_to', '')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_INPUT: filtros invalidos' USING ERRCODE = 'P0001';
  END;

  -- Escape de curingas ILIKE (% _ \) — \ primeiro.
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH base AS (
    SELECT t.id, t.subject, t.status, t.priority_level, t.responder_mode,
           t.created_at, t.updated_at, t.user_id, t.guest_name, t.guest_email,
           u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
           u.subscription_status, u.is_subscribed, u.trial_ends_at
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
     WHERE (v_status   IS NULL OR t.status = v_status)
       AND (v_priority IS NULL OR t.priority_level = v_priority)
       AND (v_mode     IS NULL OR t.responder_mode = v_mode)
       AND (v_from     IS NULL OR t.created_at >= v_from)
       AND (v_to       IS NULL OR t.created_at <= v_to)
       AND (v_like     IS NULL OR (
              t.subject ILIKE v_like ESCAPE '\'
              OR COALESCE(t.guest_name, '')  ILIKE v_like ESCAPE '\'
              OR COALESCE(t.guest_email, '') ILIKE v_like ESCAPE '\'
              OR COALESCE(u.name, '')        ILIKE v_like ESCAPE '\'
              OR COALESCE(u.email, '')       ILIKE v_like ESCAPE '\'
            ))
  ),
  page AS (
    SELECT * FROM base ORDER BY created_at DESC, id LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'subject', p.subject, 'status', p.status,
        'priority_level', p.priority_level, 'responder_mode', p.responder_mode,
        'created_at', p.created_at, 'updated_at', p.updated_at,
        'user_id', p.user_id, 'guest_name', p.guest_name, 'guest_email', p.guest_email,
        'user_name', p.user_name, 'user_email', p.user_email, 'user_phone', p.user_phone,
        'subscription_status', p.subscription_status, 'is_subscribed', p.is_subscribed,
        'trial_ends_at', p.trial_ends_at
      ) ORDER BY p.created_at DESC, p.id) FROM page p
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM base)
  ) INTO v_result;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION support_admin_list_tickets(jsonb, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_admin_list_tickets(jsonb, int, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. support_list_faq (FAQ_VIEW) — filtros + paginação server-side
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION support_list_faq(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit   int   DEFAULT 10,
  p_offset  int   DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_limit   int;
  v_offset  int := GREATEST(COALESCE(p_offset, 0), 0);
  v_cat     text := p_filters ->> 'category';
  v_pub     text := p_filters ->> 'publication_state';
  v_search  text := NULLIF(btrim(COALESCE(p_filters ->> 'search', '')), '');
  v_like    text;
  v_result  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FAQ_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'FAQ_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'list_faq'));
    RAISE EXCEPTION 'permission_denied: FAQ_VIEW required' USING ERRCODE = '42501';
  END IF;

  v_limit := CASE WHEN p_limit IN (10, 50, 100) THEN p_limit ELSE 10 END;
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH base AS (
    SELECT k.id, k.question, k.answer, k.category, k.publication_state,
           k.created_by, k.created_at, k.updated_at
      FROM support_kb_entries k
     WHERE (v_cat    IS NULL OR k.category = v_cat)
       AND (v_pub    IS NULL OR k.publication_state = v_pub)
       AND (v_like   IS NULL OR k.question ILIKE v_like ESCAPE '\' OR k.answer ILIKE v_like ESCAPE '\')
  ),
  page AS (
    SELECT * FROM base ORDER BY created_at DESC, id LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'question', p.question, 'answer', p.answer,
        'category', p.category, 'publication_state', p.publication_state,
        'created_by', p.created_by, 'created_at', p.created_at, 'updated_at', p.updated_at
      ) ORDER BY p.created_at DESC, p.id) FROM page p
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM base)
  ) INTO v_result;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION support_list_faq(jsonb, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_list_faq(jsonb, int, int) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado)
-- ============================================================================
/*
-- Presença das RPCs:
SELECT proname FROM pg_proc
 WHERE proname LIKE 'support_%'
 ORDER BY proname;

-- GRANTS sem anon (esperado: claim/insert_ai só service_role; demais authenticated):
SELECT p.proname, r.rolname
  FROM pg_proc p
  JOIN information_schema.routine_privileges rp ON rp.routine_name = p.proname
  JOIN pg_roles r ON r.rolname = rp.grantee
 WHERE p.proname LIKE 'support_%' AND rp.privilege_type = 'EXECUTE'
 ORDER BY p.proname, r.rolname;

-- support_ai_claims: tabela + UNIQUE + RLS:
SELECT relrowsecurity FROM pg_class WHERE relname = 'support_ai_claims';
SELECT conname FROM pg_constraint WHERE conname = 'uq_support_ai_claims';
*/
