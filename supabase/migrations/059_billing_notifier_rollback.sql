-- =====================================================
-- Rollback da Migration 059: Billing_Notifier
--
-- Documentação (NÃO auto-aplicado). Reverte, em ordem segura:
--   1. Desagenda o pg_cron 'billing_notifier_job' (se presente).
--   2. Dropa a função run_billing_notifications().
--
-- NÃO dropa o índice uq_notifications_user_plan_unread (pertence à 041) nem
-- as notificações já criadas. As suspensões já materializadas em
-- users/subscriptions também NÃO são revertidas (são estado de negócio legítimo).
-- =====================================================

BEGIN;

-- 1. Desagendar o cron job (guarda defensiva: pg_cron pode não existir).
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron ausente: nada a desagendar (billing_notifier_job nunca foi criado).';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing_notifier_job') THEN
    PERFORM cron.unschedule('billing_notifier_job');
  END IF;
END
$cron$;

-- 2. Dropar a função.
DROP FUNCTION IF EXISTS run_billing_notifications();

COMMIT;

-- VERIFY:
/*
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='run_billing_notifications'; -- 0 linhas
SELECT jobname FROM cron.job WHERE jobname='billing_notifier_job';   -- 0 linhas
*/
