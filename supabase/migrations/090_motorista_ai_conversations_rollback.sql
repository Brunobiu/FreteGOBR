-- 090_motorista_ai_conversations_rollback.sql
-- Reverte 090. Documentacao, nao auto-aplicada.

BEGIN;

DROP POLICY IF EXISTS motorista_ai_messages_own ON public.motorista_ai_messages;
DROP POLICY IF EXISTS motorista_ai_conversations_own ON public.motorista_ai_conversations;

DROP TABLE IF EXISTS public.motorista_ai_messages;
DROP TABLE IF EXISTS public.motorista_ai_conversations;

COMMIT;
