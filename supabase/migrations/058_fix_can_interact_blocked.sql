-- =====================================================
-- Migration 058: fix motorista_can_interact (status 'blocked')
--
-- Correção de bug encontrado em teste na Fase 2: um motorista com
-- subscription_status='blocked' (suspenso por assinatura) ainda retornava
-- can_interact=true quando o trial_ends_at estava no futuro (caía no ramo de
-- trial). Agora 'blocked' e 'canceled' negam interação independentemente do
-- trial.
--
-- Nota: este fix também já está incorporado ao final da 057 (idempotente via
-- CREATE OR REPLACE). Mantido como migration própria para refletir a ordem
-- real de aplicação no banco.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION motorista_can_interact(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_user_type text; v_status text; v_subscribed boolean; v_trial_ends timestamptz; v_grace_ends timestamptz;
BEGIN
  SELECT u.user_type, u.subscription_status, u.is_subscribed, u.trial_ends_at
    INTO v_user_type, v_status, v_subscribed, v_trial_ends
    FROM users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_user_type <> 'motorista' THEN RETURN true; END IF;
  IF v_status IN ('canceled','blocked') THEN RETURN false; END IF;
  IF v_status = 'active' OR v_subscribed THEN RETURN true; END IF;
  IF v_status = 'past_due' THEN
    SELECT s.grace_ends_at INTO v_grace_ends FROM subscriptions s WHERE s.user_id = p_user_id;
    RETURN (v_grace_ends IS NULL OR v_grace_ends >= NOW());
  END IF;
  RETURN (v_trial_ends IS NOT NULL AND v_trial_ends > NOW());
END;
$func$;
REVOKE ALL ON FUNCTION motorista_can_interact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION motorista_can_interact(uuid) TO authenticated;

COMMIT;
