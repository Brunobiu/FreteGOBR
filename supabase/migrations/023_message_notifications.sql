-- ============================================================================
-- Migration 023: Notificação automática ao receber mensagem nova
-- ============================================================================
-- Idempotente. Cria trigger que insere uma notificação para o destinatário
-- toda vez que uma mensagem é inserida em `messages`. A notificação aparece
-- no sino, no toast realtime e na página /notificacoes — mesmo padrão das
-- curtidas (frete_like).
--
-- Garante também que `messages` está na publicação `supabase_realtime`
-- pra o canal de pg_changes funcionar (ChatWidget já assina por
-- conversation_id, mas o widget global precisa escutar mudanças globais).
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Função do trigger
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_recipient_id UUID;
  v_sender_name  TEXT;
  v_frete_id     UUID;
BEGIN
  -- Descobre quem é o destinatário (o outro lado da conversa)
  SELECT
    CASE WHEN c.motorista_id = NEW.sender_id THEN c.embarcador_id ELSE c.motorista_id END,
    c.frete_id
    INTO v_recipient_id, v_frete_id
    FROM conversations c
   WHERE c.id = NEW.conversation_id;

  IF v_recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Nome de quem enviou (pra exibir na notificação)
  SELECT name INTO v_sender_name FROM users WHERE id = NEW.sender_id;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (
    v_recipient_id,
    'new_message',
    'Nova mensagem',
    coalesce(v_sender_name, 'Alguém') || ' enviou uma mensagem',
    '/mensagens?conversation=' || NEW.conversation_id::text
  );

  RETURN NEW;
END;
$fn$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trigger
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_notify_new_message ON messages;
CREATE TRIGGER trg_notify_new_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_message();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Realtime: garante messages na publicação
-- ────────────────────────────────────────────────────────────────────────────

DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$pub$;

COMMIT;
