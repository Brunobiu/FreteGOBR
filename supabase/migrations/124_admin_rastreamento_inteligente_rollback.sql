-- ============================================================================
-- ROLLBACK da Migration 124: Rastreamento Inteligente (PatGo)
-- ============================================================================
-- DOCUMENTADO, NAO auto-aplicado. Reverte a 124 sem tocar objetos de 092-118
-- alem da RESTAURACAO do CHECK ampliado de system_alerts.alert_type.
--
-- Ordem: unschedule pg_cron -> DROP RPCs/helpers -> DROP policies -> DROP tabelas
-- (recovery_attempts antes de journey_events por causa do FK trigger_event_id) ->
-- restaura CHECK original de system_alerts.alert_type -> re-asserta
-- is_admin_with_permission ao corpo pre-124 (identico ao vigente em 115/117:
-- RASTREAMENTO_* deixam de existir no enum do front; por construcao continuam
-- negadas a todos exceto SUPER_ADMIN/ADMIN, mas o painel nao mais as referencia).
--
-- ATENCAO: dados de journey_events / recovery_attempts sao PERDIDOS no rollback.
-- ============================================================================

BEGIN;

-- 1. Desagenda o job pg_cron (defensivo).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('tracking-scan-recovery-tick');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'job pg_cron "tracking-scan-recovery-tick" inexistente (ok).';
    END;
  END IF;
END
$cron$;

-- 2. DROP das RPCs novas.
DROP FUNCTION IF EXISTS rpc_tracking_ingest_event(jsonb);
DROP FUNCTION IF EXISTS rpc_tracking_correlate_visitor(text);
DROP FUNCTION IF EXISTS rpc_tracking_timeline(uuid);
DROP FUNCTION IF EXISTS rpc_tracking_at_risk_list(jsonb, int, int);
DROP FUNCTION IF EXISTS rpc_tracking_funnel(text);
DROP FUNCTION IF EXISTS rpc_tracking_recovery_performance(text);
DROP FUNCTION IF EXISTS rpc_tracking_get_config();
DROP FUNCTION IF EXISTS rpc_tracking_mark_contacted(uuid, timestamptz);
DROP FUNCTION IF EXISTS rpc_tracking_trigger_recovery(uuid, jsonb);
DROP FUNCTION IF EXISTS rpc_tracking_record_dispatch(uuid, text, text, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS rpc_tracking_update_ai_config(jsonb, timestamptz);
DROP FUNCTION IF EXISTS rpc_tracking_scan_recovery();
DROP FUNCTION IF EXISTS rpc_tracking_publish_alert(text, jsonb);

-- 3. DROP dos helpers IMMUTABLE.
DROP FUNCTION IF EXISTS tracking_recovery_decision(uuid, text, timestamptz, timestamptz, boolean);
DROP FUNCTION IF EXISTS tracking_resolve_scenario(text, text);
DROP FUNCTION IF EXISTS tracking_abandonment_cause(text, boolean, boolean, int, int, int);
DROP FUNCTION IF EXISTS tracking_risk_category(text);
DROP FUNCTION IF EXISTS tracking_risk_band(int);
DROP FUNCTION IF EXISTS tracking_risk_score(int, int, int, int, int);
DROP FUNCTION IF EXISTS tracking_mask_phone(text);

-- 4. DROP das policies novas (idempotente).
DROP POLICY IF EXISTS journey_events_select_admin ON journey_events;
DROP POLICY IF EXISTS journey_events_no_dml ON journey_events;
DROP POLICY IF EXISTS visitor_identities_select_admin ON tracking_visitor_identities;
DROP POLICY IF EXISTS visitor_identities_no_dml ON tracking_visitor_identities;
DROP POLICY IF EXISTS recovery_attempts_select_admin ON recovery_attempts;
DROP POLICY IF EXISTS recovery_attempts_no_dml ON recovery_attempts;
DROP POLICY IF EXISTS tracking_ai_config_select_admin ON tracking_ai_config;
DROP POLICY IF EXISTS tracking_ai_config_no_dml ON tracking_ai_config;

-- 5. DROP das tabelas novas (recovery_attempts antes de journey_events — FK).
DROP TABLE IF EXISTS recovery_attempts;
DROP TABLE IF EXISTS tracking_visitor_identities;
DROP TABLE IF EXISTS tracking_ai_config;
DROP TABLE IF EXISTS journey_events;

-- 6. DROP do trigger de updated_at (a funcao e local desta migration).
DROP FUNCTION IF EXISTS tracking_touch_updated_at();

-- 7. Restaura o CHECK ORIGINAL de system_alerts.alert_type (remove ABANDONMENT_SPIKE).
--    Pre-condicao: nenhuma linha com alert_type='ABANDONMENT_SPIKE' deve existir
--    (remova-as antes, se necessario, para o ADD nao falhar).
DELETE FROM system_alerts WHERE alert_type = 'ABANDONMENT_SPIKE';
DO $alert_type$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'system_alerts' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%alert_type%'
  LOOP
    EXECUTE format('ALTER TABLE system_alerts DROP CONSTRAINT %I', v_conname);
  END LOOP;

  ALTER TABLE system_alerts ADD CONSTRAINT system_alerts_alert_type_check
    CHECK (alert_type IN ('WHATSAPP_DISCONNECTED','CAMPAIGN_PAUSED','CAMPAIGN_ERROR',
                          'INTEGRATION_FAILURE','SUBSCRIPTION_EXPIRING','CUSTOMER_AWAITING'));
END
$alert_type$;

-- 8. Re-asserta is_admin_with_permission ao corpo pre-124 (identico a 115/117).
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
