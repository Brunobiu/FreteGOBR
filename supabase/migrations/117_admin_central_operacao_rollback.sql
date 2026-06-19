-- ============================================================================
-- ROLLBACK da Migration 117: Central_Operacao
-- ============================================================================
-- Spec: .kiro/specs/admin-central-operacao/{requirements,design,tasks}.md (task 1.5)
--
-- DOCUMENTADO — NAO auto-aplicado (admin-patterns Sec. 9). Reverte a 117 na
-- ordem inversa, sem tocar dados das tabelas REUSADAS (users, subscriptions,
-- support_tickets, admin_audit_logs e as tabelas de whatsapp-automation). So a
-- tabela nova system_alerts e removida.
--
-- A re-assercao de is_admin_with_permission restaura o corpo anterior (== 116,
-- ja que a 117 reconhece ALERT_*/LOG_VIEW POR CONSTRUCAO e nao mudou ramos). E
-- funcionalmente idempotente; mantida aqui para deixar o rollback auto-contido.
-- ============================================================================

BEGIN;

-- 1. Desagenda o job pg_cron (defensivo: nao falha se ausente).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('admin-alerts-evaluate-tick');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'job pg_cron "admin-alerts-evaluate-tick" inexistente (ok).';
    END;
  END IF;
END
$cron$;

-- 2. RPCs (6) + funcao de touch
DROP FUNCTION IF EXISTS admin_alert_resolve(uuid, timestamptz);
DROP FUNCTION IF EXISTS admin_alert_acknowledge(uuid, timestamptz);
DROP FUNCTION IF EXISTS admin_alerts_evaluate(int, int);
DROP FUNCTION IF EXISTS admin_logs_list(text[], timestamptz, timestamptz, uuid, text, int, int);
DROP FUNCTION IF EXISTS admin_alerts_list(text, text, text, int, int);
DROP FUNCTION IF EXISTS admin_operations_metrics(int);

-- 3. Trigger + policies + indices + tabela
DROP TRIGGER IF EXISTS trg_system_alerts_touch ON system_alerts;
DROP FUNCTION IF EXISTS operacao_touch_updated_at();
DROP POLICY IF EXISTS system_alerts_no_dml ON system_alerts;
DROP POLICY IF EXISTS system_alerts_select_admin ON system_alerts;
DROP INDEX IF EXISTS idx_system_alerts_type;
DROP INDEX IF EXISTS idx_system_alerts_list;
DROP INDEX IF EXISTS uq_system_alerts_active_dedup;
DROP TABLE IF EXISTS system_alerts;

-- 4. Restaura is_admin_with_permission ao corpo anterior (== 116/115).
CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH active AS (
    SELECT role
    FROM admin_roles
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE',
            'ASSISTANT_VIEW','ASSISTANT_EDIT'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW','FAQ_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;

COMMIT;
