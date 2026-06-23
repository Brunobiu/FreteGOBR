-- ============================================================================
-- Migration 124: Rastreamento Inteligente (PatGo) — Tracking_Module
-- ============================================================================
-- Spec: .kiro/specs/admin-rastreamento-inteligente/{requirements,design,tasks}.md
--
-- NUCLEO NOVO de deteccao/decisao/orquestracao da aba /admin/rastreamento.
-- Decisao de escopo: "Modulo focado + reuso" — NAO recria nem quebra
-- whatsapp-automation (092-114), admin-assistant (047), suporte-inteligente
-- (115), admin-cliente-360 (116), central-operacao (117), ia-supervisora (118).
--
-- ENTREGA:
--   - 4 tabelas novas: journey_events, tracking_visitor_identities,
--     recovery_attempts, tracking_ai_config (dominios fechados via CHECK).
--   - RLS admin-only: SELECT sob RASTREAMENTO_VIEW; DML direto sempre negado
--     (escrita so via RPC SECURITY DEFINER). journey_events SEM policy de insert
--     (ingestao so pela RPC anonima write-only).
--   - RBAC: re-assercao de is_admin_with_permission PRESERVANDO o corpo vigente
--     (030 + deny-list 047/048 + FAQ_VIEW de 115). RASTREAMENTO_VIEW /
--     RASTREAMENTO_MANAGE reconhecidas POR CONSTRUCAO (SUPER_ADMIN wildcard;
--     ADMIN allow-all menos deny-list; demais papeis negados).
--   - Helpers IMMUTABLE (espelho SQL do nucleo puro TS): tracking_risk_score,
--     tracking_risk_band, tracking_abandonment_cause, tracking_risk_category,
--     tracking_mask_phone; e tracking_recovery_decision (Anti_Spam_Guard).
--   - RPCs SECURITY DEFINER: ingestao anonima write-only, correlacao, leituras
--     gated, mutacoes idempotentes/_SKIPPED/STALE_VERSION, scan automatico e
--     publicacao de sinal em system_alerts.
--   - Ampliacao ADITIVA e nao-destrutiva de system_alerts.alert_type
--     (+ ABANDONMENT_SPIKE) — confirmada pelo dono; revertida no rollback.
--   - Agendamento pg_cron defensivo (nao falha sem a extensao).
--
-- DEPENDENCIAS DURAS (DO $check$): 030 (is_admin_with_permission,
--   admin_audit_logs), users, 092 (whatsapp_dispatch_jobs/_recipients — alvo de
--   FK/delegacao), 117 (system_alerts — alvo da ampliacao aditiva).
-- DEPENDENCIAS MACIAS (NOTICE): 047 (assistant_config) / 042b (supabase_vault) —
--   personalizacao de IA degrada; 116 (admin_global_search) — identificacao.
--
-- IDEMPOTENTE (admin-patterns Sec. 9). Envolvida em BEGIN; ... COMMIT;. Par
--   documentado (nao auto-aplicado): 124_admin_rastreamento_inteligente_rollback.sql.
-- Idioma: identifiers/action codes/error codes em ingles (UPPER_SNAKE);
--   mensagens user-facing pt-BR moram no client.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validacoes defensivas (Req 16.2)
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela users ausente -- schema inesperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='whatsapp_dispatch_jobs') THEN
    RAISE EXCEPTION 'Migration 092 (whatsapp-automation) nao aplicada: whatsapp_dispatch_jobs ausente (alvo de FK)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='system_alerts') THEN
    RAISE EXCEPTION 'Migration 117 (admin-central-operacao) nao aplicada: system_alerts ausente (alvo da ampliacao aditiva)';
  END IF;
END
$check$;

-- Dependencias MACIAS: ausencia degrada em runtime, NAO aborta a migration.
DO $soft$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='assistant_config') THEN
    RAISE NOTICE 'admin-assistant (047) ausente: personalizacao por IA degrada para template padrao (DEFAULT_TEMPLATES).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='admin_global_search') THEN
    RAISE NOTICE 'admin-cliente-360 (116) ausente: identificacao/navegacao por Global_Search degrada.';
  END IF;
END
$soft$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. RBAC — re-assercao de is_admin_with_permission (Req 2.3, 2.4)
-- ────────────────────────────────────────────────────────────────────────────
-- PRESERVA INTEGRALMENTE o corpo on-disk vigente (030 + deny-list 047/048 +
-- FAQ_VIEW concedido ao SUPORTE por 115). RASTREAMENTO_VIEW/RASTREAMENTO_MANAGE
-- sao reconhecidas POR CONSTRUCAO: SUPER_ADMIN (wildcard) e ADMIN (allow-all
-- menos deny-list) as recebem; SUPORTE/FINANCEIRO/MODERADOR (allowlists fechadas
-- que NAO as listam) as negam. Caller anonimo (auth.uid() nulo) => sem linha em
-- `active` => false (autenticacao tem precedencia sobre papel). Sem ramo dedicado.
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
-- 2. Funcao de trigger updated_at (idempotente, local)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tracking_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $touch$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$touch$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Tabelas + indices (Req 3.1, 15.4) — dominios fechados via CHECK
-- ────────────────────────────────────────────────────────────────────────────

-- 3.1 journey_events: eventos de jornada (anonimos ou vinculados a user_id).
CREATE TABLE IF NOT EXISTS journey_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL CHECK (event_type IN (
                'SITE_VISIT','SIGNUP_STARTED','SIGNUP_COMPLETED','SIGNUP_ABANDONED',
                'DOCUMENT_UPLOAD_STARTED','DOCUMENT_UPLOAD_FAILED','DOCUMENT_APPROVED',
                'LOGIN_SUCCEEDED','LOGIN_FAILED','CHECKOUT_STARTED','CHECKOUT_ABANDONED',
                'PAYMENT_STARTED','PAYMENT_FAILED','PAYMENT_SUCCEEDED','SUBSCRIPTION_ACTIVATED',
                'APP_OPENED','APP_CRASH','FREIGHT_VIEWED','FREIGHT_IGNORED','FREIGHT_ACCEPTED',
                'FIRST_FREIGHT_COMPLETED','INACTIVITY_DETECTED','INTERNAL_ERROR','NETWORK_TIMEOUT')),
  surface     text NOT NULL CHECK (surface IN ('SITE','DASHBOARD','APP')),
  user_id     uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  visitor_id  text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- minimo, SEM PII/segredos
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_journey_events_user      ON journey_events (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_journey_events_visitor   ON journey_events (visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_journey_events_type_time ON journey_events (event_type, occurred_at DESC);

COMMENT ON TABLE journey_events IS
  'Eventos de jornada (rastreamento-inteligente / 124). Insercao SO via rpc_tracking_ingest_event (write-only, anon+auth). SELECT admin-only (RASTREAMENTO_VIEW). payload minimo, SEM PII/segredos.';

-- 3.2 tracking_visitor_identities: correlacao visitor_id -> user_id ao autenticar.
CREATE TABLE IF NOT EXISTS tracking_visitor_identities (
  visitor_id    text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  correlated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.3 recovery_attempts: tentativas de recuperacao (durable; base do anti-spam).
CREATE TABLE IF NOT EXISTS recovery_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recovery_scenario text NOT NULL CHECK (recovery_scenario IN
                      ('NEW_SIGNUP_WELCOME','SIGNUP_ABANDONED','PAYMENT_FAILED','USER_INACTIVE','COLD_DRIVER')),
  channel           text NOT NULL DEFAULT 'WHATSAPP',
  dispatch_job_id   uuid NULL REFERENCES whatsapp_dispatch_jobs(id) ON DELETE SET NULL,
  contact_status    text NOT NULL DEFAULT 'CONTACTED' CHECK (contact_status IN
                      ('AT_RISK','CONTACTED','REPLIED','CONVERTED')),
  trigger_event_id  uuid NULL REFERENCES journey_events(id) ON DELETE SET NULL,
  message_hash      text NULL,
  active            boolean NOT NULL DEFAULT true,
  triggered_by      uuid NULL REFERENCES users(id) ON DELETE SET NULL,   -- NULL = automatico
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_user_time ON recovery_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_status    ON recovery_attempts (contact_status, created_at DESC);
-- No_Concurrent: <= 1 ativa por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recovery_active_per_user
  ON recovery_attempts (user_id) WHERE active;
-- 1 mensagem por evento critico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recovery_per_critical_event
  ON recovery_attempts (trigger_event_id) WHERE trigger_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_recovery_attempts_touch ON recovery_attempts;
CREATE TRIGGER trg_recovery_attempts_touch
  BEFORE UPDATE ON recovery_attempts
  FOR EACH ROW EXECUTE FUNCTION tracking_touch_updated_at();

-- 3.4 tracking_ai_config: registro unico (SEM segredo; chave no Vault).
CREATE TABLE IF NOT EXISTS tracking_ai_config (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  active_provider         text NOT NULL DEFAULT 'gemini'
                            CHECK (active_provider IN ('claude','gemini','grok','llama')),
  personalization_enabled boolean NOT NULL DEFAULT false,
  inactivity_days         int NOT NULL DEFAULT 14 CHECK (inactivity_days >= 1),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tracking_ai_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_tracking_ai_config_touch ON tracking_ai_config;
CREATE TRIGGER trg_tracking_ai_config_touch
  BEFORE UPDATE ON tracking_ai_config
  FOR EACH ROW EXECUTE FUNCTION tracking_touch_updated_at();

COMMENT ON TABLE tracking_ai_config IS
  'Config singleton da personalizacao por IA (rastreamento / 124). SEM segredo — a chave do provedor fica no Vault (Provider_Abstraction do admin-assistant 047).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — admin-only; escrita so por RPC; journey_events sem insert direto
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE journey_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_visitor_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_attempts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_ai_config         ENABLE ROW LEVEL SECURITY;

-- journey_events: SELECT sob RASTREAMENTO_VIEW; NENHUMA policy de DML (insercao
-- so via rpc_tracking_ingest_event SECURITY DEFINER, que roda como owner e ignora
-- RLS). Sem leitura por anon; sem acesso cruzado entre usuarios (Req 15.4, 15.5).
DROP POLICY IF EXISTS journey_events_select_admin ON journey_events;
CREATE POLICY journey_events_select_admin ON journey_events
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('RASTREAMENTO_VIEW'));

DROP POLICY IF EXISTS journey_events_no_dml ON journey_events;
CREATE POLICY journey_events_no_dml ON journey_events
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- tracking_visitor_identities / recovery_attempts / tracking_ai_config:
-- SELECT sob RASTREAMENTO_VIEW; DML direto sempre negado (escrita so por RPC).
DROP POLICY IF EXISTS visitor_identities_select_admin ON tracking_visitor_identities;
CREATE POLICY visitor_identities_select_admin ON tracking_visitor_identities
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('RASTREAMENTO_VIEW'));
DROP POLICY IF EXISTS visitor_identities_no_dml ON tracking_visitor_identities;
CREATE POLICY visitor_identities_no_dml ON tracking_visitor_identities
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS recovery_attempts_select_admin ON recovery_attempts;
CREATE POLICY recovery_attempts_select_admin ON recovery_attempts
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('RASTREAMENTO_VIEW'));
DROP POLICY IF EXISTS recovery_attempts_no_dml ON recovery_attempts;
CREATE POLICY recovery_attempts_no_dml ON recovery_attempts
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS tracking_ai_config_select_admin ON tracking_ai_config;
CREATE POLICY tracking_ai_config_select_admin ON tracking_ai_config
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('RASTREAMENTO_VIEW'));
DROP POLICY IF EXISTS tracking_ai_config_no_dml ON tracking_ai_config;
CREATE POLICY tracking_ai_config_no_dml ON tracking_ai_config
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. system_alerts.alert_type — ampliacao ADITIVA e nao-destrutiva (Req 14.1, 14.5)
-- ────────────────────────────────────────────────────────────────────────────
-- Acrescenta ABANDONMENT_SPIKE a uniao dos valores atuais. Superset: nenhum
-- valor/linha/policy/RPC de 117 e removido ou alterado em comportamento. O par
-- rollback restaura o CHECK original. Idempotente (DROP qualquer CHECK de
-- alert_type, depois ADD o ampliado).
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
                          'INTEGRATION_FAILURE','SUBSCRIPTION_EXPIRING','CUSTOMER_AWAITING',
                          'ABANDONMENT_SPIKE'));
END
$alert_type$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Helpers IMMUTABLE — espelho SQL do nucleo puro TS
-- ────────────────────────────────────────────────────────────────────────────

-- 6.1 tracking_mask_phone: mascara preservando DDD + 2 ultimos digitos (sem PII).
CREATE OR REPLACE FUNCTION tracking_mask_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN length(regexp_replace(COALESCE(p_phone,''), '\D', '', 'g')) >= 4
    THEN '(' || substr(regexp_replace(p_phone, '\D', '', 'g'), 1, 2) || ') ****-**'
         || right(regexp_replace(p_phone, '\D', '', 'g'), 2)
    ELSE '****'
  END;
$$;

-- 6.2 tracking_risk_score: soma ponderada clampada a [0,100] (pesos do riskScore.ts).
CREATE OR REPLACE FUNCTION tracking_risk_score(
  p_days int, p_failures int, p_frustrated int, p_refusals int, p_no_conversion int)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT LEAST(100, GREATEST(0, ROUND(
      2 * GREATEST(COALESCE(p_days,0), 0)
    + 8 * GREATEST(COALESCE(p_failures,0), 0)
    + 6 * GREATEST(COALESCE(p_frustrated,0), 0)
    + 5 * GREATEST(COALESCE(p_refusals,0), 0)
    + 15 * (CASE WHEN p_no_conversion = 1 THEN 1 ELSE 0 END)
  )))::int;
$$;

-- 6.3 tracking_risk_band: faixa a partir do score (24/49/74).
CREATE OR REPLACE FUNCTION tracking_risk_band(p_score int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_score <= 24 THEN 'LOW'
    WHEN p_score <= 49 THEN 'MEDIUM'
    WHEN p_score <= 74 THEN 'HIGH'
    ELSE 'CRITICAL'
  END;
$$;

-- 6.4 tracking_abandonment_cause: precedencia total (espelha abandonmentClassifier.ts).
CREATE OR REPLACE FUNCTION tracking_abandonment_cause(
  p_last_relevant text, p_signup_started boolean, p_signup_completed boolean,
  p_freight_refusals int, p_days_since int, p_inactivity_days int)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_cands text[] := ARRAY[]::text[];
BEGIN
  -- causa do evento relevante mais recente
  v_cands := v_cands || CASE p_last_relevant
    WHEN 'APP_CRASH'              THEN ARRAY['APP_CRASH']
    WHEN 'PAYMENT_FAILED'         THEN ARRAY['PAYMENT_DECLINED']
    WHEN 'DOCUMENT_UPLOAD_FAILED' THEN ARRAY['UPLOAD_ERROR']
    WHEN 'LOGIN_FAILED'           THEN ARRAY['LOGIN_FAILURE']
    WHEN 'CHECKOUT_ABANDONED'     THEN ARRAY['CHECKOUT_ABANDONED']
    WHEN 'NETWORK_TIMEOUT'        THEN ARRAY['NETWORK_TIMEOUT']
    WHEN 'INTERNAL_ERROR'         THEN ARRAY['INTERNAL_ERROR']
    WHEN 'SIGNUP_ABANDONED'       THEN ARRAY['SIGNUP_ABANDONED']
    WHEN 'FREIGHT_IGNORED'        THEN ARRAY['FREIGHTS_IGNORED']
    ELSE ARRAY[]::text[] END;
  IF p_signup_started AND NOT p_signup_completed THEN v_cands := v_cands || 'SIGNUP_ABANDONED'; END IF;
  IF COALESCE(p_freight_refusals,0) >= 3 THEN v_cands := v_cands || 'FREIGHTS_IGNORED'; END IF;
  IF COALESCE(p_days_since,0) > COALESCE(p_inactivity_days, 14) THEN v_cands := v_cands || 'PROLONGED_INACTIVITY'; END IF;

  -- precedencia total fixa (== ABANDONMENT_PRECEDENCE)
  RETURN COALESCE((
    SELECT c FROM unnest(ARRAY[
      'APP_CRASH','PAYMENT_DECLINED','UPLOAD_ERROR','LOGIN_FAILURE','CHECKOUT_ABANDONED',
      'SIGNUP_ABANDONED','NETWORK_TIMEOUT','INTERNAL_ERROR','FREIGHTS_IGNORED','PROLONGED_INACTIVITY'
    ]) WITH ORDINALITY AS p(c, ord)
    WHERE c = ANY(v_cands)
    ORDER BY ord ASC LIMIT 1
  ), 'UNKNOWN');
END;
$$;

-- 6.5 tracking_risk_category: mapeia causa -> categoria (espelha deriveRiskCategory).
CREATE OR REPLACE FUNCTION tracking_risk_category(p_cause text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_cause
    WHEN 'SIGNUP_ABANDONED'     THEN 'SIGNUP_ABANDONED'
    WHEN 'PAYMENT_DECLINED'     THEN 'PAYMENT_PENDING'
    WHEN 'CHECKOUT_ABANDONED'   THEN 'PAYMENT_PENDING'
    WHEN 'PROLONGED_INACTIVITY' THEN 'INACTIVE'
    WHEN 'FREIGHTS_IGNORED'     THEN 'COLD_DRIVER'
    WHEN 'UPLOAD_ERROR'         THEN 'RECURRING_ERROR'
    WHEN 'LOGIN_FAILURE'        THEN 'RECURRING_ERROR'
    WHEN 'APP_CRASH'            THEN 'RECURRING_ERROR'
    WHEN 'INTERNAL_ERROR'       THEN 'RECURRING_ERROR'
    WHEN 'NETWORK_TIMEOUT'      THEN 'RECURRING_ERROR'
    ELSE 'INACTIVE'
  END;
$$;

-- 6.6 tracking_recovery_decision: Anti_Spam_Guard server-side (espelha decideRecovery).
-- Recebe o cenario JA resolvido pelo caller; retorna 'DISPATCH' ou um Suppression_Reason.
CREATE OR REPLACE FUNCTION tracking_recovery_decision(
  p_user_id uuid, p_message_hash text, p_trigger_occurred_at timestamptz,
  p_now timestamptz, p_is_welcome boolean)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_min_delay    interval := interval '10 minutes';
  v_cooldown_max interval := interval '72 hours';
  v_window       interval := interval '24 hours';
  v_max_per_window int := 1;
  v_last timestamptz;
  v_count int;
BEGIN
  -- 2. recuperacao ativa em curso
  IF EXISTS (SELECT 1 FROM recovery_attempts WHERE user_id = p_user_id AND active) THEN
    RETURN 'CONCURRENT_RECOVERY_ACTIVE';
  END IF;
  -- 3. min-delay (so boas-vindas)
  IF p_is_welcome AND (p_now - p_trigger_occurred_at) < v_min_delay THEN
    RETURN 'MIN_DELAY_NOT_ELAPSED';
  END IF;
  -- 4. dedup
  IF p_message_hash IS NOT NULL AND p_message_hash <> ''
     AND EXISTS (SELECT 1 FROM recovery_attempts WHERE user_id = p_user_id AND message_hash = p_message_hash) THEN
    RETURN 'DUPLICATE_MESSAGE';
  END IF;
  -- 5. cooldown
  SELECT max(created_at) INTO v_last FROM recovery_attempts WHERE user_id = p_user_id;
  IF v_last IS NOT NULL AND p_now >= v_last AND (p_now - v_last) < v_cooldown_max THEN
    RETURN 'WITHIN_COOLDOWN';
  END IF;
  -- 6. max por janela
  SELECT count(*) INTO v_count FROM recovery_attempts
    WHERE user_id = p_user_id AND created_at >= p_now - v_window AND created_at <= p_now;
  IF v_count >= v_max_per_window THEN
    RETURN 'MAX_PER_WINDOW_REACHED';
  END IF;
  RETURN 'DISPATCH';
END;
$$;

-- 6.7 tracking_resolve_scenario: evento -> cenario (espelha resolveRecoveryScenario).
CREATE OR REPLACE FUNCTION tracking_resolve_scenario(p_kind text, p_event_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(
    CASE p_event_type
      WHEN 'SIGNUP_COMPLETED'    THEN 'NEW_SIGNUP_WELCOME'
      WHEN 'SIGNUP_ABANDONED'    THEN 'SIGNUP_ABANDONED'
      WHEN 'CHECKOUT_ABANDONED'  THEN 'SIGNUP_ABANDONED'
      WHEN 'PAYMENT_FAILED'      THEN 'PAYMENT_FAILED'
      WHEN 'INACTIVITY_DETECTED' THEN 'USER_INACTIVE'
      WHEN 'FREIGHT_IGNORED'     THEN 'COLD_DRIVER'
      ELSE NULL
    END,
    CASE WHEN p_kind = 'RISK' THEN 'USER_INACTIVE' ELSE NULL END
  );
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPCs SECURITY DEFINER (Req 3, 7, 8, 9, 11, 12, 15) — RPC Security Posture
-- ────────────────────────────────────────────────────────────────────────────
-- Todas: SET search_path = public; auth.uid() NULL => permission_denied (exceto
-- ingestao anonima); gating is_admin_with_permission + log negativo
-- RASTREAMENTO_VIEW_DENIED (before=NULL, after={user_id,reason}); REVOKE ALL FROM
-- PUBLIC + GRANT EXECUTE TO authenticated (ingestao tambem a anon).

-- 7.1 rpc_tracking_ingest_event — write-only, anon+auth, anti-enumeracao.
CREATE OR REPLACE FUNCTION rpc_tracking_ingest_event(p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_uid       uuid := auth.uid();
  v_item      jsonb;
  v_type      text;
  v_surface   text;
  v_visitor   text;
  v_occurred  timestamptz;
  v_inserted  int := 0;
  v_rejected  int := 0;
  v_throttled int := 0;
  v_recent    int;
  v_i         int := 0;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN jsonb_build_object('inserted', 0, 'rejected', 0, 'throttled', 0);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    v_i := v_i + 1;
    -- Limite de lote por chamada: excedente e descartado (throttled), sem falhar.
    IF v_i > 50 THEN v_throttled := v_throttled + 1; CONTINUE; END IF;

    v_type     := v_item->>'event_type';
    v_surface  := v_item->>'surface';
    v_visitor  := NULLIF(v_item->>'visitor_id', '');
    v_occurred := COALESCE((v_item->>'occurred_at')::timestamptz, now());

    -- Dominio fechado: evento/superficie fora do conjunto => rejeitado (Req 3.5).
    IF v_type IS NULL OR v_type NOT IN (
        'SITE_VISIT','SIGNUP_STARTED','SIGNUP_COMPLETED','SIGNUP_ABANDONED',
        'DOCUMENT_UPLOAD_STARTED','DOCUMENT_UPLOAD_FAILED','DOCUMENT_APPROVED',
        'LOGIN_SUCCEEDED','LOGIN_FAILED','CHECKOUT_STARTED','CHECKOUT_ABANDONED',
        'PAYMENT_STARTED','PAYMENT_FAILED','PAYMENT_SUCCEEDED','SUBSCRIPTION_ACTIVATED',
        'APP_OPENED','APP_CRASH','FREIGHT_VIEWED','FREIGHT_IGNORED','FREIGHT_ACCEPTED',
        'FIRST_FREIGHT_COMPLETED','INACTIVITY_DETECTED','INTERNAL_ERROR','NETWORK_TIMEOUT') THEN
      v_rejected := v_rejected + 1; CONTINUE;
    END IF;
    IF v_surface IS NULL OR v_surface NOT IN ('SITE','DASHBOARD','APP') THEN
      v_rejected := v_rejected + 1; CONTINUE;
    END IF;
    -- Sem sessao nem visitor => nao ha a quem vincular.
    IF v_uid IS NULL AND v_visitor IS NULL THEN
      v_rejected := v_rejected + 1; CONTINUE;
    END IF;

    -- Rate-limit por visitor/usuario (descarta excedente sem derrubar os demais).
    IF v_uid IS NOT NULL THEN
      SELECT count(*) INTO v_recent FROM journey_events
        WHERE user_id = v_uid AND created_at >= now() - interval '1 minute';
    ELSE
      SELECT count(*) INTO v_recent FROM journey_events
        WHERE visitor_id = v_visitor AND created_at >= now() - interval '1 minute';
    END IF;
    IF v_recent >= 120 THEN v_throttled := v_throttled + 1; CONTINUE; END IF;

    -- user_id SEMPRE de auth.uid() (nunca confia em id do cliente); senao visitor.
    INSERT INTO journey_events(event_type, surface, user_id, visitor_id, occurred_at, payload)
    VALUES (v_type, v_surface, v_uid,
            CASE WHEN v_uid IS NULL THEN v_visitor ELSE NULL END,
            v_occurred, COALESCE(v_item->'payload', '{}'::jsonb));
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Anti-enumeracao: retorna apenas contadores do lote, nunca jornada/existencia.
  RETURN jsonb_build_object('inserted', v_inserted, 'rejected', v_rejected, 'throttled', v_throttled);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_ingest_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_ingest_event(jsonb) TO anon, authenticated;

-- 7.2 rpc_tracking_correlate_visitor — backfill user_id do visitor_id (auth).
CREATE OR REPLACE FUNCTION rpc_tracking_correlate_visitor(p_visitor_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_n   int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF p_visitor_id IS NULL OR length(p_visitor_id) = 0 THEN
    RETURN jsonb_build_object('correlated', 0);
  END IF;
  UPDATE journey_events SET user_id = v_uid
    WHERE visitor_id = p_visitor_id AND user_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO tracking_visitor_identities(visitor_id, user_id)
    VALUES (p_visitor_id, v_uid)
    ON CONFLICT (visitor_id) DO UPDATE SET user_id = EXCLUDED.user_id, correlated_at = now();
  RETURN jsonb_build_object('correlated', v_n);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_correlate_visitor(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_correlate_visitor(text) TO authenticated;

-- 7.3 rpc_tracking_timeline — eventos asc + Funnel_Stage atual (RASTREAMENTO_VIEW).
CREATE OR REPLACE FUNCTION rpc_tracking_timeline(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_idx    int;
  v_ffc    int;
  v_stage  text;
  v_events jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'journey_events', p_user_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- eventos do usuario (asc) — sem payload (evita qualquer PII).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'event_type', e.event_type, 'surface', e.surface, 'occurred_at', e.occurred_at)
         ORDER BY e.occurred_at ASC), '[]'::jsonb)
    INTO v_events
  FROM journey_events e WHERE e.user_id = p_user_id;

  -- Funnel_Stage atual (espelha deriveFunnelStage).
  SELECT GREATEST(0, COALESCE(MAX(CASE event_type
            WHEN 'SITE_VISIT' THEN 0 WHEN 'SIGNUP_STARTED' THEN 1 WHEN 'SIGNUP_COMPLETED' THEN 2
            WHEN 'DOCUMENT_APPROVED' THEN 3 WHEN 'PAYMENT_SUCCEEDED' THEN 4 WHEN 'SUBSCRIPTION_ACTIVATED' THEN 4
            WHEN 'APP_OPENED' THEN 5 WHEN 'FREIGHT_VIEWED' THEN 5 WHEN 'FREIGHT_ACCEPTED' THEN 5
            WHEN 'FIRST_FREIGHT_COMPLETED' THEN 6 ELSE 0 END), 0)),
         count(*) FILTER (WHERE event_type = 'FIRST_FREIGHT_COMPLETED')
    INTO v_idx, v_ffc
  FROM journey_events WHERE user_id = p_user_id;

  v_stage := CASE WHEN v_ffc >= 2 THEN 'RECURRING_USER' ELSE (ARRAY[
    'VISITOR','SIGNUP_STARTED','SIGNUP_COMPLETED','DOCUMENTS_APPROVED',
    'SUBSCRIPTION_PAID','APP_ACTIVE','FIRST_FREIGHT','RECURRING_USER'])[v_idx + 1] END;

  RETURN jsonb_build_object('events', v_events, 'current_stage', v_stage);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_timeline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_timeline(uuid) TO authenticated;

-- 7.4 rpc_tracking_at_risk_list — lista filtrada/paginada (RASTREAMENTO_VIEW).
CREATE OR REPLACE FUNCTION rpc_tracking_at_risk_list(
  p_filter jsonb DEFAULT '{}'::jsonb, p_page int DEFAULT 0, p_page_size int DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_size      int  := CASE WHEN p_page_size IN (10,50,100) THEN p_page_size ELSE 10 END;
  v_page      int  := GREATEST(COALESCE(p_page, 0), 0);
  v_now       timestamptz := now();
  v_inact     int;
  v_text      text := NULLIF(btrim(COALESCE(p_filter->>'text','')), '');
  v_text_esc  text;
  v_digits    text;
  v_result    jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'journey_events', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT inactivity_days INTO v_inact FROM tracking_ai_config WHERE id = true;
  v_inact := COALESCE(v_inact, 14);
  -- Escapa curingas ILIKE (\ % _) — espelha escapeIlike.
  v_text_esc := replace(replace(replace(COALESCE(v_text,''), '\', '\\'), '%', '\%'), '_', '\_');
  v_digits := regexp_replace(COALESCE(v_text,''), '\D', '', 'g');

  WITH summary AS (
    SELECT
      e.user_id,
      floor(extract(epoch FROM (v_now - max(e.occurred_at))) / 86400)::int AS days_since,
      count(*) FILTER (WHERE e.event_type IN
        ('DOCUMENT_UPLOAD_FAILED','LOGIN_FAILED','PAYMENT_FAILED','NETWORK_TIMEOUT','INTERNAL_ERROR','APP_CRASH')
        AND e.occurred_at >= v_now - interval '7 days')::int AS recent_failures,
      count(*) FILTER (WHERE e.event_type IN ('LOGIN_FAILED','DOCUMENT_UPLOAD_FAILED')
        AND e.occurred_at >= v_now - interval '7 days')::int AS frustrated,
      count(*) FILTER (WHERE e.event_type = 'FREIGHT_IGNORED')::int AS refusals,
      (NOT bool_or(e.event_type IN ('PAYMENT_SUCCEEDED','SUBSCRIPTION_ACTIVATED'))) AS no_conversion,
      bool_or(e.event_type IN ('SIGNUP_STARTED','SIGNUP_COMPLETED')) AS signup_started,
      bool_or(e.event_type = 'SIGNUP_COMPLETED') AS signup_completed
    FROM journey_events e
    WHERE e.user_id IS NOT NULL
    GROUP BY e.user_id
  ),
  enriched AS (
    SELECT
      s.user_id, u.name, u.user_type AS profile, tracking_mask_phone(u.phone) AS phone_masked,
      s.days_since,
      lr.event_type AS last_relevant,
      tracking_risk_score(s.days_since, s.recent_failures, s.frustrated, s.refusals,
                          CASE WHEN s.no_conversion THEN 1 ELSE 0 END) AS risk_score,
      tracking_abandonment_cause(lr.event_type, s.signup_started, s.signup_completed,
                                 s.refusals, s.days_since, v_inact) AS cause,
      COALESCE(ra.contact_status, 'AT_RISK') AS contact_status,
      COALESCE(ra.last_at, max_e.last_at) AS last_activity_at
    FROM summary s
    JOIN users u ON u.id = s.user_id
      AND u.user_type IN ('motorista','embarcador')
      AND COALESCE(u.admin_username, '') <> 'Nexus_Vortex99'
    LEFT JOIN LATERAL (
      SELECT je.event_type FROM journey_events je
      WHERE je.user_id = s.user_id AND je.event_type IN
        ('APP_CRASH','PAYMENT_FAILED','DOCUMENT_UPLOAD_FAILED','LOGIN_FAILED','CHECKOUT_ABANDONED',
         'SIGNUP_ABANDONED','NETWORK_TIMEOUT','INTERNAL_ERROR','FREIGHT_IGNORED')
      ORDER BY je.occurred_at DESC, CASE je.event_type
        WHEN 'APP_CRASH' THEN 10 WHEN 'PAYMENT_FAILED' THEN 9 WHEN 'DOCUMENT_UPLOAD_FAILED' THEN 8
        WHEN 'LOGIN_FAILED' THEN 7 WHEN 'CHECKOUT_ABANDONED' THEN 6 WHEN 'SIGNUP_ABANDONED' THEN 5
        WHEN 'NETWORK_TIMEOUT' THEN 4 WHEN 'INTERNAL_ERROR' THEN 3 ELSE 2 END DESC
      LIMIT 1
    ) lr ON true
    LEFT JOIN LATERAL (
      SELECT max(occurred_at) AS last_at FROM journey_events je2 WHERE je2.user_id = s.user_id
    ) max_e ON true
    LEFT JOIN LATERAL (
      SELECT contact_status, created_at AS last_at FROM recovery_attempts r
      WHERE r.user_id = s.user_id ORDER BY r.created_at DESC LIMIT 1
    ) ra ON true
  ),
  filtered AS (
    SELECT user_id, name, profile, phone_masked, risk_score,
           tracking_risk_band(risk_score) AS risk_band, cause AS abandonment_cause,
           tracking_risk_category(cause) AS risk_category, contact_status, last_activity_at
    FROM enriched
    WHERE (p_filter->>'risk_category' IS NULL OR tracking_risk_category(cause) = p_filter->>'risk_category')
      AND (p_filter->>'problem_type'  IS NULL OR cause = p_filter->>'problem_type')
      AND (p_filter->>'profile'       IS NULL OR profile = p_filter->>'profile')
      AND (p_filter->>'min_score'     IS NULL OR risk_score >= (p_filter->>'min_score')::int)
      AND (p_filter->>'max_score'     IS NULL OR risk_score <= (p_filter->>'max_score')::int)
      AND (p_filter->>'from'          IS NULL OR last_activity_at >= (p_filter->>'from')::timestamptz)
      AND (p_filter->>'to'            IS NULL OR last_activity_at <= (p_filter->>'to')::timestamptz)
      AND (v_text IS NULL
           OR name ILIKE '%' || v_text_esc || '%' ESCAPE '\'
           OR (length(v_digits) >= 2 AND regexp_replace(phone_masked, '\D', '', 'g') LIKE '%' || v_digits || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'page', v_page, 'page_size', v_size,
    'items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.risk_score DESC, p.user_id ASC), '[]'::jsonb)
      FROM (
        SELECT * FROM filtered ORDER BY risk_score DESC, user_id ASC
        LIMIT v_size OFFSET v_page * v_size
      ) p
    )
  ) INTO v_result;

  RETURN v_result;
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_at_risk_list(jsonb, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_at_risk_list(jsonb, int, int) TO authenticated;

-- 7.5 rpc_tracking_funnel — contagens cumulativas por etapa (RASTREAMENTO_VIEW).
CREATE OR REPLACE FUNCTION rpc_tracking_funnel(p_window text DEFAULT '7d')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_int    interval := CASE p_window
              WHEN '24h' THEN interval '24 hours' WHEN '7d' THEN interval '7 days'
              WHEN '30d' THEN interval '30 days'  WHEN '90d' THEN interval '90 days'
              ELSE interval '7 days' END;   -- janela default se invalida (Req 8.10)
  v_from   timestamptz := now() - v_int;
  v_counts jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'journey_events', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_VIEW required' USING ERRCODE = '42501';
  END IF;

  WITH stage_idx AS (
    SELECT user_id,
      CASE WHEN count(*) FILTER (WHERE event_type = 'FIRST_FREIGHT_COMPLETED') >= 2 THEN 7
      ELSE GREATEST(0, COALESCE(MAX(CASE event_type
        WHEN 'SITE_VISIT' THEN 0 WHEN 'SIGNUP_STARTED' THEN 1 WHEN 'SIGNUP_COMPLETED' THEN 2
        WHEN 'DOCUMENT_APPROVED' THEN 3 WHEN 'PAYMENT_SUCCEEDED' THEN 4 WHEN 'SUBSCRIPTION_ACTIVATED' THEN 4
        WHEN 'APP_OPENED' THEN 5 WHEN 'FREIGHT_VIEWED' THEN 5 WHEN 'FREIGHT_ACCEPTED' THEN 5
        WHEN 'FIRST_FREIGHT_COMPLETED' THEN 6 ELSE 0 END), 0)) END AS idx
    FROM journey_events
    WHERE user_id IS NOT NULL AND occurred_at >= v_from
    GROUP BY user_id
  )
  SELECT jsonb_build_object(
    'VISITOR',          count(*) FILTER (WHERE idx >= 0),
    'SIGNUP_STARTED',   count(*) FILTER (WHERE idx >= 1),
    'SIGNUP_COMPLETED', count(*) FILTER (WHERE idx >= 2),
    'DOCUMENTS_APPROVED', count(*) FILTER (WHERE idx >= 3),
    'SUBSCRIPTION_PAID', count(*) FILTER (WHERE idx >= 4),
    'APP_ACTIVE',       count(*) FILTER (WHERE idx >= 5),
    'FIRST_FREIGHT',    count(*) FILTER (WHERE idx >= 6),
    'RECURRING_USER',   count(*) FILTER (WHERE idx >= 7)
  ) INTO v_counts FROM stage_idx;

  RETURN jsonb_build_object('window', p_window, 'counts', COALESCE(v_counts, '{}'::jsonb));
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_funnel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_funnel(text) TO authenticated;

-- 7.6 rpc_tracking_recovery_performance — contadores por Contact_Status (VIEW).
CREATE OR REPLACE FUNCTION rpc_tracking_recovery_performance(p_window text DEFAULT '7d')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_int    interval := CASE p_window
              WHEN '24h' THEN interval '24 hours' WHEN '7d' THEN interval '7 days'
              WHEN '30d' THEN interval '30 days'  WHEN '90d' THEN interval '90 days'
              ELSE interval '7 days' END;
  v_from   timestamptz := now() - v_int;
  v_counts jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'recovery_attempts', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'AT_RISK',   count(*) FILTER (WHERE contact_status = 'AT_RISK'),
    'CONTACTED', count(*) FILTER (WHERE contact_status = 'CONTACTED'),
    'REPLIED',   count(*) FILTER (WHERE contact_status = 'REPLIED'),
    'CONVERTED', count(*) FILTER (WHERE contact_status = 'CONVERTED')
  ) INTO v_counts FROM recovery_attempts WHERE created_at >= v_from;

  RETURN jsonb_build_object('window', p_window, 'counts', COALESCE(v_counts, '{}'::jsonb));
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_recovery_performance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_recovery_performance(text) TO authenticated;

-- 7.7 rpc_tracking_get_config — Tracking_AI_Config (RASTREAMENTO_VIEW; sem segredo).
CREATE OR REPLACE FUNCTION rpc_tracking_get_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_row    tracking_ai_config%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'tracking_ai_config', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM tracking_ai_config WHERE id = true;
  RETURN jsonb_build_object(
    'active_provider', v_row.active_provider,
    'personalization_enabled', v_row.personalization_enabled,
    'inactivity_days', v_row.inactivity_days,
    'updated_at', v_row.updated_at);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_get_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_get_config() TO authenticated;

-- 7.8 rpc_tracking_mark_contacted — idempotente _SKIPPED + STALE_VERSION (MANAGE).
CREATE OR REPLACE FUNCTION rpc_tracking_mark_contacted(p_user_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_id      uuid;
  v_status  text;
  v_updated timestamptz;
  v_rows    int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'recovery_attempts', p_user_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_MANAGE required' USING ERRCODE = '42501';
  END IF;
  -- Master imutavel (guarda antes de qualquer touch que referencie users).
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND admin_username = 'Nexus_Vortex99') THEN
    RAISE EXCEPTION 'permission_denied: master immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND user_type IN ('motorista','embarcador')) THEN
    RAISE EXCEPTION 'NOT_FOUND: user' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, contact_status, updated_at INTO v_id, v_status, v_updated
    FROM recovery_attempts WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO recovery_attempts(user_id, recovery_scenario, contact_status, active, triggered_by)
    VALUES (p_user_id, 'USER_INACTIVE', 'CONTACTED', true, v_caller)
    RETURNING updated_at INTO v_updated;
    RETURN jsonb_build_object('ok', true, 'updated_at', v_updated);
  END IF;

  IF v_status IN ('CONTACTED','REPLIED','CONVERTED') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'TRACKING_CONTACT_MARK_SKIPPED', 'recovery_attempts', p_user_id::text, NULL,
            jsonb_build_object('reason', 'ALREADY_CONTACTED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_CONTACTED');
  END IF;

  UPDATE recovery_attempts SET contact_status = 'CONTACTED'
    WHERE id = v_id AND contact_status = 'AT_RISK' AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_updated;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated_at', v_updated);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_mark_contacted(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_mark_contacted(uuid, timestamptz) TO authenticated;

-- 7.9 rpc_tracking_trigger_recovery — autoridade do motor; SUPPRESS => _SKIPPED (MANAGE).
CREATE OR REPLACE FUNCTION rpc_tracking_trigger_recovery(p_user_id uuid, p_trigger jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_scenario text;
  v_decision text;
  v_kind     text := COALESCE(p_trigger->>'kind', 'RISK');
  v_event    text := p_trigger->>'event_type';
  v_hash     text := COALESCE(p_trigger->>'message_hash', '');
  v_occurred timestamptz := COALESCE((p_trigger->>'occurred_at')::timestamptz, now());
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'recovery_attempts', p_user_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_MANAGE required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND admin_username = 'Nexus_Vortex99') THEN
    RAISE EXCEPTION 'permission_denied: master immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND user_type IN ('motorista','embarcador')) THEN
    RAISE EXCEPTION 'NOT_FOUND: user' USING ERRCODE = 'P0002';
  END IF;

  v_scenario := tracking_resolve_scenario(v_kind, v_event);
  IF v_scenario IS NULL THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RECOVERY_TRIGGER_SKIPPED', 'recovery_attempts', p_user_id::text, NULL,
            jsonb_build_object('reason', 'NO_ELIGIBLE_SCENARIO'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'NO_ELIGIBLE_SCENARIO');
  END IF;

  v_decision := tracking_recovery_decision(p_user_id, v_hash, v_occurred, now(),
                                           v_scenario = 'NEW_SIGNUP_WELCOME');
  IF v_decision <> 'DISPATCH' THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RECOVERY_TRIGGER_SKIPPED', 'recovery_attempts', p_user_id::text, NULL,
            jsonb_build_object('reason', v_decision, 'scenario', v_scenario));
    RETURN jsonb_build_object('skipped', true, 'reason', v_decision);
  END IF;

  -- DISPATCH autorizado: a personalizacao (IA) e a delegacao (whatsapp) ocorrem
  -- no servico, que entao chama rpc_tracking_record_dispatch (Req 9.12: falha de
  -- delegacao => NAO registra CONTACTED).
  RETURN jsonb_build_object('ok', true, 'decision', 'DISPATCH',
                            'scenario', v_scenario, 'template_key', v_scenario);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_trigger_recovery(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_trigger_recovery(uuid, jsonb) TO authenticated;

-- 7.10 rpc_tracking_record_dispatch — registra Recovery_Attempt apos delegacao (MANAGE/auto).
CREATE OR REPLACE FUNCTION rpc_tracking_record_dispatch(
  p_user_id uuid, p_scenario text, p_message_hash text DEFAULT NULL,
  p_trigger_event_id uuid DEFAULT NULL, p_dispatch_job_id uuid DEFAULT NULL,
  p_auto boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_id     uuid;
BEGIN
  -- Caller humano exige MANAGE; contexto service-role (auth.uid() nulo) so no auto.
  IF v_caller IS NOT NULL THEN
    IF NOT is_admin_with_permission('RASTREAMENTO_MANAGE') THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
      VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'recovery_attempts', p_user_id::text, NULL,
              jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
      RAISE EXCEPTION 'permission_denied: RASTREAMENTO_MANAGE required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT p_auto THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF p_scenario NOT IN ('NEW_SIGNUP_WELCOME','SIGNUP_ABANDONED','PAYMENT_FAILED','USER_INACTIVE','COLD_DRIVER') THEN
    RAISE EXCEPTION 'INVALID_SCENARIO' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND admin_username = 'Nexus_Vortex99') THEN
    RAISE EXCEPTION 'permission_denied: master immutable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO recovery_attempts(user_id, recovery_scenario, dispatch_job_id, contact_status,
                                trigger_event_id, message_hash, active, triggered_by)
  VALUES (p_user_id, p_scenario, p_dispatch_job_id, 'CONTACTED',
          p_trigger_event_id, NULLIF(p_message_hash,''), true, v_caller)
  RETURNING id INTO v_id;

  IF p_auto THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (COALESCE(v_caller, p_user_id), 'RECOVERY_AUTO_DISPATCH', 'recovery_attempts', p_user_id::text, NULL,
            jsonb_build_object('scenario', p_scenario));
  END IF;
  RETURN jsonb_build_object('ok', true, 'recovery_attempt_id', v_id);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_record_dispatch(uuid, text, text, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_record_dispatch(uuid, text, text, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_tracking_record_dispatch(uuid, text, text, uuid, uuid, boolean) TO service_role;

-- 7.11 rpc_tracking_update_ai_config — STALE_VERSION (MANAGE; sem segredo).
CREATE OR REPLACE FUNCTION rpc_tracking_update_ai_config(p_patch jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_provider text := p_patch->>'active_provider';
  v_inact    int  := (p_patch->>'inactivity_days')::int;
  v_updated  timestamptz;
  v_rows     int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('RASTREAMENTO_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'tracking_ai_config', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_MANAGE required' USING ERRCODE = '42501';
  END IF;

  -- Validacao de dominio (backend e autoridade — Req 15.10).
  IF v_provider IS NOT NULL AND v_provider NOT IN ('claude','gemini','grok','llama') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER' USING ERRCODE = 'P0001';
  END IF;
  IF v_inact IS NOT NULL AND v_inact < 1 THEN
    RAISE EXCEPTION 'INVALID_INACTIVITY_DAYS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tracking_ai_config SET
    active_provider = COALESCE(v_provider, active_provider),
    personalization_enabled = COALESCE((p_patch->>'personalization_enabled')::boolean, personalization_enabled),
    inactivity_days = COALESCE(v_inact, inactivity_days)
  WHERE id = true AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_updated;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated_at', v_updated);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_update_ai_config(jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_update_ai_config(jsonb, timestamptz) TO authenticated;

-- 7.12 rpc_tracking_scan_recovery — gatilhos automaticos (service_role / pg_cron).
-- Boas-vindas (~10min apos SIGNUP_COMPLETED) sem tentativa previa e fora do
-- cooldown => registra Recovery_Attempt + RECOVERY_AUTO_DISPATCH. Idempotente via
-- uq_recovery_per_critical_event (1 por evento). Sem caller => contexto confiavel.
CREATE OR REPLACE FUNCTION rpc_tracking_scan_recovery()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_now      timestamptz := now();
  v_opened   int := 0;
  rec        record;
  v_decision text;
BEGIN
  -- Caller humano (se houver) exige MANAGE; cron/service_role (uid nulo) prossegue.
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('RASTREAMENTO_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'recovery_attempts', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_MANAGE required' USING ERRCODE = '42501';
  END IF;

  FOR rec IN
    SELECT DISTINCT ON (e.user_id) e.id AS event_id, e.user_id, e.occurred_at
    FROM journey_events e
    JOIN users u ON u.id = e.user_id
      AND u.user_type IN ('motorista','embarcador')
      AND COALESCE(u.admin_username,'') <> 'Nexus_Vortex99'
    WHERE e.event_type = 'SIGNUP_COMPLETED'
      AND e.user_id IS NOT NULL
      AND e.occurred_at <= v_now - interval '10 minutes'
      AND e.occurred_at >= v_now - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM recovery_attempts r WHERE r.user_id = e.user_id)
    ORDER BY e.user_id, e.occurred_at DESC
    LIMIT 100
  LOOP
    v_decision := tracking_recovery_decision(rec.user_id, '', rec.occurred_at, v_now, true);
    IF v_decision = 'DISPATCH' THEN
      BEGIN
        INSERT INTO recovery_attempts(user_id, recovery_scenario, contact_status,
                                      trigger_event_id, active, triggered_by)
        VALUES (rec.user_id, 'NEW_SIGNUP_WELCOME', 'CONTACTED', rec.event_id, true, NULL);
        INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
        VALUES (rec.user_id, 'RECOVERY_AUTO_DISPATCH', 'recovery_attempts', rec.user_id::text, NULL,
                jsonb_build_object('scenario', 'NEW_SIGNUP_WELCOME'));
        v_opened := v_opened + 1;
      EXCEPTION WHEN unique_violation THEN
        -- corrida: ja existe tentativa ativa/por-evento — ignora (idempotente).
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_scan_recovery() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_scan_recovery() TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_tracking_scan_recovery() TO service_role;

-- 7.13 rpc_tracking_publish_alert — publica sinal em system_alerts (compoe 117).
CREATE OR REPLACE FUNCTION rpc_tracking_publish_alert(p_dedup_key text, p_detail jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_dedup  text := 'ABANDONMENT_SPIKE:tracking:' || COALESCE(NULLIF(btrim(p_dedup_key), ''), 'global');
BEGIN
  IF v_caller IS NOT NULL AND NOT is_admin_with_permission('RASTREAMENTO_MANAGE') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'RASTREAMENTO_VIEW_DENIED', 'system_alerts', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: RASTREAMENTO_MANAGE required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO system_alerts(alert_type, severity, state, source_type, source_id, dedup_key, title, detail)
  VALUES ('ABANDONMENT_SPIKE', 'WARNING', 'OPEN', 'tracking',
          COALESCE(NULLIF(btrim(p_dedup_key), ''), 'global'), v_dedup,
          'Pico de abandono detectado', COALESCE(p_detail, '{}'::jsonb))
  ON CONFLICT (dedup_key) WHERE state IN ('OPEN','ACKNOWLEDGED')
  DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$func$;
REVOKE ALL ON FUNCTION rpc_tracking_publish_alert(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_tracking_publish_alert(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_tracking_publish_alert(text, jsonb) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Agendamento pg_cron defensivo (nao falha sem a extensao; espelha 092/117)
-- ────────────────────────────────────────────────────────────────────────────
DO $cron$
DECLARE
  v_has_cron boolean;
  v_job_name text := 'tracking-scan-recovery-tick';
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[rastreamento-inteligente] pg_cron ausente: agendamento de rpc_tracking_scan_recovery IGNORADO (local/test). Em producao hospedada o job sera criado.';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule(v_job_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[rastreamento-inteligente] nenhum job pg_cron "%" pre-existente (ok).', v_job_name;
  END;
  -- Tick a cada 5 minutos: avalia gatilhos automaticos (contexto service-role).
  PERFORM cron.schedule(v_job_name, '*/5 * * * *', 'SELECT public.rpc_tracking_scan_recovery();');
  RAISE NOTICE '[rastreamento-inteligente] job pg_cron "%" agendado (tick a cada 5 min).', v_job_name;
END
$cron$;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado; nao executa no apply)
-- ============================================================================
/*
-- 1. Tabelas + indices unicos parciais
SELECT to_regclass('public.journey_events'), to_regclass('public.recovery_attempts'),
       to_regclass('public.tracking_visitor_identities'), to_regclass('public.tracking_ai_config');
SELECT indexname FROM pg_indexes WHERE indexname IN
  ('uq_recovery_active_per_user','uq_recovery_per_critical_event');

-- 2. RLS habilitada + policies (sem leitura anon; DML direto negado)
SELECT relname, relrowsecurity FROM pg_class
 WHERE relname IN ('journey_events','recovery_attempts','tracking_visitor_identities','tracking_ai_config');

-- 3. RBAC reconhece as acoes novas por construcao (SUPER_ADMIN/ADMIN => true):
--    SELECT is_admin_with_permission('RASTREAMENTO_VIEW'), is_admin_with_permission('RASTREAMENTO_MANAGE');

-- 4. Ampliacao ADITIVA do CHECK de system_alerts.alert_type (+ ABANDONMENT_SPIKE)
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.system_alerts'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%alert_type%';

-- 5. Helpers determinísticos
-- SELECT tracking_risk_score(30,5,5,5,1), tracking_risk_band(80),
--        tracking_abandonment_cause('PAYMENT_FAILED', true, false, 0, 0, 14);

-- 6. Smoke das RPCs (ver bloco 7 — arquivo 124b se necessario):
--    evento fora do dominio => INVALID_EVENT_TYPE (rejeitado, sem persistir);
--    leitura sem permissao => RASTREAMENTO_VIEW_DENIED persistido;
--    mark_contacted idempotente => ALREADY_CONTACTED;
--    trigger_recovery em cooldown => SUPPRESS WITHIN_COOLDOWN.
*/
