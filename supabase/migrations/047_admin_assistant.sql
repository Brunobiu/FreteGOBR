-- =====================================================
-- Migration 047: admin-assistant
--
-- Cria a infraestrutura de banco do modulo Assistente de IA do painel admin
-- (/admin/assistant), o assistente pessoal do Master_Admin. Entrega:
--   - RBAC: ASSISTANT_VIEW / ASSISTANT_EDIT em is_admin_with_permission
--           (concedidas exclusivamente ao papel SUPER_ADMIN)
--   - Tabelas: error_logs, assistant_conversations, assistant_messages,
--              assistant_critical_events, assistant_config (registro unico)
--   - RPCs SECURITY DEFINER: ingestao de erros, config get/update,
--           set/clear de segredo (Vault), conversa/mensagem,
--           persistencia de evento critico e status
--   - Seed de assistant_config + agendamento pg_cron do assistant-monitor
--
-- Dependencias (validadas no bloco DO $check$ abaixo):
--   - 030_admin_foundation.sql  (is_admin_with_permission, admin_audit_logs)
--   - 042b_push_config_via_vault.sql (extensao supabase_vault para segredos)
--   - migrations 001..044 aplicadas (users, fretes, etc.)
--
-- NOTA DE NUMERACAO: proxima numeracao livre apos 044 (045 reservada por
--   admin-settings, 046 por financeiro), sem buracos.
--
-- POSTURE DE SEGURANCA (ver admin-patterns.md Sec. 9 e 10):
--   - Owner_Only_Gate: todo o modulo (RLS + RPC) restrito a SUPER_ADMIN.
--   - Segredos (chaves de API / WhatsApp) vivem no Vault, nunca em colunas
--     legiveis nem no frontend; lidos apenas server-side pela Edge Function.
--
-- Idempotente: pode ser reaplicada sem erros (DDL idempotente, seed com
--   ON CONFLICT DO NOTHING, agendamento pg_cron com unschedule condicional).
-- Acompanhada de 047_admin_assistant_rollback.sql (documentacao, nao
--   auto-aplicado).
-- =====================================================

BEGIN;

-- ========== 0. Pre-checks defensivos ==========

-- 0.1 - Migration 030 (admin-foundation) aplicada: is_admin_with_permission existe.
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

-- 0.2 - Migration 030 (admin-foundation) aplicada: admin_audit_logs existe.
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

-- 0.3 - Extensao supabase_vault (migration 042b) habilitada: necessaria para
--       guardar as chaves de API dos provedores criptografadas server-side.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault'
  ) THEN
    RAISE EXCEPTION 'Extensao supabase_vault nao habilitada (migration 042b): segredos do assistente nao podem ser armazenados';
  END IF;
END
$check$;


-- ========== 1. RBAC: ASSISTANT_VIEW / ASSISTANT_EDIT ==========
--
-- Reproduz a Permission_Matrix server-side. Preserva o corpo existente de
-- is_admin_with_permission (migration 030) e apenas inclui ASSISTANT_VIEW e
-- ASSISTANT_EDIT na lista de exclusao do ramo ADMIN (p_action NOT IN (...)),
-- de modo que o papel ADMIN NAO as receba. O ramo SUPER_ADMIN ja cobre as
-- duas (retorna true para qualquer acao). FINANCEIRO/SUPORTE/MODERADOR negam
-- por allowlist. Caller anonimo (auth.uid() nulo) nao possui linha em
-- `active`, logo retorna false (deny-by-default preservado).

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
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;


-- ========== 2. Tabelas + indices + RLS Owner_Only_Gate ==========
--
-- Owner_Only_Gate (Req 6.6, 7.1, 14.7, 15.5): todas as tabelas com RLS
-- habilitada e policies restritas a quem possui ASSISTANT_VIEW (leitura) /
-- ASSISTANT_EDIT (escrita de config). Como ASSISTANT_VIEW/ASSISTANT_EDIT so
-- sao concedidas ao papel SUPER_ADMIN (ver bloco 1), o acesso fica de fato
-- restrito ao Master_Admin. error_logs e somente-leitura sob ASSISTANT_VIEW;
-- a INSERCAO de Error_Log ocorre exclusivamente pela Error_Ingest_RPC
-- (SECURITY DEFINER, task 1.4) — NAO ha policy de insert direto para
-- authenticated (Req 3.10).
-- DDL idempotente: CREATE TABLE/INDEX IF NOT EXISTS + DROP POLICY IF EXISTS
-- antes de CREATE POLICY (admin-patterns.md Sec. 9).

-- 2.1 - error_logs: erros de frontend capturados globalmente.
CREATE TABLE IF NOT EXISTS error_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_type       text NOT NULL CHECK (error_type IN
                     ('react_render','window_error','unhandled_rejection',
                      'console_error','request_failure')),
  route            text,
  message          text,
  stack            text,
  affected_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_occurred_at
  ON error_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type_occurred_at
  ON error_logs (error_type, occurred_at DESC);

-- 2.2 - assistant_conversations: threads de conversa com o assistente.
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL DEFAULT 'Conversa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.3 - assistant_messages: mensagens de uma conversa (dominio fechado de role).
CREATE TABLE IF NOT EXISTS assistant_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_created_at
  ON assistant_messages (conversation_id, created_at ASC);

-- 2.4 - assistant_critical_events: eventos criticos detectados pelo monitor.
--   dedup_key NOT NULL + UNIQUE garante deduplicacao idempotente
--   (ON CONFLICT (dedup_key) DO NOTHING na task 1.8).
CREATE TABLE IF NOT EXISTS assistant_critical_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL CHECK (event_type IN
                    ('page_error_rate','request_failure_rate','unauthorized_access_attempt',
                     'failed_login_burst','payment_failure','db_performance_drop')),
  severity        text NOT NULL CHECK (severity IN ('info','warning','critical')),
  summary         text NOT NULL,
  scope           text NOT NULL DEFAULT 'global',
  dedup_key       text NOT NULL,
  conversation_id uuid NULL REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz NULL,
  CONSTRAINT assistant_critical_events_dedup_key_unique UNIQUE (dedup_key)
);

-- 2.5 - assistant_config: registro unico de configuracao do assistente.
--   id boolean PK DEFAULT true CHECK (id) garante no maximo uma linha
--   (single-row pattern). SEM colunas de segredo — chaves vivem no Vault.
CREATE TABLE IF NOT EXISTS assistant_config (
  id                             boolean PRIMARY KEY DEFAULT true CHECK (id),
  active_provider                text NOT NULL DEFAULT 'claude' CHECK (active_provider IN
                                   ('claude','gemini','grok','llama')),
  model                          text NOT NULL DEFAULT 'claude-3-5-sonnet-latest',
  threshold_page_error_rate      int NOT NULL DEFAULT 10 CHECK (threshold_page_error_rate >= 1),
  threshold_request_failure_rate int NOT NULL DEFAULT 10 CHECK (threshold_request_failure_rate >= 1),
  threshold_failed_login_burst   int NOT NULL DEFAULT 5  CHECK (threshold_failed_login_burst >= 1),
  cron_interval_minutes          int NOT NULL DEFAULT 1  CHECK (cron_interval_minutes BETWEEN 1 AND 5),
  whatsapp_toggle                boolean NOT NULL DEFAULT false,
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

-- 2.6 - RLS Owner_Only_Gate em todas as tabelas do modulo.
ALTER TABLE error_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_critical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_config          ENABLE ROW LEVEL SECURITY;

-- 2.6.1 - error_logs: SOMENTE leitura sob ASSISTANT_VIEW.
--   Sem policy de INSERT/UPDATE/DELETE: a insercao ocorre apenas pela
--   Error_Ingest_RPC (SECURITY DEFINER, task 1.4); RLS bloqueia o resto.
DROP POLICY IF EXISTS error_logs_select_owner ON error_logs;
CREATE POLICY error_logs_select_owner
  ON error_logs FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'));

-- 2.6.2 - assistant_conversations: SELECT/INSERT/UPDATE/DELETE sob ASSISTANT_VIEW.
DROP POLICY IF EXISTS assistant_conversations_select_owner ON assistant_conversations;
CREATE POLICY assistant_conversations_select_owner
  ON assistant_conversations FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'));

DROP POLICY IF EXISTS assistant_conversations_mutate_owner ON assistant_conversations;
CREATE POLICY assistant_conversations_mutate_owner
  ON assistant_conversations FOR ALL
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'))
  WITH CHECK (is_admin_with_permission('ASSISTANT_VIEW'));

-- 2.6.3 - assistant_messages: SELECT/INSERT/UPDATE/DELETE sob ASSISTANT_VIEW.
DROP POLICY IF EXISTS assistant_messages_select_owner ON assistant_messages;
CREATE POLICY assistant_messages_select_owner
  ON assistant_messages FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'));

DROP POLICY IF EXISTS assistant_messages_mutate_owner ON assistant_messages;
CREATE POLICY assistant_messages_mutate_owner
  ON assistant_messages FOR ALL
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'))
  WITH CHECK (is_admin_with_permission('ASSISTANT_VIEW'));

-- 2.6.4 - assistant_critical_events: SELECT/INSERT/UPDATE/DELETE sob ASSISTANT_VIEW.
DROP POLICY IF EXISTS assistant_critical_events_select_owner ON assistant_critical_events;
CREATE POLICY assistant_critical_events_select_owner
  ON assistant_critical_events FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'));

DROP POLICY IF EXISTS assistant_critical_events_mutate_owner ON assistant_critical_events;
CREATE POLICY assistant_critical_events_mutate_owner
  ON assistant_critical_events FOR ALL
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'))
  WITH CHECK (is_admin_with_permission('ASSISTANT_VIEW'));

-- 2.6.5 - assistant_config: leitura sob ASSISTANT_VIEW; ESCRITA sob ASSISTANT_EDIT.
DROP POLICY IF EXISTS assistant_config_select_owner ON assistant_config;
CREATE POLICY assistant_config_select_owner
  ON assistant_config FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_VIEW'));

DROP POLICY IF EXISTS assistant_config_mutate_owner ON assistant_config;
CREATE POLICY assistant_config_mutate_owner
  ON assistant_config FOR ALL
  TO authenticated
  USING (is_admin_with_permission('ASSISTANT_EDIT'))
  WITH CHECK (is_admin_with_permission('ASSISTANT_EDIT'));


-- ========== 3. RPC Error_Ingest (excecao controlada ao Owner_Only_Gate) ==========
--
-- rpc_assistant_ingest_errors(p_batch jsonb): recebe lotes de Error_Log do
-- frontend (Global_Error_Capture) e os persiste em error_logs.
--
-- EXCECAO CONTROLADA ao Owner_Only_Gate (Req 14.7): diferente das demais RPCs
-- do modulo, esta NAO chama is_admin_with_permission — a captura de erros
-- precisa funcionar para QUALQUER sessao autenticada (qualquer usuario do site
-- pode gerar erros de frontend). A LEITURA de error_logs continua restrita ao
-- Owner_Only_Gate via RLS (bloco 2.6.1); apenas a INSERCAO passa por aqui.
--
-- Posture de seguranca:
--   - SECURITY DEFINER + SET search_path = public (admin-patterns.md Sec. 10).
--   - affected_user_id e resolvido SERVER-SIDE de auth.uid() (Req 3.5): nao se
--     confia no id enviado pelo cliente, evitando spoof e violacoes de FK. Sem
--     sessao (auth.uid() nulo) grava com usuario nulo, sem falhar (Req 3.6).
--   - Validacao de dominio fechado de error_type (Req 3.9, 3.10): item invalido
--     e REJEITADO individualmente (contado em `rejected`), SEM abortar a
--     transacao nem descartar os itens validos do mesmo lote.
--   - Limite anti-flood por chamada: itens alem de c_max_items sao ignorados e
--     a flag `throttled` e marcada (defesa adicional ao throttle do frontend).
-- Retorno: { inserted, rejected, throttled }.

CREATE OR REPLACE FUNCTION rpc_assistant_ingest_errors(p_batch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  c_max_items   constant int := 200;   -- limite anti-flood por chamada
  v_caller      uuid    := auth.uid(); -- usuario afetado resolvido server-side
  v_inserted    int     := 0;
  v_rejected    int     := 0;
  v_throttled   boolean := false;
  v_processed   int     := 0;
  v_item        jsonb;
  v_error_type  text;
  v_occurred_at timestamptz;
BEGIN
  -- Entrada deve ser um array JSON; nula/invalida => nada a persistir.
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' THEN
    RETURN jsonb_build_object('inserted', 0, 'rejected', 0, 'throttled', false);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_batch)
  LOOP
    -- Limite anti-flood: itens alem de c_max_items por chamada sao ignorados
    -- (nem inseridos nem rejeitados) e a flag throttled e marcada.
    IF v_processed >= c_max_items THEN
      v_throttled := true;
      EXIT;
    END IF;
    v_processed := v_processed + 1;

    -- Validacao de dominio fechado: error_type fora do dominio => item rejeitado
    -- (NAO aborta a transacao; os demais itens validos seguem normalmente).
    v_error_type := v_item ->> 'error_type';
    IF v_error_type IS NULL OR v_error_type NOT IN
         ('react_render','window_error','unhandled_rejection',
          'console_error','request_failure') THEN
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- occurred_at: parse tolerante; ausente/malformado => now().
    BEGIN
      v_occurred_at := COALESCE((v_item ->> 'occurred_at')::timestamptz, now());
    EXCEPTION WHEN others THEN
      v_occurred_at := now();
    END;

    -- Insercao controlada: falha pontual de um item (ex.: dado fora de forma)
    -- conta como rejeicao sem derrubar o lote inteiro.
    BEGIN
      INSERT INTO error_logs
        (error_type, route, message, stack, affected_user_id, occurred_at)
      VALUES
        (v_error_type,
         v_item ->> 'route',
         v_item ->> 'message',
         v_item ->> 'stack',
         v_caller,
         v_occurred_at);
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN others THEN
      v_rejected := v_rejected + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted',  v_inserted,
    'rejected',  v_rejected,
    'throttled', v_throttled
  );
END;
$func$;

-- Exposicao controlada: nega PUBLIC, concede apenas a authenticated (a ingestao
-- precisa funcionar para qualquer sessao logada; a LEITURA segue gated por RLS).
REVOKE ALL ON FUNCTION rpc_assistant_ingest_errors(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_ingest_errors(jsonb) TO authenticated;


-- ========== 4. RPCs de config (get / update) ==========
--
-- rpc_assistant_get_config()  -> leitura gated por ASSISTANT_VIEW; retorna a
--   Assistant_Config (registro unico) + estado das chaves por provedor
--   (is_set + mascara), derivado da existencia do segredo no Vault. O valor
--   BRUTO da chave NUNCA e retornado (Req 7.4, 7.5, 14.5): a mascara revela no
--   maximo os ultimos 4 caracteres e somente para chaves com tamanho >= 8.
--
-- rpc_assistant_update_config(p_patch jsonb, p_expected_updated_at timestamptz)
--   -> escrita gated por ASSISTANT_EDIT; valida thresholds (inteiro >= 1) e
--   cron_interval_minutes (1..5) ANTES de qualquer efeito (invalido => RAISE
--   tipado, sem persistir); update otimista WHERE updated_at = expected
--   (ROW_COUNT = 0 => STALE_VERSION, admin-patterns Sec. 3). O audit positivo
--   (ASSISTANT_CONFIG_UPDATED / ASSISTANT_WHATSAPP_TOGGLED) e gravado pelo
--   wrapper TS executeAdminMutation (admin-patterns Sec. 1, task 7.1); a RPC
--   grava apenas o path negativo ASSISTANT_VIEW_DENIED.
--
-- Ambas seguem a RPC Security Posture (admin-patterns Sec. 10): SECURITY
-- DEFINER, SET search_path = public, auth.uid() obrigatorio, gating via
-- is_admin_with_permission com log negativo ASSISTANT_VIEW_DENIED, e
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated.

-- 4.1 - rpc_assistant_get_config(): config + is_set/mascara por provedor.
CREATE OR REPLACE FUNCTION rpc_assistant_get_config()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller        uuid := auth.uid();
  v_cfg           record;
  v_provider_keys jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'get_config'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- is_set + mascara por provedor (dominio fechado), derivados do Vault. O
  -- valor BRUTO so e tocado para computar a mascara nao reversivel e nunca
  -- propagado na saida. Provedor sem segredo (ou segredo vazio) => is_set=false.
  SELECT jsonb_object_agg(
           p.provider,
           CASE
             WHEN s.decrypted_secret IS NOT NULL AND length(s.decrypted_secret) > 0
             THEN jsonb_build_object(
                    'is_set', true,
                    'mask',
                    CASE
                      WHEN length(s.decrypted_secret) >= 8
                      THEN repeat('*', length(s.decrypted_secret) - 4) || right(s.decrypted_secret, 4)
                      ELSE repeat('*', length(s.decrypted_secret))
                    END)
             ELSE jsonb_build_object('is_set', false, 'mask', NULL)
           END)
    INTO v_provider_keys
    FROM (VALUES ('claude'), ('gemini'), ('grok'), ('llama')) AS p(provider)
    LEFT JOIN vault.decrypted_secrets s
      ON s.name = 'assistant_provider_key_' || p.provider;

  SELECT * INTO v_cfg FROM assistant_config WHERE id = true LIMIT 1;

  -- Fallback defensivo: a seed (secao 8) garante a linha em runtime, mas se
  -- ausente retornamos os defaults para nao quebrar a leitura.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'active_provider',       'claude',
      'model',                 'claude-3-5-sonnet-latest',
      'thresholds',            jsonb_build_object(
                                 'page_error_rate', 10,
                                 'request_failure_rate', 10,
                                 'failed_login_burst', 5),
      'cron_interval_minutes', 1,
      'whatsapp_toggle',       false,
      'provider_keys',         v_provider_keys,
      'updated_at',            NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'active_provider',       v_cfg.active_provider,
    'model',                 v_cfg.model,
    'thresholds',            jsonb_build_object(
                               'page_error_rate',      v_cfg.threshold_page_error_rate,
                               'request_failure_rate', v_cfg.threshold_request_failure_rate,
                               'failed_login_burst',   v_cfg.threshold_failed_login_burst),
    'cron_interval_minutes', v_cfg.cron_interval_minutes,
    'whatsapp_toggle',       v_cfg.whatsapp_toggle,
    'provider_keys',         v_provider_keys,
    'updated_at',            v_cfg.updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_get_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_get_config() TO authenticated;

COMMENT ON FUNCTION rpc_assistant_get_config()
  IS 'RPC STABLE SECURITY DEFINER (ASSISTANT_VIEW) que retorna Assistant_Config + is_set/mascara por provedor (derivados do Vault, sem valor bruto). Path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';

-- 4.2 - rpc_assistant_update_config(): update otimista com validacao tipada.
CREATE OR REPLACE FUNCTION rpc_assistant_update_config(p_patch jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_active         text;
  v_thresholds     jsonb;
  v_cron           jsonb;
  v_whatsapp       jsonb;
  v_t_page         int;
  v_t_req          int;
  v_t_login        int;
  v_cron_int       int;
  v_whatsapp_bool  boolean;
  v_key            text;
  v_val            jsonb;
  v_rows           int;
  v_new_updated_at timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'update_config'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_EDIT required' USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT: patch deve ser um objeto JSON' USING ERRCODE = 'P0001';
  END IF;

  -- ---- Validacao: activeProvider (dominio fechado) ----
  IF p_patch ? 'activeProvider' THEN
    v_active := p_patch ->> 'activeProvider';
    IF v_active IS NULL OR v_active NOT IN ('claude', 'gemini', 'grok', 'llama') THEN
      RAISE EXCEPTION 'INVALID_PROVIDER: %', COALESCE(v_active, 'null') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ---- Validacao: thresholds (cada valor inteiro >= 1, Req 10.5) ----
  IF p_patch ? 'thresholds' AND jsonb_typeof(p_patch -> 'thresholds') = 'object' THEN
    v_thresholds := p_patch -> 'thresholds';
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_thresholds)
    LOOP
      IF v_key NOT IN ('page_error_rate', 'request_failure_rate', 'failed_login_burst') THEN
        RAISE EXCEPTION 'INVALID_THRESHOLD: chave desconhecida %', v_key USING ERRCODE = 'P0001';
      END IF;
      -- Guarda o cast: so converte para numeric quando o JSON e de fato number
      -- (OR em SQL nao garante short-circuit; evita erro de cast em string).
      IF jsonb_typeof(v_val) <> 'number' THEN
        RAISE EXCEPTION 'INVALID_THRESHOLD: % deve ser inteiro >= 1 (recebido %)', v_key, v_val::text
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_val::text)::numeric <> trunc((v_val::text)::numeric) OR (v_val::text)::numeric < 1 THEN
        RAISE EXCEPTION 'INVALID_THRESHOLD: % deve ser inteiro >= 1 (recebido %)', v_key, v_val::text
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    v_t_page  := NULLIF(v_thresholds ->> 'page_error_rate', '')::int;
    v_t_req   := NULLIF(v_thresholds ->> 'request_failure_rate', '')::int;
    v_t_login := NULLIF(v_thresholds ->> 'failed_login_burst', '')::int;
  END IF;

  -- ---- Validacao: cronIntervalMinutes (inteiro 1..5, Req 10.6) ----
  IF p_patch ? 'cronIntervalMinutes' THEN
    v_cron := p_patch -> 'cronIntervalMinutes';
    -- Guarda o cast: type guard antes de converter (vide thresholds acima).
    IF jsonb_typeof(v_cron) <> 'number' THEN
      RAISE EXCEPTION 'INVALID_CRON_INTERVAL: deve ser inteiro entre 1 e 5 (recebido %)', v_cron::text
        USING ERRCODE = 'P0001';
    END IF;
    IF (v_cron::text)::numeric <> trunc((v_cron::text)::numeric)
       OR (v_cron::text)::numeric < 1
       OR (v_cron::text)::numeric > 5 THEN
      RAISE EXCEPTION 'INVALID_CRON_INTERVAL: deve ser inteiro entre 1 e 5 (recebido %)', v_cron::text
        USING ERRCODE = 'P0001';
    END IF;
    v_cron_int := (v_cron::text)::int;
  END IF;

  -- ---- Validacao: whatsappToggle (booleano) ----
  IF p_patch ? 'whatsappToggle' THEN
    v_whatsapp := p_patch -> 'whatsappToggle';
    IF jsonb_typeof(v_whatsapp) <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_INPUT: whatsappToggle deve ser booleano' USING ERRCODE = 'P0001';
    END IF;
    v_whatsapp_bool := (v_whatsapp::text)::boolean;
  END IF;

  -- ---- Update otimista (versionamento via updated_at; ROW_COUNT=0 => STALE_VERSION) ----
  -- Campos ausentes no patch preservam o valor atual (COALESCE). A clausula
  -- WHERE updated_at = expected detecta edicao concorrente de outro admin.
  UPDATE assistant_config SET
    active_provider                = COALESCE(v_active, active_provider),
    threshold_page_error_rate      = COALESCE(v_t_page, threshold_page_error_rate),
    threshold_request_failure_rate = COALESCE(v_t_req, threshold_request_failure_rate),
    threshold_failed_login_burst   = COALESCE(v_t_login, threshold_failed_login_burst),
    cron_interval_minutes          = COALESCE(v_cron_int, cron_interval_minutes),
    whatsapp_toggle                = COALESCE(v_whatsapp_bool, whatsapp_toggle),
    updated_at                     = now()
  WHERE id = true
    AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_new_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new_updated_at);
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_update_config(jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_update_config(jsonb, timestamptz) TO authenticated;

COMMENT ON FUNCTION rpc_assistant_update_config(jsonb, timestamptz)
  IS 'RPC SECURITY DEFINER (ASSISTANT_EDIT) que aplica um patch parcial a Assistant_Config. Valida thresholds (inteiro >= 1) e cron_interval_minutes (1..5) antes de persistir (RAISE tipado, sem efeito). Update otimista WHERE updated_at = expected -> STALE_VERSION em mismatch. Audit positivo (ASSISTANT_CONFIG_UPDATED/ASSISTANT_WHATSAPP_TOGGLED) pelo wrapper TS; path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';


-- ========== 5. RPCs de segredo (Vault) ==========
--
-- As chaves de API dos provedores sao segredos: vivem CRIPTOGRAFADAS no Vault
-- (supabase_vault, migration 042b) sob o nome `assistant_provider_key_<provider>`,
-- nunca em colunas legiveis nem no frontend (Req 7.3, 7.5, 14.1). Estas RPCs
-- sao o unico ponto de escrita/remocao do segredo a partir do painel, e jamais
-- retornam o valor bruto.
--
-- rpc_assistant_set_secret(p_provider, p_raw)  -> gated ASSISTANT_EDIT; grava o
--   valor bruto no Vault (cria se ausente, atualiza se ja existe — padrao de
--   create_secret/update_secret). Retorna apenas { ok, is_set:true }. O audit
--   positivo ASSISTANT_PROVIDER_KEY_UPDATED (somente metadados nao sensiveis)
--   e gravado pelo wrapper TS executeAdminMutation (task 7.1).
-- rpc_assistant_clear_secret(p_provider) -> gated ASSISTANT_EDIT; apaga o
--   segredo do Vault, deixando is_set=false. Audit positivo
--   ASSISTANT_PROVIDER_KEY_CLEARED pelo wrapper TS.
-- rpc_assistant_read_provider_key(p_provider) -> RPC server-only (NAO concedida
--   a authenticated): le o segredo DECRIPTADO do Vault. Usada como fallback
--   pela Edge Function assistant-ai (task 8.1) quando o segredo de ambiente nao
--   esta presente. So service_role/postgres podem executar.
--
-- Posture (admin-patterns Sec. 10): SECURITY DEFINER, SET search_path = public
-- (referencias ao Vault sempre qualificadas como vault.*), auth.uid()
-- obrigatorio nas RPCs gated, log negativo ASSISTANT_VIEW_DENIED, REVOKE ALL
-- FROM PUBLIC + GRANT explicito.

-- 5.1 - rpc_assistant_set_secret(): grava (cria/atualiza) a chave no Vault.
CREATE OR REPLACE FUNCTION rpc_assistant_set_secret(p_provider text, p_raw text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_name   text;
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'set_secret'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- Validacao de dominio fechado do provedor (Req 7.1).
  IF p_provider IS NULL OR p_provider NOT IN ('claude', 'gemini', 'grok', 'llama') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER: %', COALESCE(p_provider, 'null') USING ERRCODE = 'P0001';
  END IF;

  -- Valor bruto obrigatorio e nao vazio (apagar usa clear_secret).
  IF p_raw IS NULL OR length(p_raw) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: chave vazia' USING ERRCODE = 'P0001';
  END IF;

  v_name := 'assistant_provider_key_' || p_provider;

  -- Cria se ausente, atualiza se ja existe (idempotente por nome). Os helpers
  -- vault.create_secret/update_secret cuidam da criptografia server-side.
  SELECT id INTO v_id FROM vault.decrypted_secrets WHERE name = v_name LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_raw, v_name, 'Assistant AI provider key (' || p_provider || ')');
  ELSE
    PERFORM vault.update_secret(v_id, p_raw);
  END IF;

  -- NUNCA retorna o valor bruto (Req 7.3, 7.5).
  RETURN jsonb_build_object('ok', true, 'is_set', true);
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_set_secret(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_set_secret(text, text) TO authenticated;

COMMENT ON FUNCTION rpc_assistant_set_secret(text, text)
  IS 'RPC SECURITY DEFINER (ASSISTANT_EDIT) que grava a chave de API de um provedor no Vault sob assistant_provider_key_<provider> (cria/atualiza). Nunca retorna o valor bruto. Audit ASSISTANT_PROVIDER_KEY_UPDATED (so metadados) pelo wrapper TS; path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';

-- 5.2 - rpc_assistant_clear_secret(): apaga a chave do Vault (is_set=false).
CREATE OR REPLACE FUNCTION rpc_assistant_clear_secret(p_provider text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_name   text;
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'clear_secret'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_EDIT required' USING ERRCODE = '42501';
  END IF;

  IF p_provider IS NULL OR p_provider NOT IN ('claude', 'gemini', 'grok', 'llama') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER: %', COALESCE(p_provider, 'null') USING ERRCODE = 'P0001';
  END IF;

  v_name := 'assistant_provider_key_' || p_provider;

  -- Remocao idempotente: apagar segredo inexistente nao e erro (is_set ja era
  -- false). vault.secrets e a tabela base; decrypted_secrets e a view.
  DELETE FROM vault.secrets WHERE name = v_name;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'is_set', false, 'cleared', v_rows > 0);
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_clear_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_clear_secret(text) TO authenticated;

COMMENT ON FUNCTION rpc_assistant_clear_secret(text)
  IS 'RPC SECURITY DEFINER (ASSISTANT_EDIT) que apaga a chave de API de um provedor do Vault (is_set=false). Idempotente (apagar inexistente nao falha). Audit ASSISTANT_PROVIDER_KEY_CLEARED pelo wrapper TS; path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';

-- 5.3 - rpc_assistant_read_provider_key(): leitura server-only do segredo bruto.
--   NAO e concedida a authenticated. Usada exclusivamente server-side pela Edge
--   Function assistant-ai (Bearer service-role) como fallback de leitura da
--   chave do Active_Provider a partir do Vault (Req 8.7, 14.2). Como o segredo
--   bruto e retornado, a unica protecao e o GRANT restrito a service_role.
CREATE OR REPLACE FUNCTION rpc_assistant_read_provider_key(p_provider text)
RETURNS text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_secret text;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('claude', 'gemini', 'grok', 'llama') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER: %', COALESCE(p_provider, 'null') USING ERRCODE = 'P0001';
  END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'assistant_provider_key_' || p_provider
   LIMIT 1;

  RETURN v_secret; -- NULL quando o segredo nao existe (Edge trata como missing_api_key).
END;
$func$;

-- Server-only: nega PUBLIC e authenticated; concede SOMENTE a service_role
-- (o owner postgres ja executa). O frontend NUNCA pode ler o segredo bruto.
REVOKE ALL ON FUNCTION rpc_assistant_read_provider_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rpc_assistant_read_provider_key(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION rpc_assistant_read_provider_key(text) TO service_role;

COMMENT ON FUNCTION rpc_assistant_read_provider_key(text)
  IS 'RPC SECURITY DEFINER server-only (GRANT apenas a service_role; REVOKE de authenticated) que retorna a chave DECRIPTADA do provedor a partir do Vault. Fallback de leitura usado exclusivamente pela Edge Function assistant-ai. NUNCA exposta ao frontend. admin-assistant 047.';


-- ========== 6. RPCs de conversa / mensagem ==========
--
-- rpc_assistant_list_conversations() -> gated ASSISTANT_VIEW; sumarios das
--   Chat_Conversation em ordem cronologica DECRESCENTE por updated_at (Req 6.1).
-- rpc_assistant_load_conversation(p_id) -> gated ASSISTANT_VIEW; mensagens da
--   conversa em ordem cronologica CRESCENTE por created_at (Req 5.7, 6.2). O
--   indice idx_assistant_messages_conversation_created_at cobre.
-- rpc_assistant_post_message(p_conversation_id, p_role, p_content) -> gated
--   ASSISTANT_VIEW; valida `role` no dominio fechado (fora => RAISE, Req 5.5);
--   cria a conversa quando p_conversation_id e nulo; insere a mensagem e toca
--   o updated_at da conversa (Req 6.2, 6.3).
--
-- Posture padrao (admin-patterns Sec. 10): SECURITY DEFINER, search_path,
-- auth.uid(), log negativo ASSISTANT_VIEW_DENIED, REVOKE/GRANT.

-- 6.1 - rpc_assistant_list_conversations(): sumarios DESC por updated_at.
CREATE OR REPLACE FUNCTION rpc_assistant_list_conversations()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'list_conversations'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',         c.id,
             'title',      c.title,
             'created_at', c.created_at,
             'updated_at', c.updated_at
           ) ORDER BY c.updated_at DESC
         ), '[]'::jsonb)
    INTO v_result
    FROM assistant_conversations c;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_list_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_list_conversations() TO authenticated;

COMMENT ON FUNCTION rpc_assistant_list_conversations()
  IS 'RPC STABLE SECURITY DEFINER (ASSISTANT_VIEW) que retorna sumarios de Chat_Conversation em ordem DESC por updated_at. Path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';

-- 6.2 - rpc_assistant_load_conversation(p_id): mensagens ASC por created_at.
CREATE OR REPLACE FUNCTION rpc_assistant_load_conversation(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'load_conversation'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',              m.id,
             'conversation_id', m.conversation_id,
             'role',            m.role,
             'content',         m.content,
             'created_at',      m.created_at
           ) ORDER BY m.created_at ASC
         ), '[]'::jsonb)
    INTO v_result
    FROM assistant_messages m
   WHERE m.conversation_id = p_id;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_load_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_load_conversation(uuid) TO authenticated;

COMMENT ON FUNCTION rpc_assistant_load_conversation(uuid)
  IS 'RPC STABLE SECURITY DEFINER (ASSISTANT_VIEW) que retorna as Chat_Message de uma conversa em ordem ASC por created_at. Path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';

-- 6.3 - rpc_assistant_post_message(): valida role, cria conversa se nulo, toca updated_at.
CREATE OR REPLACE FUNCTION rpc_assistant_post_message(p_conversation_id uuid, p_role text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller     uuid := auth.uid();
  v_conv_id    uuid := p_conversation_id;
  v_msg        record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'post_message'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Validacao de dominio fechado de role (Req 5.5): fora do dominio => RAISE
  -- (espelha o CHECK da tabela assistant_messages e o assertChatRole do TS).
  IF p_role IS NULL OR p_role NOT IN ('user', 'assistant', 'system') THEN
    RAISE EXCEPTION 'INVALID_CHAT_ROLE: %', COALESCE(p_role, 'null') USING ERRCODE = 'P0001';
  END IF;

  IF p_content IS NULL OR length(p_content) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: conteudo vazio' USING ERRCODE = 'P0001';
  END IF;

  -- Cria conversa quando p_conversation_id e nulo (Req 6.1, 6.3); titulo
  -- derivado das primeiras palavras do conteudo do usuario.
  IF v_conv_id IS NULL THEN
    INSERT INTO assistant_conversations (title)
    VALUES (left(p_content, 60))
    RETURNING id INTO v_conv_id;
  ELSE
    -- Conversa informada deve existir.
    IF NOT EXISTS (SELECT 1 FROM assistant_conversations WHERE id = v_conv_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: conversa %', v_conv_id USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO assistant_messages (conversation_id, role, content)
  VALUES (v_conv_id, p_role, p_content)
  RETURNING id, conversation_id, role, content, created_at INTO v_msg;

  -- Toca updated_at da conversa (Req 6.3) para manter a ordenacao DESC do mural/lista.
  UPDATE assistant_conversations SET updated_at = now() WHERE id = v_conv_id;

  RETURN jsonb_build_object(
    'id',              v_msg.id,
    'conversation_id', v_msg.conversation_id,
    'role',            v_msg.role,
    'content',         v_msg.content,
    'created_at',      v_msg.created_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_post_message(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_post_message(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION rpc_assistant_post_message(uuid, text, text)
  IS 'RPC SECURITY DEFINER (ASSISTANT_VIEW) que insere uma Chat_Message validando role no dominio fechado (fora => RAISE), cria a conversa quando p_conversation_id e nulo e toca updated_at da conversa. Path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';


-- ========== 7. RPCs de evento critico / status ==========
--
-- rpc_assistant_persist_critical_event(p_event jsonb) -> invocada pela
--   Monitor_Edge_Function (Bearer service-role), NAO gated por ASSISTANT_VIEW
--   (o monitor roda server-side, sem auth.uid() de admin). Insere o
--   Critical_Event com deduplicacao idempotente via ON CONFLICT (dedup_key)
--   DO NOTHING (Req 12.7); preenche conversation_id (conversa onde a mensagem
--   automatica foi publicada) e notified_at. Retorna { persisted, id } —
--   persisted=false quando o evento ja existia (dedup).
-- rpc_assistant_get_status() -> gated ASSISTANT_VIEW; deriva ativo/inativo de
--   is_set da chave do active_provider (Req 7.6, 7.7), retorna active_provider
--   + model e os ultimos Critical_Event detectados (DESC por detected_at).
--
-- Posture (admin-patterns Sec. 10): SECURITY DEFINER, search_path, REVOKE/GRANT.
-- get_status segue o gating padrao com log negativo ASSISTANT_VIEW_DENIED;
-- persist_critical_event e server-only (GRANT a service_role).

-- 7.1 - rpc_assistant_persist_critical_event(): insere com dedup idempotente.
CREATE OR REPLACE FUNCTION rpc_assistant_persist_critical_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_event_type text;
  v_severity   text;
  v_summary    text;
  v_scope      text;
  v_dedup_key  text;
  v_conv_id    uuid;
  v_notified   timestamptz;
  v_id         uuid;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT: evento deve ser um objeto JSON' USING ERRCODE = 'P0001';
  END IF;

  v_event_type := p_event ->> 'event_type';
  v_severity   := COALESCE(p_event ->> 'severity', 'warning');
  v_summary    := p_event ->> 'summary';
  v_scope      := COALESCE(p_event ->> 'scope', 'global');
  v_dedup_key  := p_event ->> 'dedup_key';

  -- Validacao de dominios fechados (espelha os CHECKs da tabela).
  IF v_event_type IS NULL OR v_event_type NOT IN
       ('page_error_rate','request_failure_rate','unauthorized_access_attempt',
        'failed_login_burst','payment_failure','db_performance_drop') THEN
    RAISE EXCEPTION 'INVALID_EVENT_TYPE: %', COALESCE(v_event_type, 'null') USING ERRCODE = 'P0001';
  END IF;
  IF v_severity NOT IN ('info','warning','critical') THEN
    RAISE EXCEPTION 'INVALID_SEVERITY: %', v_severity USING ERRCODE = 'P0001';
  END IF;
  IF v_summary IS NULL OR length(v_summary) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: summary vazio' USING ERRCODE = 'P0001';
  END IF;
  IF v_dedup_key IS NULL OR length(v_dedup_key) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: dedup_key vazio' USING ERRCODE = 'P0001';
  END IF;

  -- conversation_id e notified_at sao opcionais; preenchidos quando fornecidos.
  v_conv_id := NULLIF(p_event ->> 'conversation_id', '')::uuid;
  BEGIN
    v_notified := COALESCE((p_event ->> 'notified_at')::timestamptz, now());
  EXCEPTION WHEN others THEN
    v_notified := now();
  END;

  -- Deduplicacao idempotente (Req 12.7): UNIQUE (dedup_key) + ON CONFLICT DO
  -- NOTHING. Reexecucoes do monitor na mesma janela nao republicam o evento.
  INSERT INTO assistant_critical_events
    (event_type, severity, summary, scope, dedup_key, conversation_id, notified_at)
  VALUES
    (v_event_type, v_severity, v_summary, v_scope, v_dedup_key, v_conv_id, v_notified)
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Ja existia (dedup): retorna o id existente sem mutar nada.
    SELECT id INTO v_id FROM assistant_critical_events WHERE dedup_key = v_dedup_key LIMIT 1;
    RETURN jsonb_build_object('persisted', false, 'id', v_id);
  END IF;

  RETURN jsonb_build_object('persisted', true, 'id', v_id);
END;
$func$;

-- Server-only: invocada pela Monitor_Edge_Function via service-role. Nega
-- PUBLIC; concede a service_role (postgres owner ja executa). Nao exposta ao
-- frontend, que so consome eventos via leitura gated (get_status / RLS).
REVOKE ALL ON FUNCTION rpc_assistant_persist_critical_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_persist_critical_event(jsonb) TO service_role;

COMMENT ON FUNCTION rpc_assistant_persist_critical_event(jsonb)
  IS 'RPC SECURITY DEFINER server-only (GRANT a service_role) invocada pela Monitor_Edge_Function. Insere Critical_Event com dedup idempotente ON CONFLICT (dedup_key) DO NOTHING; preenche conversation_id/notified_at. Retorna { persisted, id }. admin-assistant 047.';

-- 7.2 - rpc_assistant_get_status(): ativo/inativo + provider/model + ultimos eventos.
CREATE OR REPLACE FUNCTION rpc_assistant_get_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller        uuid := auth.uid();
  v_active        text;
  v_model         text;
  v_key_set       boolean;
  v_recent        jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('ASSISTANT_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'ASSISTANT_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'get_status'));
    RAISE EXCEPTION 'permission_denied: ASSISTANT_VIEW required' USING ERRCODE = '42501';
  END IF;

  -- Provider ativo + modelo (defaults defensivos se a seed ainda nao rodou).
  SELECT active_provider, model INTO v_active, v_model
    FROM assistant_config WHERE id = true LIMIT 1;
  v_active := COALESCE(v_active, 'claude');
  v_model  := COALESCE(v_model, 'claude-3-5-sonnet-latest');

  -- is_set da chave do provedor ativo (derivado do Vault). active = is_set
  -- do active_provider (Req 7.7): sem chave => assistente inativo.
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
     WHERE s.name = 'assistant_provider_key_' || v_active
       AND s.decrypted_secret IS NOT NULL
       AND length(s.decrypted_secret) > 0
  ) INTO v_key_set;

  -- Ultimos Critical_Event detectados (DESC por detected_at), limitado a 10.
  SELECT COALESCE(jsonb_agg(e ORDER BY e_detected_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT jsonb_build_object(
               'id',              ce.id,
               'event_type',      ce.event_type,
               'severity',        ce.severity,
               'summary',         ce.summary,
               'scope',           ce.scope,
               'conversation_id', ce.conversation_id,
               'detected_at',     ce.detected_at,
               'notified_at',     ce.notified_at
             ) AS e,
             ce.detected_at AS e_detected_at
        FROM assistant_critical_events ce
       ORDER BY ce.detected_at DESC
       LIMIT 10
    ) recent;

  RETURN jsonb_build_object(
    'active',                 v_key_set,
    'active_provider',        v_active,
    'model',                  v_model,
    'provider_key_set',       v_key_set,
    'recent_critical_events', v_recent
  );
END;
$func$;

REVOKE ALL ON FUNCTION rpc_assistant_get_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_assistant_get_status() TO authenticated;

COMMENT ON FUNCTION rpc_assistant_get_status()
  IS 'RPC STABLE SECURITY DEFINER (ASSISTANT_VIEW) que retorna o Assistant_Status: active (= is_set da chave do active_provider), active_provider, model e ultimos Critical_Event (DESC). Path negativo grava ASSISTANT_VIEW_DENIED. admin-assistant 047.';


-- ========== 8. Seed de config + agendamento pg_cron ==========
--
-- 8.1 - Seed do registro unico de Assistant_Config (Req 15.6). ON CONFLICT
--   (id) DO NOTHING garante idempotencia e NAO sobrescreve valores ja
--   ajustados pelo dono em reexecucoes. Os defaults das colunas (secao 2.5)
--   ja entregam active_provider='claude', whatsapp_toggle=false, thresholds
--   validos (>=1) e cron_interval_minutes=1 (dentro de 1..5); explicitamos os
--   valores aqui para deixar o estado inicial auto-documentado.
INSERT INTO assistant_config (
  id,
  active_provider,
  model,
  threshold_page_error_rate,
  threshold_request_failure_rate,
  threshold_failed_login_burst,
  cron_interval_minutes,
  whatsapp_toggle
) VALUES (
  true,
  'claude',
  'claude-3-5-sonnet-latest',
  10,
  10,
  5,
  1,
  false
)
ON CONFLICT (id) DO NOTHING;

-- 8.2 - Agendamento idempotente do Cron_Job (Req 12.1, 13.1, 15.8) que invoca
--   a Monitor_Edge_Function (assistant-monitor) a cada 1 min (dentro de 1..5).
--   A URL e a service key sao lidas do Vault (padrao 042b: secrets `edge_url`
--   e `service_role_key`).
--
--   Guarda defensiva: pg_cron e pg_net NAO sao garantidos em todo ambiente
--   (ex.: shadow DB de testes locais). Envolvemos tudo num DO block que so
--   agenda quando ambas as extensoes existem; caso contrario emite um WARNING
--   e segue, mantendo a migration idempotente e sem hard-fail (Req 15.3).
--   Quando agendado, primeiro desagenda o job anterior se existir (evita
--   duplicidade em reexecucao, Req 15.8) e entao reagenda.
DO $cron$
DECLARE
  v_url         text;
  v_service_key text;
BEGIN
  -- pg_cron e pg_net presentes? (schemas cron / net expostos pelas extensoes)
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'pg_cron/pg_net ausentes: assistant_monitor_job NAO agendado (habilite as extensoes e reaplique a secao 8.2)';
    RETURN;
  END IF;

  -- Le config do Vault (mesmos secrets da migration 042b). Sem config => nao
  -- agenda (o monitor nao teria como ser invocado); apenas avisa.
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'edge_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'Vault sem edge_url/service_role_key: assistant_monitor_job NAO agendado (crie os secrets e reaplique a secao 8.2)';
    RETURN;
  END IF;

  -- Desagenda anterior se existir (idempotencia: evita jobs duplicados).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assistant_monitor_job') THEN
    PERFORM cron.unschedule('assistant_monitor_job');
  END IF;

  -- Agenda a cada 1 min (dentro de 1..5). O corpo dispara a Edge Function via
  -- net.http_post (assincrono) autenticando com Bearer service-role.
  PERFORM cron.schedule(
    'assistant_monitor_job',
    '* * * * *',
    format(
      $job$SELECT net.http_post(
             url := %L,
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || %L
             ),
             body := jsonb_build_object('source', 'assistant_monitor_job')
           );$job$,
      v_url || '/functions/v1/assistant-monitor',
      v_service_key
    )
  );
END
$cron$;


COMMIT;

-- ========== VERIFY (smoke test manual, permanentemente comentado) ==========
-- Reaplicar manualmente apos o deploy para validar o estado do schema. Mantido
-- comentado (nao executa no apply). Cobre: config semeada, RLS ativa em todas
-- as tabelas, cron agendado e presenca das RPCs do modulo.
/*
-- (a) RBAC: ASSISTANT_VIEW/EDIT concedidas so a SUPER_ADMIN (espera-se que a
--     funcao exista; o booleano depende do papel do caller corrente).
SELECT proname FROM pg_proc WHERE proname = 'is_admin_with_permission';

-- (b) Config semeada: exatamente 1 linha, claude, whatsapp off, cron em 1..5.
SELECT id, active_provider, model, whatsapp_toggle,
       threshold_page_error_rate, threshold_request_failure_rate,
       threshold_failed_login_burst, cron_interval_minutes
  FROM assistant_config;            -- espera 1 linha: id=t, active_provider='claude'

-- (c) RLS habilitada nas 5 tabelas do modulo (relrowsecurity = true para todas).
SELECT relname, relrowsecurity
  FROM pg_class
 WHERE relname IN ('error_logs','assistant_conversations','assistant_messages',
                   'assistant_critical_events','assistant_config')
 ORDER BY relname;

-- (d) Policies Owner_Only_Gate presentes (>= 1 policy por tabela).
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE tablename IN ('error_logs','assistant_conversations','assistant_messages',
                     'assistant_critical_events','assistant_config')
 ORDER BY tablename, policyname;

-- (e) RPCs do modulo presentes (espera 11 funcoes rpc_assistant_*).
SELECT proname
  FROM pg_proc
 WHERE proname IN (
   'rpc_assistant_ingest_errors','rpc_assistant_get_config','rpc_assistant_update_config',
   'rpc_assistant_set_secret','rpc_assistant_clear_secret','rpc_assistant_read_provider_key',
   'rpc_assistant_list_conversations','rpc_assistant_load_conversation','rpc_assistant_post_message',
   'rpc_assistant_persist_critical_event','rpc_assistant_get_status')
 ORDER BY proname;

-- (f) Cron agendado (1 job 'assistant_monitor_job' quando pg_cron + Vault ok).
SELECT jobname, schedule FROM cron.job WHERE jobname = 'assistant_monitor_job';

-- (g) Segredos de provedor no Vault (nomes apenas; nunca o valor bruto).
SELECT name FROM vault.decrypted_secrets WHERE name LIKE 'assistant_provider_key_%';
*/
