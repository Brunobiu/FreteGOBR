-- ============================================================================
-- Migration 117: Central_Operacao — Painel Operacional + Alertas + Logs
-- ============================================================================
-- Spec: .kiro/specs/admin-central-operacao/{requirements,design,tasks}.md
--
-- Terceira das quatro specs do dono (partes 7/8/9). AMPLIA o que ja esta em
-- producao sem recriar: admin-dashboard (036), whatsapp-automation (092+),
-- notifications-hub/suporte-inteligente (041/115), assinaturas-pagamento (055),
-- admin-foundation (030). Cria UMA tabela nova (system_alerts); as demais sao
-- apenas LIDAS de forma agregada (contagens/snapshots), nunca reescritas.
--
-- ENTREGA (tasks 1.1 a 1.5):
--   - system_alerts (Alert_Type/Severity/State dominios fechados) + indice unico
--     PARCIAL de deduplicacao (<= 1 ativo por situacao) + indices de listagem +
--     trigger updated_at.
--   - RLS admin-only: SELECT sob ALERT_VIEW; DML direto sempre negado (escrita so
--     via RPC SECURITY DEFINER).
--   - RBAC: re-assercao de is_admin_with_permission PRESERVANDO o corpo vigente
--     (030 + deny-list 048 + FAQ_VIEW de 115). ALERT_VIEW/ALERT_ACK/ALERT_RESOLVE/
--     LOG_VIEW reconhecidas POR CONSTRUCAO (SUPER_ADMIN wildcard, ADMIN allow-all
--     menos deny-list; demais papeis negados). DASHBOARD_VIEW reusada sem redefinir.
--   - 6 RPCs SECURITY DEFINER: admin_operations_metrics (DASHBOARD_VIEW),
--     admin_alerts_list / admin_alerts_evaluate (ALERT_VIEW / service-role),
--     admin_alert_acknowledge (ALERT_ACK), admin_alert_resolve (ALERT_RESOLVE),
--     admin_logs_list (LOG_VIEW).
--   - Agendamento de admin_alerts_evaluate via pg_cron (defensivo, nao falha sem
--     a extensao — espelha o padrao de 092).
--
-- DEPENDENCIAS (DO $check$): 030 (is_admin_with_permission, admin_audit_logs),
--   036 (admin_dashboard_metrics), users, 055 (subscriptions), 041/115
--   (support_tickets). whatsapp-automation (092) e dependencia MACIA: ausencia
--   degrada KPIs/alertas em runtime (sub-bloco por fonte), NAO aborta a migration.
--
-- CORRECOES ao rascunho de design (verificadas):
--   - is_admin_with_permission re-asserida PRESERVA o corpo on-disk vigente
--     (115/116), nao a versao 036-era do design (que removeria FAQ_VIEW). As
--     acoes novas sao por construcao (sem ramo).
--   - admin_audit_logs.admin_id e NOT NULL: ALERT_GENERATED/ALERT_SOURCE_FAILED
--     so sao gravados quando ha caller (auth.uid()); no caminho pg_cron a propria
--     linha em system_alerts (first_seen_at) e o registro duravel da geracao.
--
-- IDEMPOTENTE (admin-patterns Sec. 9). Envolvida em BEGIN; ... COMMIT;. Par
--   documentado (nao auto-aplicado): 117_admin_central_operacao_rollback.sql.
-- Idioma: identifiers/action codes/error codes em ingles (UPPER_SNAKE);
--   mensagens user-facing pt-BR moram no client.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validacoes defensivas — dependencias DURAS (Req 14.3)
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
                  WHERE routine_schema='public' AND routine_name='admin_dashboard_metrics') THEN
    RAISE EXCEPTION 'Migration 036 (admin-dashboard) nao aplicada: admin_dashboard_metrics ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela users ausente -- schema inesperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='subscriptions') THEN
    RAISE EXCEPTION 'Migration 055 (assinaturas-pagamento) nao aplicada: subscriptions ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='support_tickets') THEN
    RAISE EXCEPTION 'Migration 041/115 nao aplicada: support_tickets ausente';
  END IF;
END
$check$;

-- whatsapp-automation (092): dependencia MACIA. A ausencia NAO aborta; os KPIs
-- de mensagens e os alertas de WhatsApp degradam em runtime (sub-bloco por fonte).
DO $whatsapp_note$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='whatsapp_sessions') THEN
    RAISE NOTICE 'whatsapp-automation (092) ausente: KPIs de mensagens e alertas de WhatsApp degradam para indisponivel/omitido.';
  END IF;
END
$whatsapp_note$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tabela system_alerts (Req 6.1, 6.2, 6.3, 6.8)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type      text NOT NULL
    CHECK (alert_type IN ('WHATSAPP_DISCONNECTED','CAMPAIGN_PAUSED','CAMPAIGN_ERROR',
                          'INTEGRATION_FAILURE','SUBSCRIPTION_EXPIRING','CUSTOMER_AWAITING')),
  severity        text NOT NULL
    CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  state           text NOT NULL DEFAULT 'OPEN'
    CHECK (state IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  source_type     text NOT NULL,                 -- whatsapp_session/dispatch_job/integration/subscription/support_ticket
  source_id       text NOT NULL,                 -- identificador opaco (sem PII)
  dedup_key       text NOT NULL,                 -- alert_type:source_type:source_id (Alert_Dedup_Key)
  title           text NOT NULL,                 -- rotulo pt-BR curto, sem PII
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- contexto nao sensivel
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL = resolucao automatica
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indice unico PARCIAL: no maximo UM alerta ativo por situacao (Req 6.5, CP4).
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_alerts_active_dedup
  ON system_alerts (dedup_key)
  WHERE state IN ('OPEN','ACKNOWLEDGED');

CREATE INDEX IF NOT EXISTS idx_system_alerts_list
  ON system_alerts (state, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_type
  ON system_alerts (alert_type, last_seen_at DESC);

COMMENT ON TABLE system_alerts IS
  'Alertas operacionais do sistema (admin-central-operacao / 117). Escrita so via RPC SECURITY DEFINER; SELECT admin-only (ALERT_VIEW). detail NAO carrega PII nem segredos.';

-- Trigger de updated_at (funcao local idempotente).
CREATE OR REPLACE FUNCTION operacao_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $touch$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$touch$;

DROP TRIGGER IF EXISTS trg_system_alerts_touch ON system_alerts;
CREATE TRIGGER trg_system_alerts_touch
  BEFORE UPDATE ON system_alerts
  FOR EACH ROW EXECUTE FUNCTION operacao_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS de system_alerts (Req 6.6, 6.7) — admin-only, escrita so por RPC
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT: somente admin com ALERT_VIEW. A policy de negacao de escrita e
-- PERMISSIVE com USING/CHECK false: politicas permissivas combinam por OR no
-- SELECT, entao a leitura segue regida so por system_alerts_select_admin;
-- INSERT/UPDATE/DELETE diretos batem em false e sao negados (escrita so via RPC
-- SECURITY DEFINER, que roda como owner e ignora RLS).
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_alerts_select_admin ON system_alerts;
CREATE POLICY system_alerts_select_admin ON system_alerts
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('ALERT_VIEW'));

DROP POLICY IF EXISTS system_alerts_no_dml ON system_alerts;
CREATE POLICY system_alerts_no_dml ON system_alerts
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RBAC — re-assercao de is_admin_with_permission (Req 2.2-2.6, CP8)
-- ────────────────────────────────────────────────────────────────────────────
-- PRESERVA INTEGRALMENTE o corpo on-disk vigente (030 + deny-list 048 +
-- FAQ_VIEW concedido ao SUPORTE por 115). ALERT_VIEW/ALERT_ACK/ALERT_RESOLVE/
-- LOG_VIEW sao reconhecidas POR CONSTRUCAO: SUPER_ADMIN (wildcard) e ADMIN
-- (allow-all menos deny-list) as recebem; SUPORTE/FINANCEIRO/MODERADOR
-- (allowlists fechadas que NAO as listam) as negam. Sem ramo dedicado.
-- DASHBOARD_VIEW e reusada sem redefinir a concessao por papel (Req 2.1).
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
-- 4. RPC admin_operations_metrics (Req 3, 4.6, 4.7, 5) — DASHBOARD_VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- STABLE; cada grupo (users/subscriptions/tickets/messages) em sub-bloco
-- BEGIN..EXCEPTION => falha vira errors[grupo] (Partial_Degradation), sem
-- abortar os demais. So contagens agregadas, sem PII. USERS_ONLINE sem
-- Presence_Source => available=false (nunca 0).
CREATE OR REPLACE FUNCTION admin_operations_metrics(p_online_window_sec int DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_now     timestamptz := now();
  v_today   timestamptz := date_trunc('day', now());
  v_window  int := GREATEST(COALESCE(p_online_window_sec, 300), 1);
  v_kpis    jsonb := '{}'::jsonb;
  v_errors  jsonb := '{}'::jsonb;
  c1 bigint; c2 bigint; c3 bigint;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('DASHBOARD_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'DASHBOARD_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: DASHBOARD_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- grupo users
  BEGIN
    SELECT count(*) INTO c1 FROM users WHERE user_type IN ('motorista','embarcador');
    SELECT count(*) INTO c2 FROM users
      WHERE user_type IN ('motorista','embarcador') AND created_at >= v_today;
    v_kpis := v_kpis
      || jsonb_build_object('USERS_TOTAL',   jsonb_build_object('value', c1, 'available', true))
      || jsonb_build_object('SIGNUPS_TODAY',  jsonb_build_object('value', c2, 'available', true))
      || jsonb_build_object('USERS_ONLINE',   jsonb_build_object('value', NULL, 'available', false));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('users', 'Bloco indisponível.');
  END;

  -- grupo subscriptions
  BEGIN
    SELECT count(*) INTO c1 FROM subscriptions WHERE status = 'active';
    SELECT count(*) INTO c2 FROM subscriptions WHERE status IN ('past_due','suspended','canceled');
    v_kpis := v_kpis
      || jsonb_build_object('SUBSCRIPTIONS_ACTIVE',  jsonb_build_object('value', c1, 'available', true))
      || jsonb_build_object('SUBSCRIPTIONS_EXPIRED', jsonb_build_object('value', c2, 'available', true));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('subscriptions', 'Bloco indisponível.');
  END;

  -- grupo tickets (5 estados de suporte-inteligente)
  BEGIN
    SELECT count(*) FILTER (WHERE status = 'open'),
           count(*) FILTER (WHERE status = 'in_progress'),
           count(*) FILTER (WHERE status = 'resolved')
      INTO c1, c2, c3 FROM support_tickets;
    v_kpis := v_kpis
      || jsonb_build_object('TICKETS_OPEN',        jsonb_build_object('value', c1, 'available', true))
      || jsonb_build_object('TICKETS_IN_PROGRESS', jsonb_build_object('value', c2, 'available', true))
      || jsonb_build_object('TICKETS_RESOLVED',    jsonb_build_object('value', c3, 'available', true));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('tickets', 'Bloco indisponível.');
  END;

  -- grupo messages (whatsapp-automation — dependencia macia; tabela ausente
  -- dispara undefined_table, capturado aqui => errors[messages]).
  BEGIN
    SELECT count(*) INTO c1 FROM whatsapp_dispatch_recipients
      WHERE status = 'SENT' AND sent_at >= v_today;
    SELECT count(*) INTO c2 FROM whatsapp_dispatch_recipients
      WHERE status = 'FAILED' AND updated_at >= v_today;
    SELECT count(*) INTO c3 FROM whatsapp_scheduled_dispatches
      WHERE executed_at IS NULL AND scheduled_at > v_now;
    v_kpis := v_kpis
      || jsonb_build_object('MESSAGES_SENT',      jsonb_build_object('value', c1, 'available', true))
      || jsonb_build_object('MESSAGES_ERROR',     jsonb_build_object('value', c2, 'available', true))
      || jsonb_build_object('MESSAGES_SCHEDULED', jsonb_build_object('value', c3, 'available', true));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('messages', 'Bloco indisponível.');
  END;

  RETURN jsonb_build_object(
    'meta',   jsonb_build_object('generatedAt', v_now, 'onlineWindowSec', v_window),
    'kpis',   v_kpis,
    'errors', v_errors
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_operations_metrics(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_operations_metrics(int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC admin_alerts_list (Req 8.8, 10.5) — ALERT_VIEW
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_alerts_list(
  p_state text DEFAULT NULL, p_type text DEFAULT NULL, p_severity text DEFAULT NULL,
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
  IF NOT is_admin_with_permission('ALERT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ALERT_VIEW_DENIED', 'system_alerts', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: ALERT_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM system_alerts
   WHERE (p_state    IS NULL OR state = p_state)
     AND (p_type     IS NULL OR alert_type = p_type)
     AND (p_severity IS NULL OR severity = p_severity);

  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT * FROM system_alerts
     WHERE (p_state    IS NULL OR state = p_state)
       AND (p_type     IS NULL OR alert_type = p_type)
       AND (p_severity IS NULL OR severity = p_severity)
     ORDER BY (CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END) ASC,
              last_seen_at DESC, id ASC
     LIMIT v_limit OFFSET v_offset
  ) a;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$func$;

REVOKE ALL ON FUNCTION admin_alerts_list(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_alerts_list(text, text, text, int, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC admin_logs_list (Req 10, 11, 12) — LOG_VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Resolve o Log_Event_Map (event_type -> action codes) sobre admin_audit_logs.
-- summary: rotulo pt-BR fixo por tipo, SEM PII nem segredos. event_type:
-- reverse-map do action. p_event_types NULL => todos os tipos com emissor.
CREATE OR REPLACE FUNCTION admin_logs_list(
  p_event_types text[] DEFAULT NULL, p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL, p_actor uuid DEFAULT NULL,
  p_target_type text DEFAULT NULL, p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_limit   int  := CASE WHEN p_limit IN (10,50,100) THEN p_limit ELSE 10 END;
  v_offset  int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_actions text[] := ARRAY[]::text[];
  v_t       text;
  v_total   bigint;
  v_items   jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('LOG_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'LOG_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: LOG_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Log_Event_Map (forward): tipos -> action codes. NULL/vazio => todos os tipos.
  IF p_event_types IS NULL OR array_length(p_event_types, 1) IS NULL THEN
    v_actions := ARRAY['ADMIN_LOGIN_SUCCESS','WHATSAPP_DISPATCH_STARTED','WHATSAPP_DISPATCH_COMPLETED',
                       'JOB_FAILED','WHATSAPP_DISPATCH_FAILED','SUBSCRIPTION_PLAN_CHANGED',
                       'SUPORTE_AI_REPLY','WHATSAPP_AI_REPLY','SUPORTE_HANDOFF','WHATSAPP_HUMAN_TAKEOVER'];
  ELSE
    FOREACH v_t IN ARRAY p_event_types LOOP
      v_actions := v_actions || CASE v_t
        WHEN 'LOGIN'              THEN ARRAY['ADMIN_LOGIN_SUCCESS']
        WHEN 'DISPATCH_STARTED'   THEN ARRAY['WHATSAPP_DISPATCH_STARTED']
        WHEN 'DISPATCH_COMPLETED' THEN ARRAY['WHATSAPP_DISPATCH_COMPLETED']
        WHEN 'ERROR_OCCURRED'     THEN ARRAY['JOB_FAILED','WHATSAPP_DISPATCH_FAILED']
        WHEN 'PLAN_CHANGED'       THEN ARRAY['SUBSCRIPTION_PLAN_CHANGED']
        WHEN 'AI_REPLIED'         THEN ARRAY['SUPORTE_AI_REPLY','WHATSAPP_AI_REPLY']
        WHEN 'HUMAN_TAKEOVER'     THEN ARRAY['SUPORTE_HANDOFF','WHATSAPP_HUMAN_TAKEOVER']
        ELSE ARRAY[]::text[]   -- LOGOUT / CLIENT_CREATED: sem emissor (dependencia futura)
      END;
    END LOOP;
  END IF;

  -- Sem action codes resolvidos => conjunto vazio sem erro.
  IF array_length(v_actions, 1) IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT count(*) INTO v_total FROM admin_audit_logs
   WHERE action = ANY(v_actions)
     AND (p_from IS NULL OR created_at >= p_from)
     AND (p_to   IS NULL OR created_at <= p_to)
     AND (p_actor IS NULL OR admin_id = p_actor)
     AND (p_target_type IS NULL OR target_type = p_target_type);

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      l.created_at AS occurred_at,
      CASE l.action
        WHEN 'ADMIN_LOGIN_SUCCESS'           THEN 'LOGIN'
        WHEN 'WHATSAPP_DISPATCH_STARTED'     THEN 'DISPATCH_STARTED'
        WHEN 'WHATSAPP_DISPATCH_COMPLETED'   THEN 'DISPATCH_COMPLETED'
        WHEN 'JOB_FAILED'                    THEN 'ERROR_OCCURRED'
        WHEN 'WHATSAPP_DISPATCH_FAILED'      THEN 'ERROR_OCCURRED'
        WHEN 'SUBSCRIPTION_PLAN_CHANGED'     THEN 'PLAN_CHANGED'
        WHEN 'SUPORTE_AI_REPLY'              THEN 'AI_REPLIED'
        WHEN 'WHATSAPP_AI_REPLY'             THEN 'AI_REPLIED'
        WHEN 'SUPORTE_HANDOFF'               THEN 'HUMAN_TAKEOVER'
        WHEN 'WHATSAPP_HUMAN_TAKEOVER'       THEN 'HUMAN_TAKEOVER'
        ELSE 'ERROR_OCCURRED'
      END AS event_type,
      l.admin_id AS actor,
      l.target_type,
      l.target_id,
      -- summary: rotulo pt-BR fixo (sem PII/segredos)
      CASE l.action
        WHEN 'ADMIN_LOGIN_SUCCESS'           THEN 'Login realizado'
        WHEN 'WHATSAPP_DISPATCH_STARTED'     THEN 'Disparo iniciado'
        WHEN 'WHATSAPP_DISPATCH_COMPLETED'   THEN 'Disparo concluído'
        WHEN 'JOB_FAILED'                    THEN 'Erro ocorrido'
        WHEN 'WHATSAPP_DISPATCH_FAILED'      THEN 'Erro ocorrido'
        WHEN 'SUBSCRIPTION_PLAN_CHANGED'     THEN 'Plano alterado'
        WHEN 'SUPORTE_AI_REPLY'              THEN 'IA respondeu'
        WHEN 'WHATSAPP_AI_REPLY'             THEN 'IA respondeu'
        WHEN 'SUPORTE_HANDOFF'               THEN 'Atendimento humano assumiu'
        WHEN 'WHATSAPP_HUMAN_TAKEOVER'       THEN 'Atendimento humano assumiu'
        ELSE 'Evento'
      END AS summary
    FROM admin_audit_logs l
    WHERE l.action = ANY(v_actions)
      AND (p_from IS NULL OR l.created_at >= p_from)
      AND (p_to   IS NULL OR l.created_at <= p_to)
      AND (p_actor IS NULL OR l.admin_id = p_actor)
      AND (p_target_type IS NULL OR l.target_type = p_target_type)
    ORDER BY l.created_at DESC, l.action ASC, l.id ASC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$func$;

REVOKE ALL ON FUNCTION admin_logs_list(text[], timestamptz, timestamptz, uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_logs_list(text[], timestamptz, timestamptz, uuid, text, int, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPC admin_alerts_evaluate (Req 7) — service-role (pg_cron) OU ALERT_VIEW
-- ────────────────────────────────────────────────────────────────────────────
-- Gating: auth.uid() NULL => contexto confiavel (pg_cron/service_role; anon nao
-- tem EXECUTE) => prossegue. auth.uid() presente => exige ALERT_VIEW. Cada fonte
-- em sub-bloco BEGIN..EXCEPTION (falha => ALERT_SOURCE_FAILED se houver caller, e
-- prossegue). Reconcilia via INSERT ... ON CONFLICT (indice unico parcial) DO
-- UPDATE last_seen_at (abre OU toca) e auto-resolve os ativos sem situacao.
CREATE OR REPLACE FUNCTION admin_alerts_evaluate(
  p_expiring_window_days int DEFAULT 3, p_awaiting_threshold_min int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_now      timestamptz := now();
  v_exp_days int := GREATEST(COALESCE(p_expiring_window_days, 3), 0);
  v_await    int := GREATEST(COALESCE(p_awaiting_threshold_min, 30), 0);
  v_opened   int := 0;
  v_touched  int := 0;
  v_resolved int := 0;
  v_inserted boolean;
  rec        record;
BEGIN
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('ALERT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ALERT_VIEW_DENIED', 'system_alerts', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: ALERT_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Situacoes ativas coletadas em temp table (ON COMMIT DROP).
  CREATE TEMP TABLE IF NOT EXISTS _operacao_sit (
    dedup_key text PRIMARY KEY, alert_type text, severity text,
    source_type text, source_id text, title text
  ) ON COMMIT DROP;
  DELETE FROM _operacao_sit;

  -- fonte: whatsapp_sessions => WHATSAPP_DISCONNECTED
  BEGIN
    INSERT INTO _operacao_sit
    SELECT 'WHATSAPP_DISCONNECTED:whatsapp_session:'||s.instance_id::text,
           'WHATSAPP_DISCONNECTED','CRITICAL','whatsapp_session', s.instance_id::text,
           'WhatsApp desconectado'
    FROM whatsapp_sessions s WHERE s.status IN ('DISCONNECTED','EXPIRED')
    ON CONFLICT (dedup_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    IF v_caller IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'ALERT_SOURCE_FAILED', 'whatsapp_sessions', NULL, NULL,
              jsonb_build_object('source','whatsapp_sessions','sqlstate', SQLSTATE));
    END IF;
  END;

  -- fonte: whatsapp_dispatch_jobs => CAMPAIGN_PAUSED / CAMPAIGN_ERROR
  BEGIN
    INSERT INTO _operacao_sit
    SELECT 'CAMPAIGN_PAUSED:dispatch_job:'||j.id::text,'CAMPAIGN_PAUSED','WARNING',
           'dispatch_job', j.id::text, 'Campanha pausada'
    FROM whatsapp_dispatch_jobs j WHERE j.status = 'PAUSED'
    ON CONFLICT (dedup_key) DO NOTHING;
    INSERT INTO _operacao_sit
    SELECT 'CAMPAIGN_ERROR:dispatch_job:'||j.id::text,'CAMPAIGN_ERROR','CRITICAL',
           'dispatch_job', j.id::text, 'Campanha com erro'
    FROM whatsapp_dispatch_jobs j WHERE j.status = 'FAILED'
    ON CONFLICT (dedup_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    IF v_caller IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'ALERT_SOURCE_FAILED', 'whatsapp_dispatch_jobs', NULL, NULL,
              jsonb_build_object('source','whatsapp_dispatch_jobs','sqlstate', SQLSTATE));
    END IF;
  END;

  -- fonte: subscriptions => SUBSCRIPTION_EXPIRING (ativa vencendo na janela)
  BEGIN
    INSERT INTO _operacao_sit
    SELECT 'SUBSCRIPTION_EXPIRING:subscription:'||sub.user_id::text,'SUBSCRIPTION_EXPIRING','WARNING',
           'subscription', sub.user_id::text, 'Assinatura vencendo'
    FROM subscriptions sub
    WHERE sub.status = 'active' AND sub.next_charge_at IS NOT NULL
      AND sub.next_charge_at >= v_now
      AND sub.next_charge_at <= v_now + make_interval(days => v_exp_days)
    ON CONFLICT (dedup_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    IF v_caller IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'ALERT_SOURCE_FAILED', 'subscriptions', NULL, NULL,
              jsonb_build_object('source','subscriptions','sqlstate', SQLSTATE));
    END IF;
  END;

  -- fonte: support_tickets => CUSTOMER_AWAITING (handoff humano alem do threshold)
  BEGIN
    INSERT INTO _operacao_sit
    SELECT 'CUSTOMER_AWAITING:support_ticket:'||t.id::text,'CUSTOMER_AWAITING','WARNING',
           'support_ticket', t.id::text, 'Cliente aguardando resposta'
    FROM support_tickets t
    WHERE t.status NOT IN ('resolved','closed') AND t.responder_mode = 'human'
      AND t.handoff_at IS NOT NULL
      AND t.handoff_at <= v_now - make_interval(mins => v_await)
    ON CONFLICT (dedup_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    IF v_caller IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'ALERT_SOURCE_FAILED', 'support_tickets', NULL, NULL,
              jsonb_build_object('source','support_tickets','sqlstate', SQLSTATE));
    END IF;
  END;

  -- abre (novo) OU toca (ja ativo) cada situacao; o indice unico parcial garante
  -- <= 1 ativo por dedup_key. (xmax = 0) distingue INSERT de UPDATE.
  FOR rec IN SELECT * FROM _operacao_sit LOOP
    INSERT INTO system_alerts(alert_type, severity, state, source_type, source_id, dedup_key, title)
    VALUES (rec.alert_type, rec.severity, 'OPEN', rec.source_type, rec.source_id, rec.dedup_key, rec.title)
    ON CONFLICT (dedup_key) WHERE state IN ('OPEN','ACKNOWLEDGED')
    DO UPDATE SET last_seen_at = now()
    RETURNING (xmax = 0) INTO v_inserted;

    IF v_inserted THEN
      v_opened := v_opened + 1;
      IF v_caller IS NOT NULL THEN
        INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
        VALUES (v_caller, 'ALERT_GENERATED', 'system_alerts', rec.source_id, NULL,
                jsonb_build_object('alert_type', rec.alert_type, 'dedup_key', rec.dedup_key));
      END IF;
    ELSE
      v_touched := v_touched + 1;
    END IF;
  END LOOP;

  -- auto-resolve: ativos sem situacao correspondente => RESOLVED (resolved_by NULL).
  UPDATE system_alerts
     SET state = 'RESOLVED', resolved_at = now(), resolved_by = NULL
   WHERE state IN ('OPEN','ACKNOWLEDGED')
     AND dedup_key NOT IN (SELECT dedup_key FROM _operacao_sit);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object('opened', v_opened, 'touched', v_touched, 'resolved', v_resolved);
END;
$func$;

REVOKE ALL ON FUNCTION admin_alerts_evaluate(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_alerts_evaluate(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_alerts_evaluate(int, int) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. RPC admin_alert_acknowledge (Req 9.3-9.8) — ALERT_ACK
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_alert_acknowledge(p_id uuid, p_expected_updated_at timestamptz)
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
  IF NOT is_admin_with_permission('ALERT_ACK') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ALERT_VIEW_DENIED', 'system_alerts', p_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: ALERT_ACK required' USING ERRCODE = '42501';
  END IF;

  SELECT state INTO v_state FROM system_alerts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: alert' USING ERRCODE = 'P0002';
  END IF;
  IF v_state = 'ACKNOWLEDGED' THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ALERT_ACK_SKIPPED', 'system_alerts', p_id::text, NULL,
            jsonb_build_object('reason','ALREADY_ACKNOWLEDGED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_ACKNOWLEDGED');
  END IF;
  IF v_state = 'RESOLVED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: RESOLVED cannot be acknowledged' USING ERRCODE = 'P0001';
  END IF;

  UPDATE system_alerts
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

REVOKE ALL ON FUNCTION admin_alert_acknowledge(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_alert_acknowledge(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. RPC admin_alert_resolve (Req 9.3-9.8) — ALERT_RESOLVE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_alert_resolve(p_id uuid, p_expected_updated_at timestamptz)
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
  IF NOT is_admin_with_permission('ALERT_RESOLVE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ALERT_VIEW_DENIED', 'system_alerts', p_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: ALERT_RESOLVE required' USING ERRCODE = '42501';
  END IF;

  SELECT state INTO v_state FROM system_alerts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: alert' USING ERRCODE = 'P0002';
  END IF;
  IF v_state = 'RESOLVED' THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ALERT_RESOLVE_SKIPPED', 'system_alerts', p_id::text, NULL,
            jsonb_build_object('reason','ALREADY_RESOLVED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_RESOLVED');
  END IF;

  UPDATE system_alerts
     SET state = 'RESOLVED', resolved_at = now(), resolved_by = v_caller
   WHERE id = p_id AND state IN ('OPEN','ACKNOWLEDGED') AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_updated;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_updated);
END;
$func$;

REVOKE ALL ON FUNCTION admin_alert_resolve(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_alert_resolve(uuid, timestamptz) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Agendamento de admin_alerts_evaluate via pg_cron (defensivo, espelha 092)
-- ────────────────────────────────────────────────────────────────────────────
DO $cron$
DECLARE
  v_has_cron boolean;
  v_job_name text := 'admin-alerts-evaluate-tick';
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[admin-central-operacao] pg_cron ausente: agendamento de admin_alerts_evaluate IGNORADO neste ambiente (local/test). Em producao hospedada o job sera criado.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule(v_job_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[admin-central-operacao] nenhum job pg_cron "%" pre-existente (ok).', v_job_name;
  END;

  -- Tick por minuto: reconcilia alertas (contexto service-role, auth.uid() nulo).
  PERFORM cron.schedule(v_job_name, '* * * * *', 'SELECT public.admin_alerts_evaluate();');
  RAISE NOTICE '[admin-central-operacao] job pg_cron "%" agendado (tick por minuto).', v_job_name;
END
$cron$;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado; nao executa no apply)
-- ============================================================================
/*
-- 1. Tabela + indice unico parcial
SELECT to_regclass('public.system_alerts');
SELECT indexname FROM pg_indexes WHERE indexname = 'uq_system_alerts_active_dedup';

-- 2. RLS habilitada + policies
SELECT relrowsecurity FROM pg_class WHERE relname = 'system_alerts';
SELECT polname, polcmd, polpermissive FROM pg_policy WHERE polrelid = 'public.system_alerts'::regclass;

-- 3. RBAC reconhece as acoes novas (SUPER_ADMIN/ADMIN => true; demais => false):
--    SELECT is_admin_with_permission('ALERT_VIEW'), is_admin_with_permission('LOG_VIEW');

-- 4. As 6 RPCs presentes
SELECT proname FROM pg_proc WHERE proname IN
  ('admin_operations_metrics','admin_alerts_evaluate','admin_alerts_list',
   'admin_alert_acknowledge','admin_alert_resolve','admin_logs_list') ORDER BY proname;

-- 5. Job pg_cron (em producao hospedada)
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'admin-alerts-evaluate-tick';
*/
