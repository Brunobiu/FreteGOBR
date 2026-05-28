-- ============================================================================
-- Migration 041: Notifications_Hub
-- ============================================================================
-- Spec: .kiro/specs/notifications-hub/{requirements,design,tasks}.md
--
-- Entrega:
--   1. Tabela broadcast_announcements + trigger de fan-out idempotente.
--   2. Tabela support_tickets (logado + visitante anônimo).
--   3. Tabela support_ticket_messages.
--   4. Tabela support_ticket_attempts (rate-limit anti-bot).
--   5. Extensão de notifications: colunas broadcast_id, ticket_id + índices
--      únicos parciais para idempotência de broadcast e dedup de plano.
--   6. Triggers em chat_messages (chat de suporte user↔admin) e
--      support_ticket_messages para gerar notificações automáticas.
--   7. RPCs SECURITY DEFINER para criação de broadcast, submissão de ticket
--      (logado e público anônimo), resposta admin, resolução, marcação de
--      email enviado.
--   8. RLS em todas as tabelas novas + ajuste em policies existentes onde
--      preciso para INSERT direto bloqueado.
--
-- Dependências:
--   - 001 (notifications, users, audit_logs)
--   - 008/009 (chat_conversations, chat_messages, conversations, messages)
--   - 023/024 (notify_new_message: NÃO altera, preserva)
--   - 030 (admin-foundation: is_admin_with_permission, admin_audit_logs)
--
-- Convenções:
--   - Idempotente (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--     DROP POLICY IF EXISTS antes de CREATE POLICY).
--   - Action codes em UPPER_SNAKE inglês.
--   - Mensagens de erro técnicas em inglês; user-facing pt-BR mora no client.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validações defensivas: dependências precisam estar aplicadas
-- ────────────────────────────────────────────────────────────────────────────

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
     WHERE routine_schema='public' AND routine_name='is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='admin_audit_logs') THEN
    RAISE EXCEPTION 'Tabela admin_audit_logs ausente (migration 030).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='admin_audit_logs'
                    AND column_name='after_data') THEN
    RAISE EXCEPTION 'admin_audit_logs.after_data ausente.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='notifications') THEN
    RAISE EXCEPTION 'Tabela notifications ausente (migration 001).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='chat_conversations') THEN
    RAISE EXCEPTION 'Tabela chat_conversations ausente (migration 008/009).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='chat_messages') THEN
    RAISE EXCEPTION 'Tabela chat_messages ausente (migration 008/009).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela users ausente.';
  END IF;
END
$check$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. broadcast_announcements
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS broadcast_announcements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  link             text NULL CHECK (link IS NULL OR char_length(link) <= 500),
  target_audience  text[] NOT NULL CHECK (
    array_length(target_audience, 1) >= 1
    AND target_audience <@ ARRAY['motorista','embarcador','empresa']::text[]
  ),
  status           text NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent','draft','scheduled')),
  recipients_count int NULL,
  dispatched_at    timestamptz NULL,
  created_by       uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_created
  ON broadcast_announcements (created_at DESC);

ALTER TABLE broadcast_announcements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE broadcast_announcements IS
  'Comunicados criados pelo admin com targeting por user_type. Fan-out automatico via trigger gera linhas em notifications.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. support_tickets
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  guest_name   text NULL CHECK (
    guest_name IS NULL
    OR char_length(guest_name) BETWEEN 2 AND 80
  ),
  guest_email  text NULL CHECK (
    guest_email IS NULL
    OR guest_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  subject      text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','in_progress','resolved')),
  priority     text NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('low','normal','high')),
  resolved_at  timestamptz NULL,
  resolved_by  uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_xor_guest CHECK (
    (user_id IS NOT NULL AND guest_name IS NULL AND guest_email IS NULL)
    OR (user_id IS NULL AND guest_name IS NOT NULL AND guest_email IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tickets_user
  ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status
  ON support_tickets (status, created_at DESC);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE support_tickets IS
  'Tickets de suporte. user_id NOT NULL = usuario logado. user_id NULL = visitante anonimo (guest_name + guest_email obrigatorios).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. support_ticket_messages
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id     uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  is_admin      boolean NOT NULL DEFAULT false,
  email_sent_at timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket
  ON support_ticket_messages (ticket_id, created_at);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages REPLICA IDENTITY FULL;

COMMENT ON TABLE support_ticket_messages IS
  'Mensagens de cada support_ticket. is_admin true = resposta do admin. email_sent_at preenchido apenas em respostas a tickets publicos (user_id NULL no ticket).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. support_ticket_attempts (rate-limit anti-bot)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_ticket_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip           inet NOT NULL,
  guest_email  text NULL,
  bot_detected boolean NOT NULL DEFAULT false,
  rate_limited boolean NOT NULL DEFAULT false,
  ticket_id    uuid NULL REFERENCES support_tickets(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_attempts_ip_time
  ON support_ticket_attempts (ip, created_at DESC);

ALTER TABLE support_ticket_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE support_ticket_attempts IS
  'Telemetria anti-bot/rate-limit do submit_public_ticket. Sem RLS publica - acesso so via RPC SECURITY DEFINER.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Extensao de notifications: broadcast_id, ticket_id + indices unicos
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS broadcast_id uuid NULL
    REFERENCES broadcast_announcements(id) ON DELETE SET NULL;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS ticket_id uuid NULL
    REFERENCES support_tickets(id) ON DELETE SET NULL;

-- Idempotencia de fan-out: 1 notificacao por (user, broadcast)
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_broadcast
  ON notifications (user_id, broadcast_id)
  WHERE broadcast_id IS NOT NULL;

-- 1 notificacao plan_* nao-lida por user (dedup natural)
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_plan_unread
  ON notifications (user_id, type)
  WHERE read_at IS NULL AND type LIKE 'plan_%';

-- Listagem rapida no modal
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RLS Policies — broadcast_announcements
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS broadcasts_select_admin ON broadcast_announcements;
CREATE POLICY broadcasts_select_admin
  ON broadcast_announcements FOR SELECT
  TO authenticated
  USING (
    is_admin_with_permission('FINANCEIRO_VIEW')
    OR is_admin_with_permission('FINANCEIRO_EDIT')
  );

DROP POLICY IF EXISTS broadcasts_mutate_admin ON broadcast_announcements;
CREATE POLICY broadcasts_mutate_admin
  ON broadcast_announcements FOR ALL
  TO authenticated
  USING (is_admin_with_permission('FINANCEIRO_EDIT'))
  WITH CHECK (is_admin_with_permission('FINANCEIRO_EDIT'));

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RLS Policies — support_tickets
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS tickets_select_owner_or_admin ON support_tickets;
CREATE POLICY tickets_select_owner_or_admin
  ON support_tickets FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_admin_with_permission('SUPORTE_VIEW')
  );

-- INSERT direto bloqueado (sem policy de INSERT) — RLS bloqueia por default.
-- Inserts so via RPC submit_user_ticket / submit_public_ticket.

DROP POLICY IF EXISTS tickets_update_admin ON support_tickets;
CREATE POLICY tickets_update_admin
  ON support_tickets FOR UPDATE
  TO authenticated
  USING (is_admin_with_permission('SUPORTE_REPLY'))
  WITH CHECK (is_admin_with_permission('SUPORTE_REPLY'));

-- DELETE bloqueado (nao havera DELETE em Phase 1).

-- ────────────────────────────────────────────────────────────────────────────
-- 8. RLS Policies — support_ticket_messages
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS ticket_msgs_select ON support_ticket_messages;
CREATE POLICY ticket_msgs_select
  ON support_ticket_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets t
       WHERE t.id = support_ticket_messages.ticket_id
         AND (t.user_id = auth.uid() OR is_admin_with_permission('SUPORTE_VIEW'))
    )
  );

-- INSERT permitido para o dono do ticket OU admin SUPORTE_REPLY.
-- Visitante anonimo (user_id NULL) nao usa este policy — sua mensagem
-- inicial vai via submit_public_ticket que insere direto via SECURITY DEFINER.
DROP POLICY IF EXISTS ticket_msgs_insert ON support_ticket_messages;
CREATE POLICY ticket_msgs_insert
  ON support_ticket_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Caller eh dono do ticket e nao esta marcando is_admin
    (
      is_admin = false
      AND author_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM support_tickets t
         WHERE t.id = support_ticket_messages.ticket_id
           AND t.user_id = auth.uid()
      )
    )
    OR
    -- Caller eh admin com SUPORTE_REPLY e marcou is_admin=true
    (
      is_admin = true
      AND is_admin_with_permission('SUPORTE_REPLY')
      AND author_id = auth.uid()
    )
  );

-- UPDATE: so admin pode marcar email_sent_at via RPC mark_email_sent
DROP POLICY IF EXISTS ticket_msgs_update_admin ON support_ticket_messages;
CREATE POLICY ticket_msgs_update_admin
  ON support_ticket_messages FOR UPDATE
  TO authenticated
  USING (is_admin_with_permission('SUPORTE_REPLY'))
  WITH CHECK (is_admin_with_permission('SUPORTE_REPLY'));

-- ────────────────────────────────────────────────────────────────────────────
-- 9. RLS Policies — support_ticket_attempts
-- ────────────────────────────────────────────────────────────────────────────

-- Sem policies publicas. Acesso so via SECURITY DEFINER RPCs (submit_public_ticket
-- insere; admin pode SELECT via permissao no futuro). RLS habilitado, sem CREATE
-- POLICY = ninguem acessa diretamente.

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Trigger function: broadcast_fanout
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION broadcast_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inserted int;
BEGIN
  -- Fan-out: 1 notification por usuario ativo no audience.
  -- ON CONFLICT garante idempotencia em caso de re-INSERT do broadcast.
  INSERT INTO notifications (user_id, type, title, message, link, broadcast_id)
  SELECT
    u.id,
    'broadcast_general',
    NEW.title,
    NEW.body,
    NEW.link,
    NEW.id
    FROM users u
   WHERE u.is_active = true
     AND u.user_type = ANY (NEW.target_audience)
  ON CONFLICT (user_id, broadcast_id) WHERE broadcast_id IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Atualiza contagem e timestamp de despacho
  UPDATE broadcast_announcements
     SET recipients_count = v_inserted,
         dispatched_at    = NOW()
   WHERE id = NEW.id;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS broadcast_fanout_after_insert ON broadcast_announcements;
CREATE TRIGGER broadcast_fanout_after_insert
  AFTER INSERT ON broadcast_announcements
  FOR EACH ROW
  WHEN (NEW.status = 'sent')
  EXECUTE FUNCTION broadcast_fanout();

COMMENT ON FUNCTION broadcast_fanout() IS
  'Fan-out de broadcast_announcements para notifications. Idempotente via uq_notifications_user_broadcast.';

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Helper: has_admin_permission(target_user_id, action) — gating sem auth.uid()
-- ────────────────────────────────────────────────────────────────────────────
-- is_admin_with_permission(action) usa auth.uid() implicito, o que nao
-- funciona em triggers (auth.uid eh do invocador da query original, nao do
-- admin que recebera notificacao). Esta versao parametrizada eh usavel em
-- triggers para checar se um usuario alvo possui certa permissao admin.
-- Espelha a logica de papel→permissao da migration 030.

CREATE OR REPLACE FUNCTION has_admin_permission(p_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH active AS (
    SELECT role FROM admin_roles
     WHERE user_id = p_user_id AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$fn$;

REVOKE ALL ON FUNCTION has_admin_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_admin_permission(uuid, text) TO authenticated;

COMMENT ON FUNCTION has_admin_permission(uuid, text) IS
  'Variante parametrizada de is_admin_with_permission, usavel em triggers. Recebe target_user_id explicito.';

-- ────────────────────────────────────────────────────────────────────────────
-- 12. Trigger function: chat_messages_notify (chat de suporte user↔admin)
-- ────────────────────────────────────────────────────────────────────────────
-- IMPORTANTE: tabela chat_messages eh usada apenas para chat de SUPORTE
-- (user ↔ admin pool). Chat de FRETE usa a tabela `messages` (com trigger
-- notify_new_message ja existente em 023/024). Nao confundir.

CREATE OR REPLACE FUNCTION chat_messages_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id        uuid;
  v_sender_name    text;
  v_truncated_body text;
BEGIN
  -- Body truncado para preview na notificacao
  v_truncated_body := substring(NEW.message FROM 1 FOR 100);

  IF NEW.is_admin = false THEN
    -- Mensagem do user → notifica todos admins ativos com SUPORTE_VIEW
    SELECT name INTO v_sender_name FROM users WHERE id = NEW.sender_id;

    INSERT INTO notifications (user_id, type, title, message, link)
    SELECT
      a.id,
      'chat_support_user_message',
      coalesce(v_sender_name, 'Usuario') || ' enviou mensagem ao suporte',
      v_truncated_body,
      '/admin/suporte/chat?conv=' || NEW.conversation_id::text
      FROM users a
     WHERE a.is_active = true
       AND has_admin_permission(a.id, 'SUPORTE_VIEW')
    ;

  ELSE
    -- Resposta do admin → notifica o user_id da conversa
    SELECT user_id INTO v_user_id
      FROM chat_conversations
     WHERE id = NEW.conversation_id;

    IF v_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT name INTO v_sender_name FROM users WHERE id = NEW.sender_id;

    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (
      v_user_id,
      'chat_support_admin_reply',
      'Suporte respondeu',
      v_truncated_body,
      '/suporte/chat'
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS chat_messages_notify_on_insert ON chat_messages;
CREATE TRIGGER chat_messages_notify_on_insert
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION chat_messages_notify();

-- ────────────────────────────────────────────────────────────────────────────
-- 13. Trigger function: support_ticket_messages_notify
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION support_ticket_messages_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ticket          support_tickets%ROWTYPE;
  v_message_count   int;
  v_truncated_body  text;
  v_admin_name      text;
BEGIN
  SELECT * INTO v_ticket FROM support_tickets WHERE id = NEW.ticket_id;
  IF v_ticket.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_truncated_body := substring(NEW.body FROM 1 FOR 100);

  IF NEW.is_admin = true THEN
    -- Resposta do admin → notifica o user_id do ticket (se nao for publico)
    IF v_ticket.user_id IS NOT NULL THEN
      SELECT name INTO v_admin_name FROM users WHERE id = NEW.author_id;

      INSERT INTO notifications (user_id, type, title, message, link, ticket_id)
      VALUES (
        v_ticket.user_id,
        'ticket_replied',
        coalesce(v_admin_name, 'Suporte') || ' respondeu seu ticket',
        v_truncated_body,
        '/tickets/' || v_ticket.id::text,
        v_ticket.id
      );
    END IF;

  ELSE
    -- Mensagem do usuario/visitante. So notifica admins se for a primeira
    -- mensagem do ticket (ticket_created).
    SELECT count(*) INTO v_message_count
      FROM support_ticket_messages
     WHERE ticket_id = NEW.ticket_id;

    IF v_message_count = 1 THEN
      INSERT INTO notifications (user_id, type, title, message, link, ticket_id)
      SELECT
        a.id,
        'ticket_created',
        CASE
          WHEN v_ticket.user_id IS NULL
            THEN '[Visitante] Novo ticket: ' || v_ticket.subject
          ELSE 'Novo ticket: ' || v_ticket.subject
        END,
        v_truncated_body,
        '/admin/suporte/tickets/' || v_ticket.id::text,
        v_ticket.id
        FROM users a
       WHERE a.is_active = true
         AND has_admin_permission(a.id, 'SUPORTE_VIEW');
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS support_ticket_messages_notify_on_insert
  ON support_ticket_messages;
CREATE TRIGGER support_ticket_messages_notify_on_insert
  AFTER INSERT ON support_ticket_messages
  FOR EACH ROW
  EXECUTE FUNCTION support_ticket_messages_notify();

-- ────────────────────────────────────────────────────────────────────────────
-- 14. Trigger: support_tickets_resolved_notify
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION support_tickets_resolved_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW; -- ticket publico nao tem user pra notificar
  END IF;

  INSERT INTO notifications (user_id, type, title, message, link, ticket_id)
  VALUES (
    NEW.user_id,
    'ticket_resolved',
    'Ticket resolvido',
    'Seu ticket "' || substring(NEW.subject FROM 1 FOR 80) || '" foi marcado como resolvido.',
    '/tickets/' || NEW.id::text,
    NEW.id
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS support_tickets_resolved_notify_trigger ON support_tickets;
CREATE TRIGGER support_tickets_resolved_notify_trigger
  AFTER UPDATE ON support_tickets
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status = 'resolved'
  )
  EXECUTE FUNCTION support_tickets_resolved_notify();

-- ────────────────────────────────────────────────────────────────────────────
-- 15. Trigger: updated_at automatico em support_tickets e broadcast_announcements
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS support_tickets_set_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_set_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS broadcasts_set_updated_at ON broadcast_announcements;
CREATE TRIGGER broadcasts_set_updated_at
  BEFORE UPDATE ON broadcast_announcements
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 16. RPC: rpc_create_broadcast
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_create_broadcast(
  p_title           text,
  p_body            text,
  p_link            text,
  p_target_audience text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_id     uuid;
  v_row    broadcast_announcements%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('FINANCEIRO_EDIT') THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id,
                                  before_data, after_data)
    VALUES (v_caller, 'BROADCAST_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_EDIT required'
      USING ERRCODE = '42501';
  END IF;

  -- Validacoes de dominio
  IF p_title IS NULL OR char_length(p_title) < 1 OR char_length(p_title) > 120 THEN
    RAISE EXCEPTION 'INVALID_TITLE' USING ERRCODE = 'P0001';
  END IF;

  IF p_body IS NULL OR char_length(p_body) < 1 OR char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'INVALID_BODY' USING ERRCODE = 'P0001';
  END IF;

  IF p_link IS NOT NULL AND char_length(p_link) > 500 THEN
    RAISE EXCEPTION 'INVALID_LINK' USING ERRCODE = 'P0001';
  END IF;

  IF p_target_audience IS NULL OR array_length(p_target_audience, 1) IS NULL THEN
    RAISE EXCEPTION 'EMPTY_AUDIENCE' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_target_audience <@ ARRAY['motorista','embarcador','empresa']::text[]) THEN
    RAISE EXCEPTION 'INVALID_AUDIENCE' USING ERRCODE = 'P0001';
  END IF;

  -- Insercao + trigger faz fan-out
  INSERT INTO broadcast_announcements
    (title, body, link, target_audience, status, created_by)
  VALUES
    (p_title, p_body, p_link, p_target_audience, 'sent', v_caller)
  RETURNING id INTO v_id;

  SELECT * INTO v_row FROM broadcast_announcements WHERE id = v_id;

  RETURN jsonb_build_object(
    'id',               v_row.id,
    'title',            v_row.title,
    'body',             v_row.body,
    'link',             v_row.link,
    'target_audience',  v_row.target_audience,
    'status',           v_row.status,
    'recipients_count', v_row.recipients_count,
    'dispatched_at',    v_row.dispatched_at,
    'created_by',       v_row.created_by,
    'created_at',       v_row.created_at,
    'updated_at',       v_row.updated_at
  );
END;
$fn$;

REVOKE ALL ON FUNCTION rpc_create_broadcast(text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_create_broadcast(text, text, text, text[]) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 17. RPC: submit_user_ticket
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_user_ticket(
  p_subject  text,
  p_body     text,
  p_priority text DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_ticket support_tickets%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  IF p_subject IS NULL OR char_length(p_subject) < 3 OR char_length(p_subject) > 120 THEN
    RAISE EXCEPTION 'INVALID_SUBJECT' USING ERRCODE = 'P0001';
  END IF;

  IF p_body IS NULL OR char_length(p_body) < 10 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'INVALID_BODY' USING ERRCODE = 'P0001';
  END IF;

  IF p_priority NOT IN ('low','normal','high') THEN
    RAISE EXCEPTION 'INVALID_PRIORITY' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO support_tickets (user_id, subject, status, priority)
  VALUES (v_caller, p_subject, 'open', p_priority)
  RETURNING * INTO v_ticket;

  INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_admin)
  VALUES (v_ticket.id, v_caller, p_body, false);

  RETURN to_jsonb(v_ticket);
END;
$fn$;

REVOKE ALL ON FUNCTION submit_user_ticket(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_user_ticket(text, text, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 18. RPC: submit_public_ticket (anon-friendly + honeypot + rate-limit)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_public_ticket(
  p_guest_name   text,
  p_guest_email  text,
  p_subject      text,
  p_body         text,
  p_website_url  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ip            inet := inet_client_addr();
  v_attempts_1h   int;
  v_ticket_id     uuid;
BEGIN
  -- Honeypot: se website_url veio preenchido, eh bot. Fingimos sucesso.
  IF p_website_url IS NOT NULL AND char_length(trim(p_website_url)) > 0 THEN
    INSERT INTO support_ticket_attempts (ip, guest_email, bot_detected)
    VALUES (coalesce(v_ip, '0.0.0.0'::inet), p_guest_email, true);
    RETURN jsonb_build_object('submitted', true);
  END IF;

  -- Validacoes de input
  IF p_guest_name IS NULL OR char_length(p_guest_name) < 2 OR char_length(p_guest_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  IF p_guest_email IS NULL OR p_guest_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  IF p_subject IS NULL OR char_length(p_subject) < 3 OR char_length(p_subject) > 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  IF p_body IS NULL OR char_length(p_body) < 10 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  -- Rate-limit por IP: max 5 tentativas validas/hora
  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_attempts_1h
      FROM support_ticket_attempts
     WHERE ip = v_ip
       AND created_at > NOW() - INTERVAL '1 hour'
       AND bot_detected = false
       AND rate_limited = false;

    IF v_attempts_1h >= 5 THEN
      INSERT INTO support_ticket_attempts (ip, guest_email, rate_limited)
      VALUES (v_ip, p_guest_email, true);
      RAISE EXCEPTION 'PUBLIC_TICKET_RATE_LIMITED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Cria ticket + primeira mensagem em transacao
  INSERT INTO support_tickets (guest_name, guest_email, subject, status, priority)
  VALUES (p_guest_name, p_guest_email, p_subject, 'open', 'normal')
  RETURNING id INTO v_ticket_id;

  INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_admin)
  VALUES (v_ticket_id, NULL, p_body, false);

  -- Registra attempt bem-sucedido
  INSERT INTO support_ticket_attempts (ip, guest_email, ticket_id)
  VALUES (coalesce(v_ip, '0.0.0.0'::inet), p_guest_email, v_ticket_id);

  -- Resposta opaca (anti-enumeration). Nao retornamos o ticket_id.
  RETURN jsonb_build_object('submitted', true);
END;
$fn$;

REVOKE ALL ON FUNCTION submit_public_ticket(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_public_ticket(text, text, text, text, text)
  TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 19. RPC: reply_to_ticket
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reply_to_ticket(
  p_ticket_id          uuid,
  p_body               text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller    uuid := auth.uid();
  v_ticket    support_tickets%ROWTYPE;
  v_message_id uuid;
  v_updated   timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id,
                                  before_data, after_data)
    VALUES (v_caller, 'SUPORTE_TICKET_VIEW_DENIED', 'support_tickets',
            p_ticket_id, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required'
      USING ERRCODE = '42501';
  END IF;

  IF p_body IS NULL OR char_length(p_body) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'INVALID_BODY' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ticket FROM support_tickets
   WHERE id = p_ticket_id FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- Insere mensagem
  INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_admin)
  VALUES (p_ticket_id, v_caller, p_body, true)
  RETURNING id INTO v_message_id;

  -- Atualiza status open → in_progress; sempre toca updated_at
  UPDATE support_tickets
     SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
   WHERE id = p_ticket_id
  RETURNING updated_at INTO v_updated;

  RETURN jsonb_build_object(
    'message_id',   v_message_id,
    'ticket_id',    p_ticket_id,
    'updated_at',   v_updated,
    'is_public',    v_ticket.user_id IS NULL,
    'guest_name',   v_ticket.guest_name,
    'guest_email',  v_ticket.guest_email,
    'subject',      v_ticket.subject
  );
END;
$fn$;

REVOKE ALL ON FUNCTION reply_to_ticket(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reply_to_ticket(uuid, text, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 20. RPC: resolve_ticket (idempotente _SKIPPED)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_ticket(
  p_ticket_id           uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_ticket  support_tickets%ROWTYPE;
  v_rows    int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id,
                                  before_data, after_data)
    VALUES (v_caller, 'SUPORTE_TICKET_VIEW_DENIED', 'support_tickets',
            p_ticket_id, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket FROM support_tickets
   WHERE id = p_ticket_id FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotencia _SKIPPED
  IF v_ticket.status = 'resolved' THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id,
                                  before_data, after_data)
    VALUES (v_caller, 'SUPORTE_TICKET_RESOLVE_SKIPPED', 'support_tickets',
            p_ticket_id, NULL,
            jsonb_build_object('reason', 'ALREADY_RESOLVED'));
    RETURN jsonb_build_object(
      'skipped',   true,
      'reason',    'ALREADY_RESOLVED',
      'ticket_id', p_ticket_id
    );
  END IF;

  -- Versionamento otimista
  IF v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE support_tickets
     SET status      = 'resolved',
         resolved_at = NOW(),
         resolved_by = v_caller
   WHERE id = p_ticket_id
     AND updated_at = p_expected_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- Trigger support_tickets_resolved_notify dispara notif para o user
  RETURN jsonb_build_object('ok', true, 'ticket_id', p_ticket_id);
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_ticket(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ticket(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 21. RPC: mark_email_sent (admin marca email_sent_at apos sucesso da Edge Fn)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_email_sent(
  p_message_id uuid,
  p_sent_at    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE support_ticket_messages
     SET email_sent_at = p_sent_at
   WHERE id = p_message_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION mark_email_sent(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_email_sent(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 22. RPC: resolve_support_conversation (idempotente)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_support_conversation(
  p_conversation_id     uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_convo  chat_conversations%ROWTYPE;
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SUPORTE_REPLY') THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id,
                                  before_data, after_data)
    VALUES (v_caller, 'SUPORTE_CHAT_VIEW_DENIED', 'chat_conversations',
            p_conversation_id, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPORTE_REPLY required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_convo FROM chat_conversations
   WHERE id = p_conversation_id FOR UPDATE;

  IF v_convo.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_convo.status = 'resolvida' THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id,
                                  before_data, after_data)
    VALUES (v_caller, 'SUPORTE_CHAT_RESOLVE_SKIPPED', 'chat_conversations',
            p_conversation_id, NULL,
            jsonb_build_object('reason', 'ALREADY_RESOLVED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_RESOLVED');
  END IF;

  IF v_convo.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE chat_conversations
     SET status     = 'resolvida',
         updated_at = NOW()
   WHERE id = p_conversation_id
     AND updated_at = p_expected_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'conversation_id', p_conversation_id);
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_support_conversation(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_support_conversation(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 23. Adicionar tabelas novas ao realtime
-- ────────────────────────────────────────────────────────────────────────────

DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE support_ticket_messages;
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE support_tickets;
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE broadcast_announcements;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END
$pub$;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual após apply)
-- ============================================================================
/*
SELECT to_regclass('public.broadcast_announcements');
SELECT to_regclass('public.support_tickets');
SELECT to_regclass('public.support_ticket_messages');
SELECT to_regclass('public.support_ticket_attempts');

SELECT column_name FROM information_schema.columns
 WHERE table_name = 'notifications' AND column_name IN ('broadcast_id','ticket_id');

SELECT routine_name FROM information_schema.routines
 WHERE routine_schema = 'public'
   AND routine_name IN (
     'rpc_create_broadcast', 'submit_user_ticket', 'submit_public_ticket',
     'reply_to_ticket', 'resolve_ticket', 'mark_email_sent',
     'resolve_support_conversation',
     'broadcast_fanout', 'chat_messages_notify',
     'support_ticket_messages_notify', 'support_tickets_resolved_notify'
   );

SELECT policyname FROM pg_policies
 WHERE tablename IN ('broadcast_announcements','support_tickets','support_ticket_messages');

SELECT trigger_name, event_object_table FROM information_schema.triggers
 WHERE event_object_table IN ('broadcast_announcements','chat_messages',
                              'support_tickets','support_ticket_messages');
*/
