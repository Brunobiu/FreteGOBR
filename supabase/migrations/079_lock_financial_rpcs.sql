-- =====================================================
-- Migration 079: tranca as RPCs financeiras de transição (R8 — crítico)
--
-- Problema: subscription_mark_paid / _mark_past_due / _suspend / _reactivate são
-- SECURITY DEFINER, recebem p_user_id arbitrário e NÃO checam quem chama. O
-- EXECUTE estava concedido a anon/authenticated (default privilege do Supabase
-- re-concedeu, apesar do REVOKE FROM PUBLIC da 057). Resultado:
--   - qualquer usuário logado: subscription_mark_paid('<meu_id>') => assinatura
--     paga de graça;
--   - subscription_suspend('<id_de_outro>') => sabota a conta de terceiros.
--
-- Chamadores legítimos: webhook Asaas (service_role) e cron
-- run_billing_notifications (definer, owner postgres). NENHUM frontend chama.
--
-- Correção: REVOKE EXECUTE de anon/authenticated/PUBLIC + defesa em profundidade
-- (bloqueia execução quando current_user é o cliente PostgREST).
-- =====================================================

BEGIN;

-- 1) Defesa em profundidade: aborta se chamado diretamente pelo cliente.
--    (service_role e postgres não entram nesse IF, então webhook/cron passam.)
DO $$
DECLARE
  v_fn text;
  v_guard text := $g$
    IF current_user IN ('authenticated','anon') THEN
      RAISE EXCEPTION 'permission_denied: RPC restrita a integracao de pagamento'
        USING ERRCODE = '42501';
    END IF;
  $g$;
BEGIN
  -- (As funções são recriadas abaixo já com o guard; este bloco é só doc.)
  NULL;
END $$;

-- Recria cada função adicionando o guard no topo (corpo idêntico ao 057).
CREATE OR REPLACE FUNCTION subscription_mark_paid(
  p_user_id uuid, p_asaas_payment_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_sub subscriptions%ROWTYPE; v_months int; v_base timestamptz;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'permission_denied: RPC restrita a integracao de pagamento' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE='P0001'; END IF;
  v_months := subscription_plan_months(v_sub.plan);
  v_base := GREATEST(COALESCE(v_sub.next_charge_at, NOW()), NOW());
  UPDATE subscriptions SET status='active', past_due_since=NULL, grace_ends_at=NULL,
         next_charge_at = v_base + (v_months || ' months')::interval, updated_at=NOW()
   WHERE user_id = p_user_id;
  UPDATE users SET subscription_status='active', is_subscribed=true, updated_at=NOW() WHERE id = p_user_id;
  IF p_asaas_payment_id IS NOT NULL THEN
    UPDATE subscription_charges SET status='paid', paid_at=NOW() WHERE asaas_payment_id = p_asaas_payment_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 'active');
END;
$func$;

CREATE OR REPLACE FUNCTION subscription_mark_past_due(
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_sub subscriptions%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'permission_denied: RPC restrita a integracao de pagamento' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE='P0001'; END IF;
  IF v_sub.status = 'past_due' THEN RETURN jsonb_build_object('ok', true, 'status', 'past_due', 'skipped', true); END IF;
  UPDATE subscriptions SET status='past_due', past_due_since=NOW(), grace_ends_at=NOW()+INTERVAL '5 days', updated_at=NOW() WHERE user_id = p_user_id;
  UPDATE users SET subscription_status='past_due', is_subscribed=false, updated_at=NOW() WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'status', 'past_due');
END;
$func$;

CREATE OR REPLACE FUNCTION subscription_suspend(
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_sub subscriptions%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'permission_denied: RPC restrita a integracao de pagamento' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE='P0001'; END IF;
  IF v_sub.status = 'suspended' THEN RETURN jsonb_build_object('ok', true, 'status', 'suspended', 'skipped', true); END IF;
  UPDATE subscriptions SET status='suspended', updated_at=NOW() WHERE user_id = p_user_id;
  UPDATE users SET subscription_status='blocked', is_subscribed=false, updated_at=NOW() WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'status', 'suspended');
END;
$func$;

CREATE OR REPLACE FUNCTION subscription_reactivate(
  p_user_id uuid, p_asaas_payment_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'permission_denied: RPC restrita a integracao de pagamento' USING ERRCODE='42501';
  END IF;
  RETURN subscription_mark_paid(p_user_id, p_asaas_payment_id);
END;
$func$;

-- 2) Revoga EXECUTE do cliente (default privilege re-concedeu; revogamos
--    explicitamente de authenticated/anon e PUBLIC). service_role e postgres
--    mantêm (webhook + cron).
REVOKE EXECUTE ON FUNCTION subscription_mark_paid(uuid, text)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION subscription_mark_past_due(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION subscription_suspend(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION subscription_reactivate(uuid, text)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION subscription_mark_paid(uuid, text)       TO service_role;
GRANT EXECUTE ON FUNCTION subscription_mark_past_due(uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION subscription_suspend(uuid)               TO service_role;
GRANT EXECUTE ON FUNCTION subscription_reactivate(uuid, text)      TO service_role;

COMMIT;

-- VERIFY
/*
SELECT proname, (SELECT string_agg(acl.grantee::regrole::text, ', ')
  FROM aclexplode(p.proacl) acl WHERE acl.privilege_type='EXECUTE') AS grantees
FROM pg_proc p WHERE proname LIKE 'subscription_%';
*/
