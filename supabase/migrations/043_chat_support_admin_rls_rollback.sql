-- ============================================================================
-- ROLLBACK Migration 043: restaura policies legadas de chat (user_type='admin')
-- ============================================================================
-- Documentacao apenas — NAO auto-aplicado.
--
-- Reverte as policies de chat_conversations / chat_messages ao estado da
-- migration 009 (reconhecimento de admin apenas via user_type='admin').
-- ============================================================================

BEGIN;

-- ─── chat_conversations ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_conversations_select_policy ON chat_conversations;
CREATE POLICY chat_conversations_select_policy ON chat_conversations
FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_conversations_insert_policy ON chat_conversations;
CREATE POLICY chat_conversations_insert_policy ON chat_conversations
FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_conversations_update_policy ON chat_conversations;
CREATE POLICY chat_conversations_update_policy ON chat_conversations
FOR UPDATE USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_conversations_delete_policy ON chat_conversations;
CREATE POLICY chat_conversations_delete_policy ON chat_conversations
FOR DELETE USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

-- ─── chat_messages ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_messages_select_policy ON chat_messages;
CREATE POLICY chat_messages_select_policy ON chat_messages
FOR SELECT USING (
  sender_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM chat_conversations
     WHERE id = chat_messages.conversation_id AND user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_messages_insert_policy ON chat_messages;
CREATE POLICY chat_messages_insert_policy ON chat_messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND (
    EXISTS (
      SELECT 1 FROM chat_conversations
       WHERE id = chat_messages.conversation_id AND user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
  )
);

DROP POLICY IF EXISTS chat_messages_update_policy ON chat_messages;
CREATE POLICY chat_messages_update_policy ON chat_messages
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM chat_conversations
     WHERE id = chat_messages.conversation_id AND user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

DROP POLICY IF EXISTS chat_messages_delete_policy ON chat_messages;
CREATE POLICY chat_messages_delete_policy ON chat_messages
FOR DELETE USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
);

COMMIT;
