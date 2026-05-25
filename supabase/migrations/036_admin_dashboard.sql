-- ============================================================================
-- Migration 036: Admin Dashboard - Metricas Agregadas
-- ============================================================================
-- Adiciona o modulo de Dashboard analitico do painel administrativo
-- sobre as fundacoes entregues em:
--   - 030_admin_foundation.sql (is_admin_with_permission, admin_audit_logs)
--   - 031_admin_users.sql      (users.ban_reason / banned_at)
--   - 032_admin_fretes.sql     (FRETE_FORCE_CLOSE, RPCs SECURITY DEFINER)
--   - 033_embarcador_branch.sql (embarcadores.branch_state — UF do embarcador)
--   - 035_admin_blacklist.sql  (BLACKLIST_*, is_admin_with_permission ja
--                               atualizada com BLACKLIST_VIEW/MANAGE/BULK)
--
-- ESTA MIGRATION ENTREGA:
--   - 3 indices auxiliares (idx_users_created_at, idx_fretes_created_at,
--     idx_fretes_updated_at_status) — todos via IF NOT EXISTS
--   - Atualizacao de is_admin_with_permission para incluir nova action
--     DASHBOARD_VIEW (SUPER_ADMIN, ADMIN, SUPORTE, FINANCEIRO; MODERADOR negado)
--   - 1 RPC agregadora admin_dashboard_metrics(timestamptz, timestamptz, text, text)
--     STABLE SECURITY DEFINER que retorna jsonb com todos os KPIs, series,
--     geo, security_alerts e top listas em uma unica chamada.
--
-- IDEMPOTENTE: aplicar 2x nao falha nem duplica objetos.
--
-- ROLLBACK: 036_admin_dashboard_rollback.sql documenta DROP da RPC e
-- reversao de is_admin_with_permission para a versao da migration 035.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Validacoes defensivas (aborta migration em dependencia ausente)
-- ============================================================================

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs' AND column_name = 'after_data'
  ) THEN
    RAISE EXCEPTION 'admin_audit_logs.after_data ausente — schema inesperado';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'created_at'
  ) THEN
    RAISE EXCEPTION 'users.created_at ausente — schema inesperado';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fretes' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'fretes.updated_at ausente — schema inesperado';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'embarcadores' AND column_name = 'branch_state'
  ) THEN
    RAISE EXCEPTION 'Migration 033 (embarcador-branch) nao aplicada: embarcadores.branch_state ausente';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'frete_clicks'
  ) THEN
    RAISE EXCEPTION 'Tabela frete_clicks ausente — migration 001 nao aplicada';
  END IF;
END
$check$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'frete_likes'
  ) THEN
    RAISE EXCEPTION 'Migration 021 (frete_likes) nao aplicada';
  END IF;
END
$check$;


-- ============================================================================
-- 2. Indices auxiliares (idempotentes — so cria se ausentes)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fretes_created_at
  ON fretes(created_at DESC);

-- Indice parcial: acelera KPI "Fretes encerrados" e SUM(value) de volume.
CREATE INDEX IF NOT EXISTS idx_fretes_updated_at_status
  ON fretes(updated_at DESC) WHERE status = 'encerrado';


-- ============================================================================
-- 3. Atualizacao de is_admin_with_permission para incluir DASHBOARD_VIEW
-- ============================================================================
-- Mantem todas as actions ja existentes (USER_*, FRETE_*, FINANCEIRO_*,
-- BLACKLIST_*, CRM_*, SUPORTE_*, AUDIT_*, ADMIN_ROLE_*) e adiciona
-- DASHBOARD_VIEW para SUPER_ADMIN, ADMIN, SUPORTE, FINANCEIRO. MODERADOR negado.
-- ============================================================================

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
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT',
            'AUDIT_VIEW','DASHBOARD_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW',
            'BLACKLIST_VIEW','DASHBOARD_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_MANAGE'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;



-- ============================================================================
-- 4. Funcao admin_dashboard_metrics — RPC agregadora STABLE SECURITY DEFINER
-- ============================================================================
-- Retorna jsonb consolidado com KPIs, series temporais (zero-fill com
-- generate_series), agregacao geografica por UF, alertas de seguranca 24h,
-- e top listas (embarcadores, motoristas, rotas).
--
-- Gating server-side:
--   - Sub-objetos volume_transacionado, top_embarcadores, series.volume_diario
--     retornam 'null'::jsonb quando o admin nao tem FINANCEIRO_VIEW.
--   - Sub-objetos logins_admin, alertas_seguranca_24h, security_alerts
--     retornam 'null'::jsonb quando o admin nao tem AUDIT_VIEW.
--
-- Tentativa sem DASHBOARD_VIEW gera log DASHBOARD_VIEW_DENIED + RAISE.
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_dashboard_metrics(
  p_from      timestamptz,
  p_to        timestamptz,
  p_user_type text,
  p_uf        text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_has_fin   boolean;
  v_has_audit boolean;
  v_prev_from timestamptz;
  v_prev_to   timestamptz;
  v_days      int;
  v_uf_set    text[] := ARRAY[
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
    'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ];
  v_user_type text;
  v_result    jsonb;
BEGIN
  -- 1) Auth check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- 2) Permission check + log de denial em caso de bypass
  IF NOT is_admin_with_permission('DASHBOARD_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'DASHBOARD_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: DASHBOARD_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- 3) Validacoes de input
  IF p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD: p_to must be >= p_from' USING ERRCODE = '22023';
  END IF;
  IF (p_to - p_from) > INTERVAL '365 days' THEN
    RAISE EXCEPTION 'INVALID_PERIOD: max 365 days' USING ERRCODE = '22023';
  END IF;

  v_user_type := COALESCE(p_user_type, 'all');
  IF v_user_type NOT IN ('all','motorista','embarcador') THEN
    RAISE EXCEPTION 'INVALID_USER_TYPE: %', p_user_type USING ERRCODE = '22023';
  END IF;
  IF p_uf IS NOT NULL AND NOT (p_uf = ANY(v_uf_set)) THEN
    RAISE EXCEPTION 'INVALID_UF: %', p_uf USING ERRCODE = '22023';
  END IF;

  -- 4) Gating granular
  v_has_fin   := is_admin_with_permission('FINANCEIRO_VIEW');
  v_has_audit := is_admin_with_permission('AUDIT_VIEW');

  -- 5) Periodo anterior derivado
  v_prev_to   := p_from;
  v_prev_from := p_from - (p_to - p_from);
  v_days      := GREATEST(1, (p_to::date - p_from::date) + 1);

  -- 6) Construcao agregada com sub-CTEs
  WITH
    kpi_current AS (
      SELECT
        (SELECT COUNT(*) FROM users u
           LEFT JOIN embarcadores e ON e.id = u.id
           WHERE u.is_active = true
             AND (v_user_type = 'all' OR u.user_type = v_user_type)
             AND (p_uf IS NULL
                  OR (u.user_type = 'embarcador' AND e.branch_state = p_uf)
                  OR u.user_type = 'motorista'
                 )
        ) AS usuarios_ativos,
        (SELECT COUNT(*) FROM users u
           LEFT JOIN embarcadores e ON e.id = u.id
           WHERE u.created_at >= p_from AND u.created_at <= p_to
             AND (v_user_type = 'all' OR u.user_type = v_user_type)
             AND (p_uf IS NULL
                  OR (u.user_type = 'embarcador' AND e.branch_state = p_uf)
                  OR u.user_type = 'motorista'
                 )
        ) AS novos_cadastros,
        (SELECT COUNT(*) FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.status = 'ativo'
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS fretes_ativos,
        (SELECT COUNT(*) FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.created_at >= p_from AND f.created_at <= p_to
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS fretes_postados,
        (SELECT COUNT(*) FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.status = 'encerrado'
             AND f.updated_at >= p_from AND f.updated_at <= p_to
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS fretes_encerrados,
        (SELECT
           CASE WHEN postados = 0 THEN NULL
                ELSE ROUND((encerrados::numeric / postados::numeric) * 100, 2)
           END
           FROM (
             SELECT
               (SELECT COUNT(*) FROM fretes f LEFT JOIN embarcadores e ON e.id = f.embarcador_id
                  WHERE f.created_at >= p_from AND f.created_at <= p_to
                    AND (p_uf IS NULL OR e.branch_state = p_uf)) AS postados,
               (SELECT COUNT(*) FROM fretes f LEFT JOIN embarcadores e ON e.id = f.embarcador_id
                  WHERE f.status = 'encerrado'
                    AND f.updated_at >= p_from AND f.updated_at <= p_to
                    AND (p_uf IS NULL OR e.branch_state = p_uf)) AS encerrados
           ) t
        ) AS taxa_conversao,
        (SELECT COALESCE(SUM(f.value), 0)::numeric FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.status = 'encerrado'
             AND f.updated_at >= p_from AND f.updated_at <= p_to
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS volume,
        (SELECT COUNT(*) FROM admin_audit_logs
           WHERE action = 'ADMIN_LOGIN_SUCCESS'
             AND created_at >= p_from AND created_at <= p_to
        ) AS logins,
        (SELECT COUNT(*) FROM admin_audit_logs
           WHERE action IN (
             'ADMIN_LOGIN_FAILURE','BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED',
             'BLACKLIST_EMAIL_BLOCKED','ADMIN_STEALTH_BLOCK','ADMIN_LOCKOUT'
           )
           AND created_at > NOW() - INTERVAL '24 hours'
        ) AS alertas
    ),

    kpi_previous AS (
      SELECT
        -- Sem historico de is_active: usa snapshot atual (variacao tende a 0)
        (SELECT COUNT(*) FROM users u
           LEFT JOIN embarcadores e ON e.id = u.id
           WHERE u.is_active = true
             AND (v_user_type = 'all' OR u.user_type = v_user_type)
             AND (p_uf IS NULL
                  OR (u.user_type = 'embarcador' AND e.branch_state = p_uf)
                  OR u.user_type = 'motorista'
                 )
        ) AS usuarios_ativos,
        (SELECT COUNT(*) FROM users u
           LEFT JOIN embarcadores e ON e.id = u.id
           WHERE u.created_at >= v_prev_from AND u.created_at <= v_prev_to
             AND (v_user_type = 'all' OR u.user_type = v_user_type)
             AND (p_uf IS NULL
                  OR (u.user_type = 'embarcador' AND e.branch_state = p_uf)
                  OR u.user_type = 'motorista'
                 )
        ) AS novos_cadastros,
        (SELECT COUNT(*) FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.status = 'ativo'
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS fretes_ativos,
        (SELECT COUNT(*) FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.created_at >= v_prev_from AND f.created_at <= v_prev_to
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS fretes_postados,
        (SELECT COUNT(*) FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.status = 'encerrado'
             AND f.updated_at >= v_prev_from AND f.updated_at <= v_prev_to
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS fretes_encerrados,
        (SELECT
           CASE WHEN postados = 0 THEN NULL
                ELSE ROUND((encerrados::numeric / postados::numeric) * 100, 2)
           END
           FROM (
             SELECT
               (SELECT COUNT(*) FROM fretes f LEFT JOIN embarcadores e ON e.id = f.embarcador_id
                  WHERE f.created_at >= v_prev_from AND f.created_at <= v_prev_to
                    AND (p_uf IS NULL OR e.branch_state = p_uf)) AS postados,
               (SELECT COUNT(*) FROM fretes f LEFT JOIN embarcadores e ON e.id = f.embarcador_id
                  WHERE f.status = 'encerrado'
                    AND f.updated_at >= v_prev_from AND f.updated_at <= v_prev_to
                    AND (p_uf IS NULL OR e.branch_state = p_uf)) AS encerrados
           ) t
        ) AS taxa_conversao,
        (SELECT COALESCE(SUM(f.value), 0)::numeric FROM fretes f
           LEFT JOIN embarcadores e ON e.id = f.embarcador_id
           WHERE f.status = 'encerrado'
             AND f.updated_at >= v_prev_from AND f.updated_at <= v_prev_to
             AND (p_uf IS NULL OR e.branch_state = p_uf)
        ) AS volume,
        (SELECT COUNT(*) FROM admin_audit_logs
           WHERE action = 'ADMIN_LOGIN_SUCCESS'
             AND created_at >= v_prev_from AND created_at <= v_prev_to
        ) AS logins,
        -- alertas previous: janela 24h imediatamente anterior (-48h .. -24h)
        (SELECT COUNT(*) FROM admin_audit_logs
           WHERE action IN (
             'ADMIN_LOGIN_FAILURE','BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED',
             'BLACKLIST_EMAIL_BLOCKED','ADMIN_STEALTH_BLOCK','ADMIN_LOCKOUT'
           )
           AND created_at > NOW() - INTERVAL '48 hours'
           AND created_at <= NOW() - INTERVAL '24 hours'
        ) AS alertas
    ),

    -- Series temporais com zero-fill
    series_cad_mot AS (
      SELECT to_char(d::date, 'YYYY-MM-DD') AS d, COALESCE(c.cnt, 0)::int AS v
      FROM generate_series(p_from::date, p_to::date, '1 day') d
      LEFT JOIN (
        SELECT date_trunc('day', u.created_at)::date AS bucket, COUNT(*) AS cnt
        FROM users u
        LEFT JOIN embarcadores e ON e.id = u.id
        WHERE u.user_type = 'motorista'
          AND u.created_at >= p_from AND u.created_at <= p_to
          AND v_user_type IN ('all','motorista')
          AND (p_uf IS NULL OR u.user_type = 'motorista')
        GROUP BY 1
      ) c ON c.bucket = d::date
    ),

    series_cad_emb AS (
      SELECT to_char(d::date, 'YYYY-MM-DD') AS d, COALESCE(c.cnt, 0)::int AS v
      FROM generate_series(p_from::date, p_to::date, '1 day') d
      LEFT JOIN (
        SELECT date_trunc('day', u.created_at)::date AS bucket, COUNT(*) AS cnt
        FROM users u
        LEFT JOIN embarcadores e ON e.id = u.id
        WHERE u.user_type = 'embarcador'
          AND u.created_at >= p_from AND u.created_at <= p_to
          AND v_user_type IN ('all','embarcador')
          AND (p_uf IS NULL OR e.branch_state = p_uf)
        GROUP BY 1
      ) c ON c.bucket = d::date
    ),

    series_fre_post AS (
      SELECT to_char(d::date, 'YYYY-MM-DD') AS d, COALESCE(c.cnt, 0)::int AS v
      FROM generate_series(p_from::date, p_to::date, '1 day') d
      LEFT JOIN (
        SELECT date_trunc('day', f.created_at)::date AS bucket, COUNT(*) AS cnt
        FROM fretes f
        LEFT JOIN embarcadores e ON e.id = f.embarcador_id
        WHERE f.created_at >= p_from AND f.created_at <= p_to
          AND (p_uf IS NULL OR e.branch_state = p_uf)
        GROUP BY 1
      ) c ON c.bucket = d::date
    ),

    series_fre_enc AS (
      SELECT to_char(d::date, 'YYYY-MM-DD') AS d, COALESCE(c.cnt, 0)::int AS v
      FROM generate_series(p_from::date, p_to::date, '1 day') d
      LEFT JOIN (
        SELECT date_trunc('day', f.updated_at)::date AS bucket, COUNT(*) AS cnt
        FROM fretes f
        LEFT JOIN embarcadores e ON e.id = f.embarcador_id
        WHERE f.status = 'encerrado'
          AND f.updated_at >= p_from AND f.updated_at <= p_to
          AND (p_uf IS NULL OR e.branch_state = p_uf)
        GROUP BY 1
      ) c ON c.bucket = d::date
    ),

    series_volume AS (
      SELECT to_char(d::date, 'YYYY-MM-DD') AS d, COALESCE(c.total, 0)::numeric AS v
      FROM generate_series(p_from::date, p_to::date, '1 day') d
      LEFT JOIN (
        SELECT date_trunc('day', f.updated_at)::date AS bucket, SUM(f.value) AS total
        FROM fretes f
        LEFT JOIN embarcadores e ON e.id = f.embarcador_id
        WHERE f.status = 'encerrado'
          AND f.updated_at >= p_from AND f.updated_at <= p_to
          AND (p_uf IS NULL OR e.branch_state = p_uf)
        GROUP BY 1
      ) c ON c.bucket = d::date
    ),

    -- Agregacao geografica
    geo_fretes AS (
      SELECT e.branch_state AS uf, COUNT(*)::int AS cnt
      FROM fretes f
      JOIN embarcadores e ON e.id = f.embarcador_id
      WHERE f.status = 'ativo'
        AND e.branch_state IS NOT NULL
        AND (p_uf IS NULL OR e.branch_state = p_uf)
      GROUP BY e.branch_state
    ),

    geo_usuarios AS (
      SELECT
        COALESCE(e.branch_state, '??') AS uf,
        SUM(CASE WHEN u.user_type = 'motorista' THEN 1 ELSE 0 END)::int AS m,
        SUM(CASE WHEN u.user_type = 'embarcador' THEN 1 ELSE 0 END)::int AS emb
      FROM users u
      LEFT JOIN embarcadores e ON e.id = u.id
      WHERE u.is_active = true
        AND e.branch_state IS NOT NULL
        AND (p_uf IS NULL OR e.branch_state = p_uf)
        AND (v_user_type = 'all' OR u.user_type = v_user_type)
      GROUP BY e.branch_state
    ),

    -- Alertas de seguranca 24h FIXO (ignora p_from/p_to)
    sec_alerts AS (
      SELECT
        action,
        COUNT(*)::int AS cnt,
        MAX(created_at) AS last_at,
        (ARRAY_AGG(target_id ORDER BY created_at DESC))[1] AS sample_target_id
      FROM admin_audit_logs
      WHERE action IN (
        'ADMIN_LOGIN_FAILURE','ADMIN_LOCKOUT','ADMIN_STEALTH_BLOCK',
        'BLACKLIST_LOGIN_BLOCKED','BLACKLIST_SIGNUP_BLOCKED','BLACKLIST_EMAIL_BLOCKED',
        'USER_BANNED'
      )
      AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY action
      ORDER BY MAX(created_at) DESC
      LIMIT 10
    ),

    -- Top embarcadores por volume
    top_emb AS (
      SELECT
        u.id, u.name,
        COALESCE(SUM(f.value), 0)::numeric AS volume_total,
        COUNT(f.id)::int AS fretes_count
      FROM users u
      JOIN embarcadores e ON e.id = u.id
      LEFT JOIN fretes f ON f.embarcador_id = u.id
        AND f.status = 'encerrado'
        AND f.updated_at >= p_from AND f.updated_at <= p_to
      WHERE u.user_type = 'embarcador'
        AND (p_uf IS NULL OR e.branch_state = p_uf)
      GROUP BY u.id, u.name
      HAVING COUNT(f.id) > 0
      ORDER BY volume_total DESC, u.id
      LIMIT 5
    ),

    -- Top motoristas por interacoes (cliques + curtidas)
    top_mot AS (
      SELECT
        u.id, u.name,
        COALESCE(c.cliques, 0)::int AS cliques,
        COALESCE(l.curtidas, 0)::int AS curtidas
      FROM users u
      LEFT JOIN (
        SELECT fc.motorista_id, COUNT(*) AS cliques
        FROM frete_clicks fc
        WHERE fc.clicked_at >= p_from AND fc.clicked_at <= p_to
        GROUP BY fc.motorista_id
      ) c ON c.motorista_id = u.id
      LEFT JOIN (
        SELECT fl.motorista_id, COUNT(*) AS curtidas
        FROM frete_likes fl
        WHERE fl.created_at >= p_from AND fl.created_at <= p_to
        GROUP BY fl.motorista_id
      ) l ON l.motorista_id = u.id
      WHERE u.user_type = 'motorista'
        AND (COALESCE(c.cliques,0) + COALESCE(l.curtidas,0)) > 0
      ORDER BY (COALESCE(c.cliques,0) + COALESCE(l.curtidas,0)) DESC, u.id
      LIMIT 5
    ),

    -- Top rotas (origem -> destino) agregado
    top_rot AS (
      SELECT
        LOWER(TRIM(f.origin))      AS origin,
        LOWER(TRIM(f.destination)) AS destination,
        COUNT(*)::int              AS cnt
      FROM fretes f
      LEFT JOIN embarcadores e ON e.id = f.embarcador_id
      WHERE f.created_at >= p_from AND f.created_at <= p_to
        AND f.origin IS NOT NULL AND f.destination IS NOT NULL
        AND (p_uf IS NULL OR e.branch_state = p_uf)
      GROUP BY 1, 2
      ORDER BY cnt DESC, origin, destination
      LIMIT 5
    )

  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'from', to_char(p_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'to',   to_char(p_to   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'user_type', v_user_type,
      'uf', p_uf,
      'previous_from', to_char(v_prev_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'previous_to',   to_char(v_prev_to   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'days', v_days,
      'generated_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'kpis', jsonb_build_object(
      'usuarios_ativos',
        jsonb_build_object('value', (SELECT usuarios_ativos FROM kpi_current),
                           'previous_value', (SELECT usuarios_ativos FROM kpi_previous)),
      'novos_cadastros',
        jsonb_build_object('value', (SELECT novos_cadastros FROM kpi_current),
                           'previous_value', (SELECT novos_cadastros FROM kpi_previous)),
      'fretes_ativos',
        jsonb_build_object('value', (SELECT fretes_ativos FROM kpi_current),
                           'previous_value', (SELECT fretes_ativos FROM kpi_previous)),
      'fretes_postados',
        jsonb_build_object('value', (SELECT fretes_postados FROM kpi_current),
                           'previous_value', (SELECT fretes_postados FROM kpi_previous)),
      'fretes_encerrados',
        jsonb_build_object('value', (SELECT fretes_encerrados FROM kpi_current),
                           'previous_value', (SELECT fretes_encerrados FROM kpi_previous)),
      'taxa_conversao_pct',
        jsonb_build_object('value', (SELECT taxa_conversao FROM kpi_current),
                           'previous_value', (SELECT taxa_conversao FROM kpi_previous)),
      'volume_transacionado', CASE WHEN v_has_fin THEN
        jsonb_build_object('value', (SELECT volume FROM kpi_current),
                           'previous_value', (SELECT volume FROM kpi_previous))
        ELSE 'null'::jsonb END,
      'logins_admin', CASE WHEN v_has_audit THEN
        jsonb_build_object('value', (SELECT logins FROM kpi_current),
                           'previous_value', (SELECT logins FROM kpi_previous))
        ELSE 'null'::jsonb END,
      'alertas_seguranca_24h', CASE WHEN v_has_audit THEN
        jsonb_build_object('value', (SELECT alertas FROM kpi_current),
                           'previous_value', (SELECT alertas FROM kpi_previous))
        ELSE 'null'::jsonb END
    ),
    'series', jsonb_build_object(
      'cadastros_motoristas',
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', v) ORDER BY d), '[]'::jsonb)
         FROM series_cad_mot),
      'cadastros_embarcadores',
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', v) ORDER BY d), '[]'::jsonb)
         FROM series_cad_emb),
      'fretes_postados',
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', v) ORDER BY d), '[]'::jsonb)
         FROM series_fre_post),
      'fretes_encerrados',
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', v) ORDER BY d), '[]'::jsonb)
         FROM series_fre_enc),
      'volume_diario', CASE WHEN v_has_fin THEN
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', v) ORDER BY d), '[]'::jsonb)
         FROM series_volume)
        ELSE 'null'::jsonb END
    ),
    'geo', jsonb_build_object(
      'fretes_ativos',
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('uf', uf, 'count', cnt) ORDER BY cnt DESC, uf), '[]'::jsonb)
         FROM geo_fretes),
      'usuarios_ativos',
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('uf', uf, 'motoristas', m,
                                                       'embarcadores', emb, 'total', m + emb)
                                   ORDER BY (m + emb) DESC, uf), '[]'::jsonb)
         FROM geo_usuarios)
    ),
    'security_alerts', CASE WHEN v_has_audit THEN
      jsonb_build_object('items',
        (SELECT COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'action', action,
                    'count', cnt,
                    'last_at', to_char(last_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'sample_target_id', sample_target_id
                  ) ORDER BY last_at DESC), '[]'::jsonb) FROM sec_alerts))
      ELSE 'null'::jsonb END,
    'top_embarcadores', CASE WHEN v_has_fin THEN
      jsonb_build_object('items',
        (SELECT COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'id', id,
                    'name', name,
                    'volume_total', volume_total,
                    'fretes_encerrados', fretes_count
                  ) ORDER BY volume_total DESC, id), '[]'::jsonb) FROM top_emb))
      ELSE 'null'::jsonb END,
    'top_motoristas', jsonb_build_object('items',
      (SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'id', id,
                  'name', name,
                  'cliques', cliques,
                  'curtidas', curtidas,
                  'total', cliques + curtidas
                ) ORDER BY (cliques + curtidas) DESC, id), '[]'::jsonb) FROM top_mot)),
    'top_rotas', jsonb_build_object('items',
      (SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'origin', origin,
                  'destination', destination,
                  'label', origin || ' → ' || destination,
                  'count', cnt
                ) ORDER BY cnt DESC, origin, destination), '[]'::jsonb) FROM top_rot))
  )
  INTO v_result;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION admin_dashboard_metrics(timestamptz, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_dashboard_metrics(timestamptz, timestamptz, text, text) TO authenticated;


-- ============================================================================
-- 5. Verificacao pos-deploy (comentada — descomentar pontualmente)
-- ============================================================================
/*
-- 1. Funcao admin_dashboard_metrics existe
SELECT proname, pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
WHERE proname = 'admin_dashboard_metrics';
-- Esperado: 1 linha com args
--   p_from timestamp with time zone, p_to timestamp with time zone,
--   p_user_type text, p_uf text

-- 2. is_admin_with_permission reconhece DASHBOARD_VIEW
SELECT is_admin_with_permission('DASHBOARD_VIEW');
-- Esperado em sessao SUPER_ADMIN/ADMIN/SUPORTE/FINANCEIRO: true
-- Esperado em sessao MODERADOR: false

-- 3. Indices auxiliares existem
SELECT indexname FROM pg_indexes
WHERE indexname IN ('idx_users_created_at','idx_fretes_created_at','idx_fretes_updated_at_status');
-- Esperado: 3 linhas

-- 4. Smoke test: chamada agregada (executar como SUPER_ADMIN logado)
SELECT admin_dashboard_metrics(NOW() - INTERVAL '7 days', NOW(), 'all', NULL);
-- Esperado: jsonb com chaves meta, kpis, series, geo,
--   security_alerts, top_embarcadores, top_motoristas, top_rotas

-- 5. Validacao de gating server-side: admin sem AUDIT_VIEW recebe nulls
--    em logins_admin / alertas_seguranca_24h / security_alerts
SELECT
  admin_dashboard_metrics(NOW() - INTERVAL '7 days', NOW(), 'all', NULL)
    -> 'kpis' -> 'logins_admin'
    AS logins_admin_para_admin_atual;
-- Esperado:
--   - SUPER_ADMIN/ADMIN/FINANCEIRO/SUPORTE com AUDIT_VIEW: { value, previous_value }
--   - sem AUDIT_VIEW: null (jsonb null literal)

-- 6. Validacao de erro INVALID_PERIOD
SELECT admin_dashboard_metrics(NOW(), NOW() - INTERVAL '1 day', 'all', NULL);
-- Esperado: ERROR INVALID_PERIOD: p_to must be >= p_from
*/

COMMIT;
