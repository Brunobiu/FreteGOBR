-- ============================================================================
-- ROLLBACK da Migration 118: Supervisor_AI (admin-ia-supervisora)
-- ============================================================================
-- DOCUMENTADO, NAO auto-aplicado. Reverte os objetos da 118 sem tocar nos
-- objetos herdados (030/041/047/117). NAO derruba is_admin_with_permission:
-- a 118 apenas re-asseriu o MESMO corpo on-disk (acoes novas por construcao),
-- entao reverter a funcao nao e necessario nem desejavel (quebraria as specs
-- anteriores). Para "remover" SUPERVISOR_VIEW/SUPERVISOR_MANAGE basta dropar as
-- tabelas/RPCs desta migration — as permissoes deixam de ter efeito.
--
-- Uso (manual, com cuidado, em ambiente de teste primeiro):
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/118_admin_ia_supervisora_rollback.sql
-- ============================================================================

BEGIN;

-- 1. Desagenda os jobs pg_cron (defensivo).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('supervisor-evaluate-tick'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('supervisor-daily-summary'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END
$cron$;

-- 2. Dropa as RPCs SECURITY DEFINER da 118.
DROP FUNCTION IF EXISTS supervisor_record_diagnostic(text, text, text, text, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS supervisor_diagnostics_list(text, text, timestamptz, timestamptz, int, int);
DROP FUNCTION IF EXISTS supervisor_insights_list(text, text, text, int, int);
DROP FUNCTION IF EXISTS supervisor_chat_context(text[]);
DROP FUNCTION IF EXISTS supervisor_evaluate(int, int);
DROP FUNCTION IF EXISTS supervisor_generate_summary(text);
DROP FUNCTION IF EXISTS supervisor_insight_acknowledge(uuid, timestamptz);
DROP FUNCTION IF EXISTS supervisor_insight_dismiss(uuid, timestamptz);

-- 3. Dropa policies + tabelas (CASCADE remove triggers/indices).
DROP POLICY IF EXISTS supervisor_insights_select_admin ON supervisor_insights;
DROP POLICY IF EXISTS supervisor_insights_no_dml ON supervisor_insights;
DROP POLICY IF EXISTS supervisor_diagnostics_select_admin ON supervisor_diagnostics;
DROP POLICY IF EXISTS supervisor_diagnostics_no_dml ON supervisor_diagnostics;

DROP TABLE IF EXISTS supervisor_insights CASCADE;
DROP TABLE IF EXISTS supervisor_diagnostics CASCADE;

-- 4. A funcao de trigger e local desta migration; segura para dropar.
DROP FUNCTION IF EXISTS supervisor_touch_updated_at();

-- NOTA: is_admin_with_permission NAO e reertida (preserva 030/115/116/117).

COMMIT;
