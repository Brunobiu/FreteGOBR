-- =====================================================
-- Migration 059: Billing_Notifier (pg_cron diário)
--
-- Spec: .kiro/specs/assinaturas-pagamento (Fase 4 do tasks.md, task 12)
--
-- Entrega:
--   - run_billing_notifications(): função SQL única, agendada 1x/dia, que
--       (a) avisa motoristas com trial vencendo em 1-2 dias (is_subscribed=false)
--           inserindo notifications(type='plan_trial_expiring') de forma
--           idempotente via uq_notifications_user_plan_unread (ON CONFLICT
--           DO NOTHING) — no máx. 1 aviso não-lido por (user, type);
--       (b) reconcilia suspensão: assinaturas 'past_due' com grace esgotado
--           (grace_ends_at < now) são suspensas via subscription_suspend()
--           (espelha users.subscription_status='blocked'). A autoridade de
--           acesso já trata grace esgotado em tempo de leitura
--           (motorista_can_interact); esta etapa apenas materializa o estado.
--   - Agendamento pg_cron 'billing_notifier_job' (defensivo: só agenda quando
--       pg_cron existe; ambientes de teste sem a extensão apenas emitem WARNING).
--
-- Notas:
--   - As notificações de falha/cobrança/reativação (plan_payment_failed,
--     plan_charged, plan_reactivated) são disparadas pelo webhook, NÃO aqui.
--   - O push é disparado pelo trigger trg_notifications_dispatch_push (042)
--     em cada INSERT em notifications — sem trabalho extra.
--   - Falha do Billing_Notifier NÃO bloqueia mutações de assinatura
--     (governança): a função é resiliente e idempotente.
--
-- Idempotente. Par: 059_billing_notifier_rollback.sql (documentação).
-- =====================================================

BEGIN;

-- ───────────────────────────── Validações defensivas ─────────────────────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='notifications') THEN
    RAISE EXCEPTION 'Tabela notifications ausente -- aplique a 041 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='subscriptions') THEN
    RAISE EXCEPTION 'Tabela subscriptions ausente -- aplique a 055 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='subscription_suspend') THEN
    RAISE EXCEPTION 'Função subscription_suspend ausente -- aplique a 057 antes.';
  END IF;
END
$check$;

-- Garantia do índice único parcial de dedup (criado na 041; recria se faltar).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_plan_unread
  ON notifications (user_id, type)
  WHERE read_at IS NULL AND type LIKE 'plan_%';

-- ───────────────────────────── run_billing_notifications ─────────────────────
-- SECURITY DEFINER: roda no contexto do owner (chamada pelo cron, sem auth.uid()).
-- Retorna um resumo jsonb com as contagens (útil para smoke test / logs).
CREATE OR REPLACE FUNCTION run_billing_notifications()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_trial_notified int := 0;
  v_suspended      int := 0;
BEGIN
  -- (a) Trial vencendo em 1-2 dias: avisa SOMENTE os afetados (anti-disparo-em-massa).
  --     ON CONFLICT no índice parcial garante idempotência (1 não-lida por user+type).
  WITH alvo AS (
    INSERT INTO notifications (user_id, type, title, message, link)
    SELECT u.id,
           'plan_trial_expiring',
           'Seu período grátis está acabando',
           'Seu teste grátis do FreteGO termina em breve. Assine um plano para continuar interagindo com os fretes.',
           '/motorista/plano'
      FROM users u
     WHERE u.user_type = 'motorista'
       AND u.is_subscribed = false
       AND u.subscription_status = 'trial'
       AND u.trial_ends_at IS NOT NULL
       AND u.trial_ends_at >= NOW() + INTERVAL '1 day'
       AND u.trial_ends_at <= NOW() + INTERVAL '2 days'
    ON CONFLICT (user_id, type) WHERE read_at IS NULL AND type LIKE 'plan_%'
    DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_trial_notified FROM alvo;

  -- (b) Reconciliação de suspensão: past_due com grace esgotado -> suspended.
  --     subscription_suspend é idempotente (já-suspenso retorna skipped).
  SELECT COUNT(*)::int INTO v_suspended FROM (
    SELECT subscription_suspend(s.user_id)
      FROM subscriptions s
     WHERE s.status = 'past_due'
       AND s.grace_ends_at IS NOT NULL
       AND s.grace_ends_at < NOW()
  ) q;

  RETURN jsonb_build_object(
    'ok', true,
    'trial_notified', v_trial_notified,
    'suspended', v_suspended,
    'ran_at', NOW()
  );
END;
$func$;

REVOKE ALL ON FUNCTION run_billing_notifications() FROM PUBLIC;
-- No Supabase, anon/authenticated recebem grants default no schema public:
-- revogamos explicitamente para que a função (que MUTA estado) não seja
-- chamável via REST. Só o owner/cron a executa.
REVOKE ALL ON FUNCTION run_billing_notifications() FROM anon, authenticated;

COMMENT ON FUNCTION run_billing_notifications() IS
  'Billing_Notifier diário (spec assinaturas-pagamento): avisa trial vencendo em 1-2 dias (idempotente via uq_notifications_user_plan_unread) e suspende past_due com grace esgotado. Chamada pelo pg_cron billing_notifier_job.';

-- ───────────────────────────── Agendamento pg_cron ───────────────────────────
-- Guarda defensiva: pg_cron pode não existir (shadow DB de testes). Só agenda
-- quando a extensão está presente; caso contrário emite WARNING e segue.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron ausente: billing_notifier_job NAO agendado (habilite pg_cron e reaplique este bloco).';
    RETURN;
  END IF;

  -- Idempotente: desagenda job homônimo antes de reagendar.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing_notifier_job') THEN
    PERFORM cron.unschedule('billing_notifier_job');
  END IF;

  -- Diário às 12:00 UTC (~09:00 BRT). Corpo apenas chama a função SQL local.
  PERFORM cron.schedule(
    'billing_notifier_job',
    '0 12 * * *',
    $job$ SELECT public.run_billing_notifications(); $job$
  );
END
$cron$;

COMMIT;

-- =====================================================
-- VERIFY (smoke test manual — descomente para rodar):
-- =====================================================
/*
-- Função existe?
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='run_billing_notifications';

-- Índice de dedup existe?
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND indexname='uq_notifications_user_plan_unread';

-- Job agendado? (quando pg_cron presente)
SELECT jobname, schedule FROM cron.job WHERE jobname='billing_notifier_job';

-- Execução manual (retorna resumo das contagens):
SELECT public.run_billing_notifications();
*/
