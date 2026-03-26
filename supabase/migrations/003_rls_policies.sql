-- FreteGO Database Schema
-- Migration 003: Row Level Security (RLS) Policies

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE embarcadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE frete_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- USERS TABLE POLICIES
-- ============================================================================

-- Users can view their own data, admins can view all
CREATE POLICY users_select_policy ON users
FOR SELECT
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Users can update their own data, admins can update all
CREATE POLICY users_update_policy ON users
FOR UPDATE
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only admins can delete users
CREATE POLICY users_delete_policy ON users
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Users can insert their own record during registration
CREATE POLICY users_insert_policy ON users
FOR INSERT
WITH CHECK (auth.uid() = id);

-- ============================================================================
-- MOTORISTAS TABLE POLICIES
-- ============================================================================

-- Motoristas can view their own data, admins can view all
CREATE POLICY motoristas_select_policy ON motoristas
FOR SELECT
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Motoristas can update their own data, admins can update all
CREATE POLICY motoristas_update_policy ON motoristas
FOR UPDATE
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Motoristas can insert their own record during registration
CREATE POLICY motoristas_insert_policy ON motoristas
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Only admins can delete motoristas
CREATE POLICY motoristas_delete_policy ON motoristas
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- EMBARCADORES TABLE POLICIES
-- ============================================================================

-- Embarcadores can view their own data, admins can view all
-- Motoristas can view embarcador public info (for ratings display)
CREATE POLICY embarcadores_select_policy ON embarcadores
FOR SELECT
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type IN ('admin', 'motorista')
  )
);

-- Embarcadores can update their own data, admins can update all
CREATE POLICY embarcadores_update_policy ON embarcadores
FOR UPDATE
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Embarcadores can insert their own record during registration
CREATE POLICY embarcadores_insert_policy ON embarcadores
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Only admins can delete embarcadores
CREATE POLICY embarcadores_delete_policy ON embarcadores
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- FRETES TABLE POLICIES
-- ============================================================================

-- Everyone (including anonymous users) can view active fretes
-- Embarcadores can view their own fretes regardless of status
-- Admins can view all fretes
CREATE POLICY fretes_select_policy ON fretes
FOR SELECT
USING (
  status = 'ativo' OR 
  embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only embarcadores can insert fretes
CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM embarcadores
    WHERE id = auth.uid()
  ) AND embarcador_id = auth.uid()
);

-- Only frete owner or admin can update
CREATE POLICY fretes_update_policy ON fretes
FOR UPDATE
USING (
  embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only frete owner or admin can delete
CREATE POLICY fretes_delete_policy ON fretes
FOR DELETE
USING (
  embarcador_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- FRETE_CLICKS TABLE POLICIES
-- ============================================================================

-- Motoristas can view their own clicks
-- Embarcadores can view clicks on their fretes
-- Admins can view all
CREATE POLICY frete_clicks_select_policy ON frete_clicks
FOR SELECT
USING (
  motorista_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM fretes
    WHERE id = frete_id AND embarcador_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only motoristas can insert clicks (record their own clicks)
CREATE POLICY frete_clicks_insert_policy ON frete_clicks
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM motoristas
    WHERE id = auth.uid()
  ) AND motorista_id = auth.uid()
);

-- No one can update clicks (immutable)
-- Admins can delete clicks if needed
CREATE POLICY frete_clicks_delete_policy ON frete_clicks
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- AVALIACOES TABLE POLICIES
-- ============================================================================

-- Everyone can view ratings (public information)
CREATE POLICY avaliacoes_select_policy ON avaliacoes
FOR SELECT
USING (true);

-- Only motoristas can insert ratings
CREATE POLICY avaliacoes_insert_policy ON avaliacoes
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM motoristas
    WHERE id = auth.uid()
  ) AND motorista_id = auth.uid()
);

-- Motoristas can update their own ratings
-- Admins can update any rating
CREATE POLICY avaliacoes_update_policy ON avaliacoes
FOR UPDATE
USING (
  motorista_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Motoristas can delete their own ratings
-- Admins can delete any rating
CREATE POLICY avaliacoes_delete_policy ON avaliacoes
FOR DELETE
USING (
  motorista_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- CHAT_CONVERSATIONS TABLE POLICIES
-- ============================================================================

-- Users can view their own conversations
-- Admins can view all conversations
CREATE POLICY chat_conversations_select_policy ON chat_conversations
FOR SELECT
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Users can create their own conversation
CREATE POLICY chat_conversations_insert_policy ON chat_conversations
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can update their own conversation
-- Admins can update any conversation
CREATE POLICY chat_conversations_update_policy ON chat_conversations
FOR UPDATE
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only admins can delete conversations
CREATE POLICY chat_conversations_delete_policy ON chat_conversations
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- CHAT_MESSAGES TABLE POLICIES
-- ============================================================================

-- Only conversation participants (user and admins) can view messages
CREATE POLICY chat_messages_select_policy ON chat_messages
FOR SELECT
USING (
  sender_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = conversation_id AND user_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only conversation participants can insert messages
-- Users can only send as themselves (not as admin)
-- Admins can send as admin
CREATE POLICY chat_messages_insert_policy ON chat_messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid() AND (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id = conversation_id AND user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND user_type = 'admin'
    )
  )
);

-- Messages can be updated to mark as read
CREATE POLICY chat_messages_update_policy ON chat_messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = conversation_id AND user_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only admins can delete messages
CREATE POLICY chat_messages_delete_policy ON chat_messages
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- DOCUMENTS TABLE POLICIES
-- ============================================================================

-- Only document owner or admin can view documents
CREATE POLICY documents_select_policy ON documents
FOR SELECT
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only document owner can insert documents
CREATE POLICY documents_insert_policy ON documents
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Only document owner or admin can update documents
CREATE POLICY documents_update_policy ON documents
FOR UPDATE
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only document owner or admin can delete documents
CREATE POLICY documents_delete_policy ON documents
FOR DELETE
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- NOTIFICATIONS TABLE POLICIES
-- ============================================================================

-- Users can only view their own notifications
-- Admins can view all notifications
CREATE POLICY notifications_select_policy ON notifications
FOR SELECT
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only system/admins can create notifications
CREATE POLICY notifications_insert_policy ON notifications
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Users can update their own notifications (mark as read)
-- Admins can update any notification
CREATE POLICY notifications_update_policy ON notifications
FOR UPDATE
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Users can delete their own notifications
-- Admins can delete any notification
CREATE POLICY notifications_delete_policy ON notifications
FOR DELETE
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- ============================================================================
-- AUDIT_LOGS TABLE POLICIES
-- ============================================================================

-- Only admins can view audit logs
CREATE POLICY audit_logs_select_policy ON audit_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- Only system/admins can insert audit logs
CREATE POLICY audit_logs_insert_policy ON audit_logs
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);

-- No one can update audit logs (immutable)
-- Only admins can delete old audit logs
CREATE POLICY audit_logs_delete_policy ON audit_logs
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND user_type = 'admin'
  )
);
