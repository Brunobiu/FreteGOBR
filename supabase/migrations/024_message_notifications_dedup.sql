-- ============================================================================
-- Migration 024: Deduplicação de notificações de mensagem
-- ============================================================================
-- Idempotente. Substitui a função `notify_new_message` (Migration 023)
-- por uma versão que evita encher o painel de notificações quando duas
-- pessoas trocam várias mensagens em sequência.
--
-- Regra:
--   - Se já existir uma notificação NÃO LIDA do tipo 'new_message' para
--     o destinatário nessa mesma conversa → apenas atualiza o created_at
--     (a notificação antiga "sobe" pro topo, mas não duplica).
--   - Se a última notificação dessa conversa foi LIDA e tem menos de 1
--     hora → não cria nova (cooldown).
--   - Caso contrário → cria nova notificação normalmente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_recipient_id   UUID;
  v_sender_name    TEXT;
  v_link           TEXT;
  v_existing_id    UUID;
  v_existing_read  TIMESTAMPTZ;
  v_existing_created TIMESTAMPTZ;
  v_cooldown       INTERVAL := INTERVAL '1 hour';
BEGIN
  -- Quem é o destinatário?
  SELECT
    CASE WHEN c.motorista_id = NEW.sender_id THEN c.embarcador_id ELSE c.motorista_id END
    INTO v_recipient_id
    FROM conversations c
   WHERE c.id = NEW.conversation_id;

  IF v_recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_link := '/mensagens?conversation=' || NEW.conversation_id::text;

  -- Procura a notificação MAIS RECENTE dessa conversa pra esse destinatário
  SELECT id, read_at, created_at
    INTO v_existing_id, v_existing_read, v_existing_created
    FROM notifications
   WHERE user_id = v_recipient_id
     AND type    = 'new_message'
     AND link    = v_link
   ORDER BY created_at DESC
   LIMIT 1;

  -- Caso 1: existe e não foi lida → atualiza o created_at, mantém uma só.
  IF v_existing_id IS NOT NULL AND v_existing_read IS NULL THEN
    UPDATE notifications
       SET created_at = NOW()
     WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  -- Caso 2: existe, foi lida, mas dentro do cooldown → silencia.
  IF v_existing_id IS NOT NULL
     AND v_existing_read IS NOT NULL
     AND (NOW() - v_existing_created) < v_cooldown THEN
    RETURN NEW;
  END IF;

  -- Caso 3: nunca notificou OU passou do cooldown → cria nova.
  SELECT name INTO v_sender_name FROM users WHERE id = NEW.sender_id;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (
    v_recipient_id,
    'new_message',
    'Nova mensagem',
    coalesce(v_sender_name, 'Alguém') || ' enviou uma mensagem',
    v_link
  );

  RETURN NEW;
END;
$fn$;

COMMIT;

-- ============================================================================
-- LIMPEZA OPCIONAL: deduplica notificações antigas do tipo 'new_message'
-- ============================================================================
-- Roda 1x: pra cada (user_id, link), mantém só a notificação mais recente
-- do tipo 'new_message' e apaga as outras. Comente o bloco abaixo se quiser
-- preservar o histórico atual.

DELETE FROM notifications n
 WHERE n.type = 'new_message'
   AND n.id NOT IN (
     SELECT DISTINCT ON (user_id, link) id
       FROM notifications
      WHERE type = 'new_message'
      ORDER BY user_id, link, created_at DESC
   );
