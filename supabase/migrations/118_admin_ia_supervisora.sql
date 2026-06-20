-- ============================================================================
-- Migration 118: Supervisor_AI — IA Supervisora (Painel Inteligente + Diagnóstico
--                + Insights/Anomalias + Resumo periódico)
-- ============================================================================
-- Spec: .kiro/specs/admin-ia-supervisora/{requirements,design,tasks}.md
--
-- Quarta e ÚLTIMA das specs do dono (complementos "IA Supervisora" +
-- "Notificações Proativas" de Credencial/Ideias). AMPLIA/COMPÕE o que já está
-- em produção — NÃO recria: admin-central-operacao (117: admin_operations_metrics,
-- system_alerts, admin_logs_list), admin-assistant (047: Provider_Abstraction),
-- notifications-hub (041), admin-foundation (030: is_admin_with_permission,
-- admin_audit_logs).
--
-- ENTREGA (read-only por design — a IA observa/responde/sugere/notifica, NUNCA
-- executa ação destrutiva automática):
--   - supervisor_diagnostics (Central de Diagnóstico, registro rolling idempotente
--     por dedup_key + occurrence_count).
--   - supervisor_insights (autoanálise: ANOMALY/SUGGESTION/SUMMARY/SECURITY) com
--     ciclo OPEN→ACKNOWLEDGED→DISMISSED e índice único PARCIAL de dedup.
--   - RLS admin-only (SELECT sob SUPERVISOR_VIEW; DML direto negado).
--   - RBAC: re-assercao de is_admin_with_permission PRESERVANDO o corpo vigente
--     (030 + deny-list 048 + 115/116/117). SUPERVISOR_VIEW/SUPERVISOR_MANAGE
--     reconhecidas POR CONSTRUCAO (SUPER_ADMIN wildcard, ADMIN allow-all menos
--     deny-list; demais papeis negados).
--   - 8 RPCs SECURITY DEFINER (record_diagnostic, diagnostics_list, insights_list,
--     chat_context, evaluate, generate_summary, insight_acknowledge,
--     insight_dismiss).
--   - Agendamento via pg_cron (defensivo, espelha 092/117).
--
-- CORRECOES preservadas dos antecessores:
--   - is_admin_with_permission re-asserida PRESERVA o corpo on-disk vigente (117);
--     acoes novas por construcao (sem ramo).
--   - admin_audit_logs.admin_id e NOT NULL: SUPERVISOR_DIAGNOSTIC_RECORDED/
--     SUPERVISOR_INSIGHT_GENERATED/SUPERVISOR_SOURCE_FAILED so gravados quando ha
--     caller (auth.uid()); no caminho pg_cron a propria linha e o registro duravel.
--
-- IDEMPOTENTE (admin-patterns Sec. 9). BEGIN; ... COMMIT;. Par documentado (nao
--   auto-aplicado): 118_admin_ia_supervisora_rollback.sql.
-- Idioma: identifiers/action codes/error codes em ingles (UPPER_SNAKE); mensagens
--   user-facing pt-BR moram no client. detail NUNCA carrega PII nem segredos
--   (sanitizado na camada de service antes de persistir).
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validacoes defensivas — dependencias DURAS (030, 117) e MACIAS (041, 047)
-- ────────────────────────────────────────────────────────────────────────────

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='admin_audit_logs') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='admin_operations_metrics') THEN
    RAISE EXCEPTION 'Migration 117 (admin-central-operacao) nao aplicada: admin_operations_metrics ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='system_alerts') THEN
    RAISE EXCEPTION 'Migration 117 (admin-central-operacao) nao aplicada: system_alerts ausente';
  END IF;
END
$check$;

-- notifications-hub (041) e admin-assistant (047): dependencias MACIAS. A ausencia
-- NAO aborta; as notificacoes proativas / o chat degradam em runtime.
DO $soft$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='notifications') THEN
    RAISE NOTICE '[admin-ia-supervisora] notifications-hub (041) ausente: notificacoes proativas in-app degradam.';
  END IF;
END
$soft$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Trigger de updated_at (funcao local idempotente)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION supervisor_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $touch$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$touch$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Tabela supervisor_diagnostics (Req 3) — registro rolling idempotente
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supervisor_diagnostics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module           text NOT NULL,
  operation        text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  error_code       text,
  description      text NOT NULL,                       -- pt-BR, sanitizado (sem PII)
  probable_cause   text,
  suggested_fix    text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- contexto nao sensivel
  dedup_key        text NOT NULL,                       -- module:operation:error_code
  occurrence_count int  NOT NULL DEFAULT 1,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supervisor_diagnostics_dedup UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_diag_list
  ON supervisor_diagnostics (severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervisor_diag_module
  ON supervisor_diagnostics (module, last_seen_at DESC);

COMMENT ON TABLE supervisor_diagnostics IS
  'Central de Diagnóstico da IA Supervisora (admin-ia-supervisora / 118). Registro rolling idempotente por dedup_key. Escrita so via RPC SECURITY DEFINER; SELECT admin-only (SUPERVISOR_VIEW). detail NAO carrega PII nem segredos. Cliente nunca ve.';

DROP TRIGGER IF EXISTS trg_supervisor_diag_touch ON supervisor_diagnostics;
CREATE TRIGGER trg_supervisor_diag_touch
  BEFORE UPDATE ON supervisor_diagnostics
  FOR EACH ROW EXECUTE FUNCTION supervisor_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Tabela supervisor_insights (Req 5, 6, 8, 9)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supervisor_insights (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type     text NOT NULL CHECK (insight_type IN ('ANOMALY','SUGGESTION','SUMMARY','SECURITY')),
  severity         text NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  state            text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','ACKNOWLEDGED','DISMISSED')),
  title            text NOT NULL,                        -- pt-BR, sem PII
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key        text NOT NULL,                        -- insight_type:scope:subject
  source           text NOT NULL DEFAULT 'anomaly_detector',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at     timestamptz,
  dismissed_by     uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL = automatico
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Indice unico PARCIAL: no maximo UM insight ATIVO por situacao (Req 5.4, CP3).
CREATE UNIQUE INDEX IF NOT EXISTS uq_supervisor_insights_active_dedup
  ON supervisor_insights (dedup_key)
  WHERE state IN ('OPEN','ACKNOWLEDGED');

CREATE INDEX IF NOT EXISTS idx_supervisor_insights_list
  ON supervisor_insights (state, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervisor_insights_type
  ON supervisor_insights (insight_type, created_at DESC);

COMMENT ON TABLE supervisor_insights IS
  'Insights da IA Supervisora (admin-ia-supervisora / 118): ANOMALY/SUGGESTION/SUMMARY/SECURITY. Ciclo OPEN->ACKNOWLEDGED->DISMISSED (DISMISSED terminal). Escrita so via RPC; SELECT admin-only (SUPERVISOR_VIEW). Sem PII/segredos.';

DROP TRIGGER IF EXISTS trg_supervisor_insights_touch ON supervisor_insights;
CREATE TRIGGER trg_supervisor_insights_touch
  BEFORE UPDATE ON supervisor_insights
  FOR EACH ROW EXECUTE FUNCTION supervisor_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS (Req 11) — admin-only, escrita so por RPC
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE supervisor_diagnostics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supervisor_diagnostics_select_admin ON supervisor_diagnostics;
CREATE POLICY supervisor_diagnostics_select_admin ON supervisor_diagnostics
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('SUPERVISOR_VIEW'));
DROP POLICY IF EXISTS supervisor_diagnostics_no_dml ON supervisor_diagnostics;
CREATE POLICY supervisor_diagnostics_no_dml ON supervisor_diagnostics
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE supervisor_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supervisor_insights_select_admin ON supervisor_insights;
CREATE POLICY supervisor_insights_select_admin ON supervisor_insights
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('SUPERVISOR_VIEW'));
DROP POLICY IF EXISTS supervisor_insights_no_dml ON supervisor_insights;
CREATE POLICY supervisor_insights_no_dml ON supervisor_insights
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RBAC — re-assercao de is_admin_with_permission (Req 12, CP6)
-- ────────────────────────────────────────────────────────────────────────────
-- PRESERVA INTEGRALMENTE o corpo on-disk vigente (030 + deny-list 048 + FAQ_VIEW
-- de 115 + USER_NOTE_* de 116 + ALERT_*/LOG_VIEW de 117). SUPERVISOR_VIEW e
-- SUPERVISOR_MANAGE sao reconhecidas POR CONSTRUCAO: SUPER_ADMIN (wildcard) e
-- ADMIN (allow-all menos deny-list) as recebem; SUPORTE/FINANCEIRO/MODERADOR
-- (allowlists fechadas que NAO as listam) as negam. Sem ramo dedicado.
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

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC supervisor_record_diagnostic (Req 3) — service-role OU SUPERVISOR_VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotente por dedup_key (rolling). detail deve vir PRE-sanitizado da camada
-- de service (sem PII/segredos). auth.uid() nulo => contexto confiavel (monitor/
-- service_role). admin_audit_logs.admin_id NOT NULL => log so com caller.
CREATE OR REPLACE FUNCTION supervisor_record_diagnostic(
  p_module text, p_operation text, p_severity text DEFAULT 'WARNING',
  p_error_code text DEFAULT NULL, p_description text DEFAULT '',
  p_probable_cause text DEFAULT NULL, p_suggested_fix text DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb, p_dedup_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_sev    text := CASE WHEN p_severity IN ('CRITICAL','WARNING','INFO') THEN p_severity ELSE 'WARNING' END;
  v_key    text := COALESCE(NULLIF(p_dedup_key, ''),
                            p_module || ':' || p_operation || ':' || COALESCE(p_error_code, '_'));
  v_id     uuid;
  v_count  int;
BEGIN
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_diagnostics', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO supervisor_diagnostics(
    module, operation, severity, error_code, description, probable_cause, suggested_fix, detail, dedup_key)
  VALUES (
    p_module, p_operation, v_sev, p_error_code,
    COALESCE(NULLIF(p_description, ''), p_operation), p_probable_cause, p_suggested_fix,
    COALESCE(p_detail, '{}'::jsonb), v_key)
  ON CONFLICT (dedup_key) DO UPDATE SET
    occurrence_count = supervisor_diagnostics.occurrence_count + 1,
    last_seen_at     = now(),
    severity         = EXCLUDED.severity,
    description      = EXCLUDED.description,
    probable_cause   = EXCLUDED.probable_cause,
    suggested_fix    = EXCLUDED.suggested_fix,
    detail           = EXCLUDED.detail
  RETURNING id, occurrence_count INTO v_id, v_count;

  IF v_caller IS NOT NULL THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_DIAGNOSTIC_RECORDED', 'supervisor_diagnostics', v_id::text, NULL,
            jsonb_build_object('module', p_module, 'dedup_key', v_key, 'occurrence_count', v_count));
  END IF;

  RETURN jsonb_build_object('id', v_id, 'occurrence_count', v_count);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_record_diagnostic(text, text, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_record_diagnostic(text, text, text, text, text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION supervisor_record_diagnostic(text, text, text, text, text, text, text, jsonb, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPC supervisor_diagnostics_list (Req 10) — SUPERVISOR_VIEW
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_diagnostics_list(
  p_module text DEFAULT NULL, p_severity text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_limit  int  := CASE WHEN p_limit IN (10,50,100) THEN p_limit ELSE 10 END;
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_diagnostics', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM supervisor_diagnostics
   WHERE (p_module   IS NULL OR module = p_module)
     AND (p_severity IS NULL OR severity = p_severity)
     AND (p_from IS NULL OR last_seen_at >= p_from)
     AND (p_to   IS NULL OR last_seen_at <= p_to);

  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT * FROM supervisor_diagnostics
     WHERE (p_module   IS NULL OR module = p_module)
       AND (p_severity IS NULL OR severity = p_severity)
       AND (p_from IS NULL OR last_seen_at >= p_from)
       AND (p_to   IS NULL OR last_seen_at <= p_to)
     ORDER BY last_seen_at DESC, id ASC
     LIMIT v_limit OFFSET v_offset
  ) d;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_diagnostics_list(text, text, timestamptz, timestamptz, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_diagnostics_list(text, text, timestamptz, timestamptz, int, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. RPC supervisor_insights_list (Req 10) — SUPERVISOR_VIEW
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_insights_list(
  p_type text DEFAULT NULL, p_severity text DEFAULT NULL, p_state text DEFAULT NULL,
  p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_limit  int  := CASE WHEN p_limit IN (10,50,100) THEN p_limit ELSE 10 END;
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_insights', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM supervisor_insights
   WHERE (p_type     IS NULL OR insight_type = p_type)
     AND (p_severity IS NULL OR severity = p_severity)
     AND (p_state    IS NULL OR state = p_state);

  SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT * FROM supervisor_insights
     WHERE (p_type     IS NULL OR insight_type = p_type)
       AND (p_severity IS NULL OR severity = p_severity)
       AND (p_state    IS NULL OR state = p_state)
     ORDER BY (CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END) ASC,
              created_at DESC, id ASC
     LIMIT v_limit OFFSET v_offset
  ) i;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_insights_list(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_insights_list(text, text, text, int, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. RPC supervisor_chat_context (Req 2) — SUPERVISOR_VIEW; SO agregados, sem PII
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_chat_context(p_intents text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller       uuid := auth.uid();
  v_metrics      jsonb := '{}'::jsonb;
  v_alerts_open  bigint;
  v_insights_open bigint;
  v_diag_recent  bigint;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Reusa o bundle agregado de 117 (degradacao controlada se falhar).
  BEGIN
    v_metrics := admin_operations_metrics(300);
  EXCEPTION WHEN OTHERS THEN
    v_metrics := jsonb_build_object('errors', jsonb_build_object('metrics', 'Bloco indisponível.'));
  END;
  BEGIN SELECT count(*) INTO v_alerts_open FROM system_alerts WHERE state IN ('OPEN','ACKNOWLEDGED');
  EXCEPTION WHEN OTHERS THEN v_alerts_open := NULL; END;
  BEGIN SELECT count(*) INTO v_insights_open FROM supervisor_insights WHERE state IN ('OPEN','ACKNOWLEDGED');
  EXCEPTION WHEN OTHERS THEN v_insights_open := NULL; END;
  BEGIN SELECT count(*) INTO v_diag_recent FROM supervisor_diagnostics WHERE last_seen_at >= now() - interval '24 hours';
  EXCEPTION WHEN OTHERS THEN v_diag_recent := NULL; END;

  RETURN jsonb_build_object(
    'intents',            COALESCE(to_jsonb(p_intents), '[]'::jsonb),
    'metrics',            v_metrics,
    'alerts_open',        v_alerts_open,
    'insights_open',      v_insights_open,
    'diagnostics_recent', v_diag_recent,
    'generated_at',       now()
  );
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_chat_context(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_context(text[]) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. RPC supervisor_evaluate (Req 5) — service-role (pg_cron) OU SUPERVISOR_VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Anomaly_Detector por regra: diagnosticos com occurrence_count >= threshold na
-- janela => ANOMALY. Reconcilia via indice unico parcial (abre OU toca) e
-- auto-dismiss das anomalias ativas sem situacao. Idempotente (CP3).
CREATE OR REPLACE FUNCTION supervisor_evaluate(
  p_error_threshold int DEFAULT 5, p_window_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_threshold int  := GREATEST(COALESCE(p_error_threshold, 5), 1);
  v_window    int  := GREATEST(COALESCE(p_window_minutes, 60), 1);
  v_now       timestamptz := now();
  v_opened    int := 0;
  v_touched   int := 0;
  v_dismissed int := 0;
  v_inserted  boolean;
  rec         record;
BEGIN
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_insights', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _supervisor_sit (
    dedup_key text PRIMARY KEY, insight_type text, severity text, title text
  ) ON COMMIT DROP;
  DELETE FROM _supervisor_sit;

  -- fonte: diagnosticos recorrentes (occurrence_count >= threshold na janela)
  BEGIN
    INSERT INTO _supervisor_sit
    SELECT 'ANOMALY:diagnostic:' || d.dedup_key,
           'ANOMALY',
           CASE WHEN d.severity = 'CRITICAL'
                  OR d.module IN ('financeiro','auth','integration','queue')
                THEN 'CRITICAL' ELSE 'WARNING' END,
           'Erros recorrentes em ' || d.module || ' (' || d.occurrence_count || 'x)'
    FROM supervisor_diagnostics d
    WHERE d.occurrence_count >= v_threshold
      AND d.last_seen_at >= v_now - make_interval(mins => v_window)
    ON CONFLICT (dedup_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    IF v_caller IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'SUPERVISOR_SOURCE_FAILED', 'supervisor_diagnostics', NULL, NULL,
              jsonb_build_object('source', 'supervisor_diagnostics', 'sqlstate', SQLSTATE));
    END IF;
  END;

  -- abre (novo) OU toca (ja ativo) cada situacao; indice unico parcial garante
  -- <= 1 ativo por dedup_key. (xmax = 0) distingue INSERT de UPDATE.
  FOR rec IN SELECT * FROM _supervisor_sit LOOP
    INSERT INTO supervisor_insights(insight_type, severity, state, title, dedup_key, source)
    VALUES (rec.insight_type, rec.severity, 'OPEN', rec.title, rec.dedup_key, 'anomaly_detector')
    ON CONFLICT (dedup_key) WHERE state IN ('OPEN','ACKNOWLEDGED')
    DO UPDATE SET last_seen_at = now()
    RETURNING (xmax = 0) INTO v_inserted;

    IF v_inserted THEN
      v_opened := v_opened + 1;
      IF v_caller IS NOT NULL THEN
        INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
        VALUES (v_caller, 'SUPERVISOR_INSIGHT_GENERATED', 'supervisor_insights', rec.dedup_key, NULL,
                jsonb_build_object('insight_type', rec.insight_type, 'dedup_key', rec.dedup_key));
      END IF;
    ELSE
      v_touched := v_touched + 1;
    END IF;
  END LOOP;

  -- auto-dismiss: anomalias ativas sem situacao correspondente => DISMISSED (auto).
  UPDATE supervisor_insights
     SET state = 'DISMISSED', dismissed_at = now(), dismissed_by = NULL
   WHERE state IN ('OPEN','ACKNOWLEDGED')
     AND insight_type = 'ANOMALY'
     AND dedup_key NOT IN (SELECT dedup_key FROM _supervisor_sit);
  GET DIAGNOSTICS v_dismissed = ROW_COUNT;

  RETURN jsonb_build_object('opened', v_opened, 'touched', v_touched, 'dismissed', v_dismissed);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_evaluate(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_evaluate(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION supervisor_evaluate(int, int) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. RPC supervisor_generate_summary (Req 8) — service-role OU SUPERVISOR_VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotente por janela (dedup_key = 'SUMMARY:<period>:<bucket>'). O texto pt-BR
-- espelha o Summary_Builder (autoridade TS testada em CP5).
CREATE OR REPLACE FUNCTION supervisor_generate_summary(p_period text DEFAULT 'daily')
RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_period  text := CASE WHEN p_period IN ('daily','weekly','monthly') THEN p_period ELSE 'daily' END;
  v_bucket  text := to_char(now(), 'YYYY-MM-DD');
  v_today   timestamptz := date_trunc('day', now());
  v_dedup   text;
  v_signups bigint := 0; v_subs bigint := 0; v_alerts bigint := 0; v_tickets bigint := 0;
  v_title   text; v_id uuid;
BEGIN
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_insights', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  v_dedup := 'SUMMARY:' || v_period || ':' || v_bucket;

  BEGIN SELECT count(*) INTO v_signups FROM users
        WHERE user_type IN ('motorista','embarcador') AND created_at >= v_today;
  EXCEPTION WHEN OTHERS THEN v_signups := 0; END;
  BEGIN SELECT count(*) INTO v_subs FROM subscriptions WHERE status = 'active';
  EXCEPTION WHEN OTHERS THEN v_subs := 0; END;
  BEGIN SELECT count(*) INTO v_alerts FROM system_alerts WHERE state IN ('OPEN','ACKNOWLEDGED');
  EXCEPTION WHEN OTHERS THEN v_alerts := 0; END;
  BEGIN SELECT count(*) INTO v_tickets FROM support_tickets WHERE status NOT IN ('resolved','closed');
  EXCEPTION WHEN OTHERS THEN v_tickets := 0; END;

  v_title := 'Resumo do dia: ' || v_signups || ' novos cadastros, ' || v_subs
             || ' assinaturas ativas, ' || v_tickets || ' atendimentos abertos, '
             || v_alerts || ' alertas para sua atenção.';

  INSERT INTO supervisor_insights(insight_type, severity, state, title, detail, dedup_key, source)
  VALUES ('SUMMARY', 'INFO', 'OPEN', v_title,
          jsonb_build_object('period', v_period, 'bucket', v_bucket, 'signups', v_signups,
                             'subscriptions', v_subs, 'tickets_open', v_tickets, 'alerts_open', v_alerts),
          v_dedup, 'summary_builder')
  ON CONFLICT (dedup_key) WHERE state IN ('OPEN','ACKNOWLEDGED')
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_GENERATED');
  END IF;

  IF v_caller IS NOT NULL THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_INSIGHT_GENERATED', 'supervisor_insights', v_id::text, NULL,
            jsonb_build_object('insight_type', 'SUMMARY', 'dedup_key', v_dedup));
  END IF;

  RETURN jsonb_build_object('id', v_id, 'skipped', false);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_generate_summary(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_generate_summary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION supervisor_generate_summary(text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. RPC supervisor_insight_acknowledge (Req 9) — SUPERVISOR_MANAGE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_insight_acknowledge(p_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_state   text;
  v_updated timestamptz;
  v_rows    int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_insights', p_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_MANAGE required' USING ERRCODE = '42501';
  END IF;

  SELECT state INTO v_state FROM supervisor_insights WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: insight' USING ERRCODE = 'P0002';
  END IF;
  IF v_state = 'ACKNOWLEDGED' THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_INSIGHT_ACK_SKIPPED', 'supervisor_insights', p_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_ACKNOWLEDGED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_ACKNOWLEDGED');
  END IF;
  IF v_state = 'DISMISSED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: DISMISSED cannot be acknowledged' USING ERRCODE = 'P0001';
  END IF;

  UPDATE supervisor_insights
     SET state = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = v_caller
   WHERE id = p_id AND state = 'OPEN' AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_updated;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_updated);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_insight_acknowledge(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_insight_acknowledge(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. RPC supervisor_insight_dismiss (Req 9) — SUPERVISOR_MANAGE (DISMISSED terminal)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_insight_dismiss(p_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_state   text;
  v_updated timestamptz;
  v_rows    int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_insights', p_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_MANAGE required' USING ERRCODE = '42501';
  END IF;

  SELECT state INTO v_state FROM supervisor_insights WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: insight' USING ERRCODE = 'P0002';
  END IF;
  IF v_state = 'DISMISSED' THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_INSIGHT_DISMISS_SKIPPED', 'supervisor_insights', p_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_DISMISSED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_DISMISSED');
  END IF;

  UPDATE supervisor_insights
     SET state = 'DISMISSED', dismissed_at = now(), dismissed_by = v_caller
   WHERE id = p_id AND state IN ('OPEN','ACKNOWLEDGED') AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_updated;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_updated);
END;
$func$;

REVOKE ALL ON FUNCTION supervisor_insight_dismiss(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_insight_dismiss(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14. Agendamento pg_cron (defensivo, espelha 092/117)
-- ────────────────────────────────────────────────────────────────────────────
DO $cron$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[admin-ia-supervisora] pg_cron ausente: agendamento IGNORADO neste ambiente (local/test). Em producao hospedada os jobs serao criados.';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('supervisor-evaluate-tick'); EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[admin-ia-supervisora] nenhum job pg_cron "supervisor-evaluate-tick" pre-existente (ok).';
  END;
  BEGIN PERFORM cron.unschedule('supervisor-daily-summary'); EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[admin-ia-supervisora] nenhum job pg_cron "supervisor-daily-summary" pre-existente (ok).';
  END;

  -- Reconcilia anomalias a cada 5 minutos (contexto service-role, auth.uid nulo).
  PERFORM cron.schedule('supervisor-evaluate-tick', '*/5 * * * *',
                        'SELECT public.supervisor_evaluate();');
  -- Resumo diario as 00:05.
  PERFORM cron.schedule('supervisor-daily-summary', '5 0 * * *',
                        'SELECT public.supervisor_generate_summary(''daily'');');
  RAISE NOTICE '[admin-ia-supervisora] jobs pg_cron agendados (evaluate 5min + summary diario).';
END
$cron$;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado; nao executa no apply)
-- ============================================================================
/*
SELECT to_regclass('public.supervisor_diagnostics'), to_regclass('public.supervisor_insights');
SELECT indexname FROM pg_indexes WHERE indexname = 'uq_supervisor_insights_active_dedup';
SELECT relrowsecurity FROM pg_class WHERE relname IN ('supervisor_diagnostics','supervisor_insights');
SELECT polname, polcmd, polpermissive FROM pg_policy
 WHERE polrelid IN ('public.supervisor_diagnostics'::regclass, 'public.supervisor_insights'::regclass);
-- SELECT is_admin_with_permission('SUPERVISOR_VIEW'), is_admin_with_permission('SUPERVISOR_MANAGE');
SELECT proname FROM pg_proc WHERE proname IN
  ('supervisor_record_diagnostic','supervisor_diagnostics_list','supervisor_insights_list',
   'supervisor_chat_context','supervisor_evaluate','supervisor_generate_summary',
   'supervisor_insight_acknowledge','supervisor_insight_dismiss') ORDER BY proname;
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'supervisor-%';
*/
