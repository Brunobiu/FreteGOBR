-- 090_motorista_ai_conversations.sql
-- ---------------------------------------------------------------------------
-- Conversas do assistente AI do motorista. Cada motorista pode ter múltiplas
-- conversas com o assistente, cada uma contendo mensagens de role 'user' ou
-- 'assistant'. RLS garante isolamento por motorista_id = auth.uid().
-- ---------------------------------------------------------------------------

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema='public' AND routine_name='is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada';
  END IF;
END
$check$;

-- =========================================================================
-- Tabela: motorista_ai_conversations
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.motorista_ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nova conversa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motorista_ai_conversations_user
  ON public.motorista_ai_conversations(motorista_id, updated_at DESC);

-- =========================================================================
-- Tabela: motorista_ai_messages
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.motorista_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.motorista_ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motorista_ai_messages_conv
  ON public.motorista_ai_messages(conversation_id, created_at ASC);

-- =========================================================================
-- RLS
-- =========================================================================

ALTER TABLE public.motorista_ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motorista_ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motorista_ai_conversations_own ON public.motorista_ai_conversations;
CREATE POLICY motorista_ai_conversations_own ON public.motorista_ai_conversations
  FOR ALL TO authenticated
  USING (motorista_id = auth.uid())
  WITH CHECK (motorista_id = auth.uid());

DROP POLICY IF EXISTS motorista_ai_messages_own ON public.motorista_ai_messages;
CREATE POLICY motorista_ai_messages_own ON public.motorista_ai_messages
  FOR ALL TO authenticated
  USING (conversation_id IN (
    SELECT id FROM public.motorista_ai_conversations WHERE motorista_id = auth.uid()
  ));

COMMIT;
