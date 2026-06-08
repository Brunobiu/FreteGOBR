-- =====================================================
-- Migration 055: assinaturas-asaas (Fase 1 + predicado de interação)
--
-- Spec: .kiro/specs/assinaturas-pagamento/{requirements,design,tasks}.md
--
-- Entrega:
--   1. Colunas de trial/assinatura em users (auto-suficiente: a 044 NÃO está
--      aplicada neste banco — esta migration cria as colunas se faltarem).
--   2. Trigger users_set_trial_defaults (motorista novo ganha trial de 30 dias).
--      BACKFILL CONSERVADOR: motoristas existentes recebem trial = NOW()+30d
--      (e não created_at+30d) para NÃO suspender a base ativa de imediato.
--   3. Tabelas subscriptions, subscription_charges, asaas_webhook_events
--      (com RLS: motorista lê só o próprio; mutação só via SECURITY DEFINER /
--      service-role).
--   4. Tabelas companies / company_embarcadores RESERVADAS (futuro, fora de
--      escopo desta spec — sem lógica/RLS de negócio).
--   5. Predicado motorista_can_interact(uuid) (espelho de canInteract TS).
--   6. Guard de interação em toggle_frete_like (motorista suspenso => bloqueado).
--
-- A fretes_select_policy NÃO é alterada: neste banco ela já mostra o feed
-- 'ativo' a todos (pré-044), exatamente o comportamento desejado para o
-- motorista suspenso ("vê o feed, mas não interage").
--
-- Idempotente: pode ser reaplicada. Par: 055_assinaturas_asaas_rollback.sql.
-- =====================================================

BEGIN;

-- ========== 0. Pré-checks defensivos ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela users ausente -- schema inesperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='fretes') THEN
    RAISE EXCEPTION 'Tabela fretes ausente -- schema inesperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='notifications') THEN
    RAISE EXCEPTION 'Tabela notifications ausente (migration 001).';
  END IF;
END
$check$;

-- ========== 1. Colunas de trial/assinatura em users (auto-suficiente) ==========
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_ends_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS subscription_status  TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS is_subscribed        BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_subscription_status;
ALTER TABLE users ADD  CONSTRAINT chk_users_subscription_status
  CHECK (subscription_status IN ('trial','active','past_due','canceled','blocked'));

CREATE INDEX IF NOT EXISTS idx_users_trial_motoristas
  ON users (trial_ends_at) WHERE user_type = 'motorista';

COMMENT ON COLUMN users.trial_ends_at       IS 'Fim do trial de 30 dias do motorista. NULL p/ embarcador/admin.';
COMMENT ON COLUMN users.subscription_status IS 'Rotulo de estado (trial|active|past_due|canceled|blocked). Fonte de verdade do acesso junto com is_subscribed/trial_ends_at.';
COMMENT ON COLUMN users.is_subscribed       IS 'Assinatura paga ativa (setada pelo webhook Asaas apos confirmacao).';

-- ========== 2. Trigger de concessao de trial + backfill conservador ==========
CREATE OR REPLACE FUNCTION users_set_trial_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF NEW.user_type = 'motorista' AND NEW.trial_ends_at IS NULL THEN
    NEW.trial_ends_at := COALESCE(NEW.created_at, NOW()) + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_set_trial_defaults ON users;
CREATE TRIGGER users_set_trial_defaults
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_set_trial_defaults();

-- Backfill CONSERVADOR: base existente ganha 30 dias a partir de AGORA, para
-- nao suspender ninguem no lancamento. So afeta motoristas ainda sem trial.
UPDATE users
   SET trial_ends_at = NOW() + INTERVAL '30 days'
 WHERE user_type = 'motorista'
   AND trial_ends_at IS NULL;

-- ========== 3. Tabela subscriptions ==========
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan                  text NOT NULL CHECK (plan IN ('mensal','trimestral','semestral')),
  payment_method        text NOT NULL CHECK (payment_method IN ('credit_card','pix','boleto')),
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','past_due','suspended','canceled')),
  auto_recurring        boolean NOT NULL DEFAULT false,
  started_at            timestamptz NOT NULL DEFAULT NOW(),
  next_charge_at        timestamptz NULL,
  past_due_since        timestamptz NULL,
  grace_ends_at         timestamptz NULL,
  canceled_at           timestamptz NULL,
  asaas_customer_id     text NULL,
  asaas_subscription_id text NULL,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_next_charge
  ON subscriptions (next_charge_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_grace
  ON subscriptions (grace_ends_at) WHERE status = 'past_due';
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_select_own ON subscriptions;
CREATE POLICY subscriptions_select_own
  ON subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Mutacao direta bloqueada: apenas RPC SECURITY DEFINER / service-role.
DROP POLICY IF EXISTS subscriptions_no_dml ON subscriptions;
CREATE POLICY subscriptions_no_dml
  ON subscriptions FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE subscriptions IS 'Assinatura corrente do motorista (1:1). Mutacao so via RPC/webhook. assinaturas-pagamento 055.';

-- ========== 4. Tabela subscription_charges ==========
CREATE TABLE IF NOT EXISTS subscription_charges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           numeric(10,2) NOT NULL CHECK (amount >= 0),
  payment_method   text NOT NULL CHECK (payment_method IN ('credit_card','pix','boleto')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','failed','refunded')),
  period_start     timestamptz NULL,
  period_end       timestamptz NULL,
  asaas_payment_id text NULL UNIQUE,
  paid_at          timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_charges_user
  ON subscription_charges (user_id, created_at DESC);

ALTER TABLE subscription_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS charges_select_own ON subscription_charges;
CREATE POLICY charges_select_own
  ON subscription_charges FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS charges_no_dml ON subscription_charges;
CREATE POLICY charges_no_dml
  ON subscription_charges FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE subscription_charges IS 'Historico de cobrancas da assinatura. Motorista le so as proprias. assinaturas-pagamento 055.';

-- ========== 5. Tabela asaas_webhook_events (idempotencia) ==========
CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asaas_event_id text NOT NULL UNIQUE,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE asaas_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sem policy publica: acesso so via service-role (webhook). RLS habilitada bloqueia o resto.

COMMENT ON TABLE asaas_webhook_events IS 'Idempotencia de webhook Asaas (asaas_event_id UNIQUE). Acesso so service-role. assinaturas-pagamento 055.';

-- ========== 6. Estrutura FUTURA de Empresa (RESERVADA, fora de escopo) ==========
-- Sem cobranca/regra/RLS de negocio nesta spec (Requirement 14). Apenas reserva
-- o schema para evolucao futura.
CREATE TABLE IF NOT EXISTS companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS company_embarcadores (
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  embarcador_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, embarcador_id)
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_embarcadores ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE companies IS 'FUTURO/fora de escopo (assinaturas-pagamento Req 14): conta empresa. Sem cobranca/regra nesta spec.';
COMMENT ON TABLE company_embarcadores IS 'FUTURO/fora de escopo: vinculo empresa<->embarcador. Sem logica nesta spec.';

-- ========== 7. Predicado motorista_can_interact (espelho de canInteract TS) ==========
-- true quando o motorista PODE interagir (curtir/contato/chat):
--   - nao-motorista (embarcador/admin) => true;
--   - assinante (is_subscribed) ou subscription_status='active' => true;
--   - past_due dentro do grace (grace_ends_at NULL ou >= now) => true;
--   - trial/blocked com trial_ends_at > now => true;
--   - caso contrario (suspenso/cancelado/trial vencido sem pagar) => false.
CREATE OR REPLACE FUNCTION motorista_can_interact(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_user_type text;
  v_status    text;
  v_subscribed boolean;
  v_trial_ends timestamptz;
  v_grace_ends timestamptz;
BEGIN
  SELECT u.user_type, u.subscription_status, u.is_subscribed, u.trial_ends_at
    INTO v_user_type, v_status, v_subscribed, v_trial_ends
    FROM users u WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Embarcador/Admin: sem cobranca nesta spec.
  IF v_user_type <> 'motorista' THEN
    RETURN true;
  END IF;

  IF v_status = 'canceled' THEN
    RETURN false;
  END IF;

  IF v_status = 'active' OR v_subscribed THEN
    RETURN true;
  END IF;

  IF v_status = 'past_due' THEN
    SELECT s.grace_ends_at INTO v_grace_ends
      FROM subscriptions s WHERE s.user_id = p_user_id;
    -- dentro do grace (ou sem grace definido) => pode interagir
    RETURN (v_grace_ends IS NULL OR v_grace_ends >= NOW());
  END IF;

  -- trial / blocked: depende do trial ainda valido
  RETURN (v_trial_ends IS NOT NULL AND v_trial_ends > NOW());
END;
$func$;

COMMENT ON FUNCTION motorista_can_interact(uuid) IS 'Espelho SQL de canInteract (TS). true sse o motorista pode interagir (curtir/contato/chat). assinaturas-pagamento 055.';

REVOKE ALL ON FUNCTION motorista_can_interact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION motorista_can_interact(uuid) TO authenticated;

-- ========== 8. Guard de interacao em toggle_frete_like ==========
-- Reaplica a funcao PRESERVANDO toda a logica original e apenas PRE-pendendo o
-- guard: motorista suspenso (NOT motorista_can_interact) => permission_denied.
CREATE OR REPLACE FUNCTION toggle_frete_like(p_frete_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_motorista_id   UUID := auth.uid();
  v_motorista_name TEXT;
  v_embarcador_id  UUID;
  v_frete_origin   TEXT;
  v_frete_dest     TEXT;
  v_existing_id    UUID;
  v_total          INT;
BEGIN
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Guard de assinatura (assinaturas-pagamento Req 6.4/6.5): motorista
  -- suspenso ve o feed mas NAO interage. Precedencia de permission_denied.
  IF NOT motorista_can_interact(v_motorista_id) THEN
    RAISE EXCEPTION 'permission_denied: subscription suspended' USING ERRCODE = '42501';
  END IF;

  SELECT embarcador_id, origin, destination
    INTO v_embarcador_id, v_frete_origin, v_frete_dest
    FROM fretes
   WHERE id = p_frete_id;

  IF v_embarcador_id IS NULL THEN
    RAISE EXCEPTION 'frete not found';
  END IF;

  SELECT id INTO v_existing_id
    FROM frete_likes
   WHERE frete_id    = p_frete_id
     AND motorista_id = v_motorista_id;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM frete_likes WHERE id = v_existing_id;
    DELETE FROM notifications
     WHERE user_id = v_embarcador_id
       AND type    = 'frete_like'
       AND link    = '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text;
    SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
    RETURN jsonb_build_object('liked', false, 'total', v_total);
  END IF;

  INSERT INTO frete_likes (frete_id, motorista_id) VALUES (p_frete_id, v_motorista_id);

  SELECT name INTO v_motorista_name FROM users WHERE id = v_motorista_id;

  INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (
      v_embarcador_id,
      'frete_like',
      'Motorista interessado',
      coalesce(v_motorista_name, 'Um motorista')
        || ' curtiu o seu frete ' || v_frete_origin || ' → ' || v_frete_dest,
      '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text
    );

  SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
  RETURN jsonb_build_object('liked', true, 'total', v_total);
END;
$fn$;

GRANT EXECUTE ON FUNCTION toggle_frete_like(UUID) TO authenticated;

COMMIT;

/*
-- VERIFY (smoke pos-apply):
SELECT column_name FROM information_schema.columns
 WHERE table_name='users' AND column_name IN ('trial_ends_at','subscription_status','is_subscribed');
SELECT to_regclass('public.subscriptions'), to_regclass('public.subscription_charges'),
       to_regclass('public.asaas_webhook_events'), to_regclass('public.companies');
SELECT proname FROM pg_proc WHERE proname='motorista_can_interact';
SELECT COUNT(*) AS motoristas_sem_trial FROM users WHERE user_type='motorista' AND trial_ends_at IS NULL;
*/
