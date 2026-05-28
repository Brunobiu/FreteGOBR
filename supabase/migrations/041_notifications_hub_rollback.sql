-- ============================================================================
-- Rollback Migration 041: Notifications_Hub
-- ============================================================================
-- ATENCAO: rollback documental. NAO eh aplicado automaticamente.
-- Reverte tabelas, triggers, funcoes e RPCs introduzidos pela 041.
-- Aplicar APENAS em situacoes de cleanup planejado.
--
-- A reversao em ordem inversa para nao violar FK:
--   1. Triggers e funcoes
--   2. RPCs
--   3. Policies
--   4. Indices unicos parciais e regulares em notifications
--   5. Colunas adicionadas em notifications
--   6. Tabelas novas (drop em cascade)
-- ============================================================================

BEGIN;

-- 1. RPCs
DROP FUNCTION IF EXISTS rpc_create_broadcast(text, text, text, text[]);
DROP FUNCTION IF EXISTS submit_user_ticket(text, text, text);
DROP FUNCTION IF EXISTS submit_public_ticket(text, text, text, text, text);
DROP FUNCTION IF EXISTS reply_to_ticket(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS resolve_ticket(uuid, timestamptz);
DROP FUNCTION IF EXISTS mark_email_sent(uuid, timestamptz);
DROP FUNCTION IF EXISTS resolve_support_conversation(uuid, timestamptz);

-- 2. Triggers + funcoes de trigger
DROP TRIGGER IF EXISTS broadcast_fanout_after_insert ON broadcast_announcements;
DROP TRIGGER IF EXISTS broadcasts_set_updated_at ON broadcast_announcements;
DROP TRIGGER IF EXISTS chat_messages_notify_on_insert ON chat_messages;
DROP TRIGGER IF EXISTS support_ticket_messages_notify_on_insert ON support_ticket_messages;
DROP TRIGGER IF EXISTS support_tickets_resolved_notify_trigger ON support_tickets;
DROP TRIGGER IF EXISTS support_tickets_set_updated_at ON support_tickets;

DROP FUNCTION IF EXISTS broadcast_fanout();
DROP FUNCTION IF EXISTS chat_messages_notify();
DROP FUNCTION IF EXISTS support_ticket_messages_notify();
DROP FUNCTION IF EXISTS support_tickets_resolved_notify();
DROP FUNCTION IF EXISTS trg_set_updated_at();
DROP FUNCTION IF EXISTS has_admin_permission(uuid, text);

-- 3. Policies
DROP POLICY IF EXISTS broadcasts_select_admin ON broadcast_announcements;
DROP POLICY IF EXISTS broadcasts_mutate_admin ON broadcast_announcements;
DROP POLICY IF EXISTS tickets_select_owner_or_admin ON support_tickets;
DROP POLICY IF EXISTS tickets_update_admin ON support_tickets;
DROP POLICY IF EXISTS ticket_msgs_select ON support_ticket_messages;
DROP POLICY IF EXISTS ticket_msgs_insert ON support_ticket_messages;
DROP POLICY IF EXISTS ticket_msgs_update_admin ON support_ticket_messages;

-- 4. Remove tabelas novas do realtime publication (best-effort)
DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE support_ticket_messages;
    EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE support_tickets;
    EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE broadcast_announcements;
    EXCEPTION WHEN undefined_object THEN NULL; END;
  END IF;
END
$pub$;

-- 5. Indices em notifications criados pela 041
DROP INDEX IF EXISTS uq_notifications_user_broadcast;
DROP INDEX IF EXISTS uq_notifications_user_plan_unread;
DROP INDEX IF EXISTS idx_notifications_user_created;

-- 6. Colunas adicionadas em notifications
ALTER TABLE notifications DROP COLUMN IF EXISTS broadcast_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS ticket_id;

-- 7. Tabelas novas (CASCADE para FK em support_ticket_attempts e ticket_messages)
DROP TABLE IF EXISTS support_ticket_attempts CASCADE;
DROP TABLE IF EXISTS support_ticket_messages CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;
DROP TABLE IF EXISTS broadcast_announcements CASCADE;

COMMIT;
