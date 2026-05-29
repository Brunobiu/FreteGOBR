-- ============================================================================
-- Migration 043: Alinhar RLS de chat_conversations / chat_messages ao RBAC novo
-- ============================================================================
-- Spec: .kiro/specs/notifications-hub/tasks.md (task 1.23)
--
-- Contexto:
--   As policies de chat_conversations/chat_messages (migrations 003/009)
--   reconheciam admin apenas via legado `users.user_type = 'admin'`. O
--   painel admin novo (admin-foundation, migration 030) identifica admins
--   por `is_admin_with_permission(...)`, NAO por user_type.
--
--   Como `services/admin/supportChat.ts` acessa essas tabelas DIRETAMENTE
--   (sem RPC SECURITY DEFINER) para listar e ler conversas, um admin com
--   papel SUPORTE (mas sem user_type='admin') ficava sem acesso.
--
-- Esta migration recria as policies para reconhecer:
--   - O proprio dono da conversa (user_id = auth.uid()).
--   - Admin com SUPORTE_VIEW (leitura) / SUPORTE_REPLY (escrita).
--   - Mantem o check legado user_type='admin' como fallback defensivo
--     (nao quebra ambientes antigos).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- ============================================================================

BEGIN;

-- Validacao defensiva: dependencia da admin-foundation.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
     WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'chat_conversations'
  ) THEN
    RAISE EXCEPTION 'Tabela chat_conversations ausente (migration 008/009)';
  END IF;
END
$check$;

-- ─── chat_conversations ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_conversations_select_policy ON chat_conversations;
CREATE POLICY chat_conversations_select_policy ON chat_conversations
FOR SELECT
USING (
  user_id = auth.uid()
  OR is_admin_with_permission('SUPORTE_VIEW')
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_conversations_insert_policy ON chat_conversations;
CREATE POLICY chat_conversations_insert_policy ON chat_conversations
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_conversations_update_policy ON chat_conversations;
CREATE POLICY chat_conversations_update_policy ON chat_conversations
FOR UPDATE
USING (
  user_id = auth.uid()
  OR is_admin_with_permission('SUPORTE_REPLY')
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_conversations_delete_policy ON chat_conversations;
CREATE POLICY chat_conversations_delete_policy ON chat_conversations
FOR DELETE
USING (
  is_admin_with_permission('SUPORTE_REPLY')
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

-- ─── chat_messages ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_messages_select_policy ON chat_messages;
CREATE POLICY chat_messages_select_policy ON chat_messages
FOR SELECT
USING (
  sender_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM chat_conversations
     WHERE id = chat_messages.conversation_id AND user_id = auth.uid()
  )
  OR is_admin_with_permission('SUPORTE_VIEW')
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_messages_insert_policy ON chat_messages;
CREATE POLICY chat_messages_insert_policy ON chat_messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND (
    -- User dono da conversa enviando mensagem propria (is_admin=false)
    (
      is_admin = false
      AND EXISTS (
        SELECT 1 FROM chat_conversations
         WHERE id = chat_messages.conversation_id AND user_id = auth.uid()
      )
    )
    -- Admin com SUPORTE_REPLY respondendo (is_admin=true)
    OR (
      is_admin = true
      AND is_admin_with_permission('SUPORTE_REPLY')
    )
    -- Fallback legado
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
  )
);

DROP POLICY IF EXISTS chat_messages_update_policy ON chat_messages;
CREATE POLICY chat_messages_update_policy ON chat_messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM chat_conversations
     WHERE id = chat_messages.conversation_id AND user_id = auth.uid()
  )
  OR is_admin_with_permission('SUPORTE_REPLY')
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_messages_delete_policy ON chat_messages;
CREATE POLICY chat_messages_delete_policy ON chat_messages
FOR DELETE
USING (
  is_admin_with_permission('SUPORTE_REPLY')
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

-- Mantemos a policy de metadata da migration 031 (chat_messages_admin_metadata)
-- intacta — ela concede SELECT a admins com USER_VIEW e nao conflita.

COMMIT;

/*
-- VERIFY (apos apply):
SELECT polname, cmd FROM pg_policies
 WHERE tablename IN ('chat_conversations', 'chat_messages')
 ORDER BY tablename, polname;
*/
