-- =====================================================
-- Migration 057: RPCs de transição de estado de assinatura
--
-- Spec: .kiro/specs/assinaturas-pagamento (Fase 2 do tasks.md)
--
-- Entrega as RPCs que materializam a máquina de estados de assinatura:
--   Transição (chamadas pela Edge webhook via service-role):
--     - subscription_mark_paid       — confirma pagamento -> active (+ avança ciclo)
--     - subscription_mark_past_due   — falha/vencimento -> past_due (+ grace 5d)
--     - subscription_suspend         — grace esgotado -> suspended
--     - subscription_reactivate      — pagamento de suspenso -> active
--   Motorista:
--     - list_my_charges()            — histórico do próprio (STABLE)
--     - cancel_my_subscription()     — cancela a própria (idempotente)
--
-- Sincronização: subscriptions.status (detalhe, inclui 'suspended') e
-- users.subscription_status/is_subscribed (fonte de verdade do app):
--   active    -> users.subscription_status='active',  is_subscribed=true
--   past_due  -> users.subscription_status='past_due', is_subscribed=false
--   suspended -> users.subscription_status='blocked',  is_subscribed=false
--   canceled  -> users.subscription_status='canceled', is_subscribed=false
--
-- Duração do ciclo por plano: mensal=1, trimestral=3, semestral=6 meses.
--
-- Idempotente. Par: 057_subscription_rpcs_rollback.sql.
-- =====================================================

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='subscriptions') THEN
    RAISE EXCEPTION 'Tabela subscriptions ausente -- aplique a 055 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='subscription_charges') THEN
    RAISE EXCEPTION 'Tabela subscription_charges ausente -- aplique a 055 antes.';
  END IF;
END
$check$;

-- ========== Helper interno: meses de duração por plano ==========
CREATE OR REPLACE FUNCTION subscription_plan_months(p_plan text)
RETURNS int
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $func$
  SELECT CASE p_plan
           WHEN 'mensal' THEN 1
           WHEN 'trimestral' THEN 3
           WHEN 'semestral' THEN 6
           ELSE 1
         END;
$func$;
REVOKE ALL ON FUNCTION subscription_plan_months(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_plan_months(text) TO authenticated;

-- ========== 1. subscription_mark_paid ==========
-- Confirma uma cobrança paga: marca a charge (se informada) como paid,
-- coloca a assinatura em 'active', limpa grace, avança next_charge_at por
-- mais um ciclo do plano vigente. SECURITY DEFINER: chamada pelo webhook
-- (service-role) — o gating é a posse do service-role, não auth.uid().
CREATE OR REPLACE FUNCTION subscription_mark_paid(
  p_user_id          uuid,
  p_asaas_payment_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_sub    subscriptions%ROWTYPE;
  v_months int;
  v_base   timestamptz;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE = 'P0001';
  END IF;

  v_months := subscription_plan_months(v_sub.plan);
  -- Base para o próximo vencimento: o maior entre next_charge_at e agora,
  -- para não "perder" tempo quando a renovação chega no dia certo.
  v_base := GREATEST(COALESCE(v_sub.next_charge_at, NOW()), NOW());

  UPDATE subscriptions
     SET status = 'active',
         past_due_since = NULL,
         grace_ends_at = NULL,
         next_charge_at = v_base + (v_months || ' months')::interval,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  UPDATE users
     SET subscription_status = 'active', is_subscribed = true, updated_at = NOW()
   WHERE id = p_user_id;

  -- Marca a charge correspondente como paga (se o pagamento foi informado).
  IF p_asaas_payment_id IS NOT NULL THEN
    UPDATE subscription_charges
       SET status = 'paid', paid_at = NOW()
     WHERE asaas_payment_id = p_asaas_payment_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'active');
END;
$func$;
REVOKE ALL ON FUNCTION subscription_mark_paid(uuid, text) FROM PUBLIC;

-- ========== 2. subscription_mark_past_due ==========
-- Falha/vencimento de cobrança: past_due + início do grace de 5 dias.
CREATE OR REPLACE FUNCTION subscription_mark_past_due(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_sub subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotente: se já está em past_due, preserva o grace original.
  IF v_sub.status = 'past_due' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'past_due', 'skipped', true);
  END IF;

  UPDATE subscriptions
     SET status = 'past_due',
         past_due_since = NOW(),
         grace_ends_at = NOW() + INTERVAL '5 days',
         updated_at = NOW()
   WHERE user_id = p_user_id;

  UPDATE users
     SET subscription_status = 'past_due', is_subscribed = false, updated_at = NOW()
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'status', 'past_due');
END;
$func$;
REVOKE ALL ON FUNCTION subscription_mark_past_due(uuid) FROM PUBLIC;

-- ========== 3. subscription_suspend ==========
-- Grace esgotado sem pagamento: suspended. Mapeia users -> 'blocked'.
CREATE OR REPLACE FUNCTION subscription_suspend(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_sub subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status = 'suspended' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'suspended', 'skipped', true);
  END IF;

  UPDATE subscriptions
     SET status = 'suspended', updated_at = NOW()
   WHERE user_id = p_user_id;

  UPDATE users
     SET subscription_status = 'blocked', is_subscribed = false, updated_at = NOW()
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'status', 'suspended');
END;
$func$;
REVOKE ALL ON FUNCTION subscription_suspend(uuid) FROM PUBLIC;

-- ========== 4. subscription_reactivate ==========
-- Pagamento de um suspenso/past_due: volta a active e avança um ciclo.
-- Reusa a lógica de mark_paid (mesmo efeito de estado).
CREATE OR REPLACE FUNCTION subscription_reactivate(
  p_user_id          uuid,
  p_asaas_payment_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  RETURN subscription_mark_paid(p_user_id, p_asaas_payment_id);
END;
$func$;
REVOKE ALL ON FUNCTION subscription_reactivate(uuid, text) FROM PUBLIC;

-- ========== 5. list_my_charges (motorista) ==========
-- Histórico de cobranças do próprio usuário. RLS já isola, mas filtramos
-- por auth.uid() defensivamente. STABLE.
CREATE OR REPLACE FUNCTION list_my_charges()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_rows   jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'amount', c.amount,
           'payment_method', c.payment_method,
           'status', c.status,
           'period_start', c.period_start,
           'period_end', c.period_end,
           'paid_at', c.paid_at,
           'created_at', c.created_at
         ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM subscription_charges c
   WHERE c.user_id = v_caller;

  RETURN jsonb_build_object('charges', v_rows);
END;
$func$;
REVOKE ALL ON FUNCTION list_my_charges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_my_charges() TO authenticated;

-- ========== 6. cancel_my_subscription (motorista, idempotente) ==========
-- Cancela a assinatura do próprio usuário. Idempotente: se já cancelada,
-- retorna skipped sem efeito. A baixa da recorrência no Asaas é feita pela
-- camada de service (Edge) — aqui apenas o estado local.
CREATE OR REPLACE FUNCTION cancel_my_subscription()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_sub    subscriptions%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sub FROM subscriptions WHERE user_id = v_caller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: subscription' USING ERRCODE = 'P0001';
  END IF;

  IF v_sub.status = 'canceled' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'canceled', 'skipped', true);
  END IF;

  UPDATE subscriptions
     SET status = 'canceled', canceled_at = NOW(),
         next_charge_at = NULL, updated_at = NOW()
   WHERE user_id = v_caller;

  UPDATE users
     SET subscription_status = 'canceled', is_subscribed = false, updated_at = NOW()
   WHERE id = v_caller;

  RETURN jsonb_build_object('ok', true, 'status', 'canceled');
END;
$func$;
REVOKE ALL ON FUNCTION cancel_my_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_my_subscription() TO authenticated;

-- ========== 7. Fix de motorista_can_interact (incorporado da 058) ==========
-- subscription_status='blocked' (suspenso por assinatura) deve negar interação
-- mesmo com trial_ends_at futuro. Antes caía no ramo de trial e liberava.
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
