-- Migration 008: Chat System
-- Sistema de chat entre motoristas e embarcadores

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id UUID REFERENCES fretes(id) ON DELETE SET NULL,
  motorista_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  embarcador_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(frete_id, motorista_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_motorista ON conversations(motorista_id);
CREATE INDEX IF NOT EXISTS idx_conversations_embarcador ON conversations(embarcador_id);

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Participantes podem ver suas conversas
CREATE POLICY "Participants can view conversations" ON conversations
  FOR SELECT USING (
    auth.uid() = motorista_id OR auth.uid() = embarcador_id OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
  );

CREATE POLICY "Participants can insert conversations" ON conversations
  FOR INSERT WITH CHECK (
    auth.uid() = motorista_id OR auth.uid() = embarcador_id
  );

CREATE POLICY "Participants can view messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
      AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'admin')
  );

CREATE POLICY "Participants can send messages" ON messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
      AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
    )
  );

CREATE POLICY "Participants can update messages (mark read)" ON messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
      AND (c.motorista_id = auth.uid() OR c.embarcador_id = auth.uid())
    )
  );
