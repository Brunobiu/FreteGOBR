-- ============================================================================
-- ROLLBACK da Migration 119: Supervisor_Chat_History
-- ============================================================================
-- Documentado, NÃO auto-aplicado. Reverte 119 (sessões + mensagens + RPCs).
-- NÃO mexe na função supervisor_touch_updated_at (compartilhada com 118).
-- Idempotente (IF EXISTS).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS supervisor_chat_session_delete(uuid);
DROP FUNCTION IF EXISTS supervisor_chat_session_rename(uuid, text);
DROP FUNCTION IF EXISTS supervisor_chat_message_append(uuid, text, text);
DROP FUNCTION IF EXISTS supervisor_chat_messages_list(uuid);
DROP FUNCTION IF EXISTS supervisor_chat_sessions_list(int, int);
DROP FUNCTION IF EXISTS supervisor_chat_session_create(text);

-- messages tem FK p/ sessions (ON DELETE CASCADE); dropar messages primeiro.
DROP TABLE IF EXISTS supervisor_chat_messages;
DROP TABLE IF EXISTS supervisor_chat_sessions;

COMMIT;
