-- ============================================================================
-- Migration 048: Admin Marketing - Meta Ads (config, eventos, cache de metricas)
-- ============================================================================
-- Adiciona o modulo Marketing do painel administrativo sobre as fundacoes:
--   - 030 admin_foundation   (is_admin_with_permission, executeAdminMutation,
--                            admin_audit_logs, padrao de RPC SECURITY DEFINER)
--   - 042b push_config_via_vault (extension supabase_vault habilitada; o
--                            Meta_Access_Token e guardado criptografado no Vault,
--                            nunca em coluna legivel -- Req 3.2, 12, CP-7)
--
-- OBJETIVO:
--   Modulo Marketing = integracao somente-leitura com a Meta Marketing API
--   (metricas de anuncios) + Meta Pixel/CAPI (eventos com deduplicacao por
--   event_id e PII hasheada SHA-256). Esta migration entrega o schema (3
--   tabelas), RLS de bloqueio total (no_dml) e o scaffold das RPCs/seed.
--
-- ESTA MIGRATION ENTREGA (Epic 1 do tasks.md):
--   [task 1.1 -- ESTE ARQUIVO, parte atual]
--     - Bloco DO $check$ defensivo (030 + admin_audit_logs + supabase_vault)
--     - Tabela marketing_config       (single-row, referencia ao segredo no Vault)
--     - Tabela marketing_events       (log server-side de eventos CAPI, PII hasheada)
--     - Tabela marketing_metrics_cache (snapshots de metricas por periodo)
--     - RLS ENABLE + policy *_no_dml (FOR ALL USING(false) WITH CHECK(false))
--       em todas as 3 -- todo acesso real passa por RPCs SECURITY DEFINER
--   [tasks 1.2..1.6 -- editam ESTE MESMO arquivo, ver secoes TODO no fim]
--     - 1.2 recriar is_admin_with_permission com paridade MARKETING_VIEW/EDIT
--     - 1.3 RPCs de config (marketing_config_get / _update)
--     - 1.4 RPCs de token via Vault (marketing_token_set / _clear)
--     - 1.5 RPCs helper de cache (marketing_cache_read / _write)
--     - 1.6 seed singleton + bloco -- VERIFY (smoke test comentado)
--
-- IDEMPOTENTE: aplicar 2x nao falha nem duplica objetos
--   (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--    CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS antes de CREATE POLICY,
--    INSERT ... ON CONFLICT DO NOTHING em seeds).
--
-- ROLLBACK: 048_admin_marketing_rollback.sql (nao auto-aplicado; o segredo no
--   Vault deve ser removido manualmente).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Validacoes defensivas (ver admin-patterns.md Sec. 9)
-- ============================================================================

-- 1.1 - Migration 030 (admin-foundation) aplicada: is_admin_with_permission existe.
--       Necessaria para o gating server-side de todas as RPCs (tasks 1.2..1.5).
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

-- 1.2 - admin_audit_logs existe (migration 030) com a coluna after_data usada
--       pelos action codes de marketing (MARKETING_CONFIG_UPDATED,
--       MARKETING_TOKEN_UPDATED, MARKETING_TOKEN_CLEARED, MARKETING_VIEW_DENIED).
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs'
      AND column_name = 'after_data'
  ) THEN
    RAISE EXCEPTION 'admin_audit_logs.after_data ausente -- schema inesperado';
  END IF;
END
$check$;

-- 1.3 - users existe (referenciada por marketing_config.updated_by).
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'users ausente -- schema inesperado';
  END IF;
END
$check$;

-- 1.4 - Extension supabase_vault habilitada (migration 042b). O Meta_Access_Token
--       e armazenado criptografado via vault.create_secret e lido apenas
--       server-side pelas Edge Functions; marketing_config guarda somente a
--       referencia token_secret_id (Req 3.2, 12.2, 13.4, CP-7). Sem o Vault as
--       RPCs de token (task 1.4) nao funcionam -- falhar cedo e claro.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault'
  ) THEN
    RAISE EXCEPTION 'Extension supabase_vault nao habilitada (migration 042b ausente) -- requerida para o Meta_Access_Token (Req 13.4, CP-7)';
  END IF;
END
$check$;


-- ============================================================================
-- 2. Tabela marketing_config (single-row) + RLS no_dml
-- ============================================================================
-- Configuracao vigente da integracao Meta. Linha unica (singleton) com
-- versionamento otimista por updated_at (admin-patterns.md Sec. 3). O
-- Meta_Access_Token NUNCA vive aqui: a coluna token_secret_id guarda apenas a
-- referencia (uuid) ao segredo no Vault; token_last4 cacheia os ultimos 4 chars
-- para compor o Masked_Token sem reler o Vault (CP-7). Decisao D1/D2 do design.
--
-- RLS: bloqueio total de DML direto via policy marketing_config_no_dml. Todo
-- acesso real passa pelas RPCs SECURITY DEFINER (tasks 1.3, 1.4), que bypassam
-- RLS por design. Mesmo padrao herdado de admin_blacklist (035) e
-- financial_settings (037).

CREATE TABLE IF NOT EXISTS marketing_config (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id    text        NULL CHECK (ad_account_id IS NULL OR ad_account_id ~ '^act_[0-9]+$'),
  pixel_id         text        NULL CHECK (pixel_id IS NULL OR pixel_id ~ '^[0-9]+$'),
  default_period   text        NOT NULL DEFAULT '7d'
                                CHECK (default_period IN ('today','7d','30d')),
  consent_required boolean     NOT NULL DEFAULT true,
  token_secret_id  uuid        NULL,   -- referencia ao segredo no Vault, NUNCA o valor
  token_last4      text        NULL CHECK (token_last4 IS NULL OR char_length(token_last4) <= 4),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_by       uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  -- garante single-row: sempre id fixo via seed + RPCs operam na linha vigente
  singleton        boolean     NOT NULL DEFAULT true UNIQUE CHECK (singleton = true)
);

ALTER TABLE marketing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_config_no_dml ON marketing_config;
CREATE POLICY marketing_config_no_dml
  ON marketing_config FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE  marketing_config                 IS 'Configuracao vigente da integracao Meta (single-row). Token vive somente no Vault; aqui so a referencia. Acesso via RPCs SECURITY DEFINER (admin-marketing 048).';
COMMENT ON COLUMN marketing_config.ad_account_id   IS 'Ad_Account_Id da Meta no formato act_<digits>. NULL ate ser configurado (Req 3.8).';
COMMENT ON COLUMN marketing_config.pixel_id        IS 'Pixel_Id numerico do Meta Pixel. NULL ate ser configurado (Req 3.10).';
COMMENT ON COLUMN marketing_config.default_period  IS 'Metric_Period default do painel: today | 7d | 30d. Valor inicial 7d (Req 3.12).';
COMMENT ON COLUMN marketing_config.consent_required IS 'Flag LGPD. Mesmo false, o Pixel do navegador so carrega apos consentimento (Req 8.6).';
COMMENT ON COLUMN marketing_config.token_secret_id IS 'UUID retornado por vault.create_secret. Referencia ao Meta_Access_Token criptografado no Vault. NUNCA o valor bruto (D2, Req 3.2, 12, CP-7).';
COMMENT ON COLUMN marketing_config.token_last4     IS 'Cache dos ultimos 4 chars para compor o Masked_Token sem reler o Vault no marketing_config_get (CP-7). NULL quando is_set=false.';
COMMENT ON COLUMN marketing_config.updated_at      IS 'Instante da ultima mutacao. Usado para versionamento otimista (admin-patterns.md Sec. 3; Req 3.11).';
COMMENT ON COLUMN marketing_config.updated_by      IS 'Admin que atualizou a config (FK users.id, ON DELETE SET NULL para preservar a linha mesmo se a conta for removida).';
COMMENT ON COLUMN marketing_config.singleton       IS 'Forca linha unica (UNIQUE + CHECK singleton=true). Seed inicial via INSERT ... ON CONFLICT DO NOTHING (task 1.6).';


-- ============================================================================
-- 3. Tabela marketing_events + indice + RLS no_dml
-- ============================================================================
-- Log server-side dos eventos enviados via CAPI (Meta_CAPI_Function). event_id
-- e compartilhado com o Pixel para deduplicacao na Meta (CP-4) e UNIQUE para
-- que reenvios nao dupliquem o log (Req 9.8; a Edge usa ON CONFLICT (event_id)).
-- As colunas *_hash guardam SOMENTE SHA-256 (64 hex minusculos); o CHECK reforca
-- o formato (defesa em profundidade, CP-6). PII em texto claro NUNCA e
-- persistido (Req 11.6).
--
-- RLS: bloqueio total de DML direto via policy marketing_events_no_dml. Escrita
-- exclusivamente server-side (Edge service-role); RLS bloqueia DML por
-- authenticated. Mesmo padrao de marketing_config acima.

CREATE TABLE IF NOT EXISTS marketing_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL UNIQUE,         -- compartilhado c/ Pixel (dedup, Req 9.8)
  event_name      text        NOT NULL CHECK (event_name IN
                              ('page_view','lead','motorista_registration',
                               'embarcador_registration','frete_published')),
  visitor_id_hash text        NULL CHECK (visitor_id_hash IS NULL OR visitor_id_hash ~ '^[0-9a-f]{64}$'),
  user_id_hash    text        NULL CHECK (user_id_hash IS NULL OR user_id_hash ~ '^[0-9a-f]{64}$'),
  email_hash      text        NULL CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  phone_hash      text        NULL CHECK (phone_hash IS NULL OR phone_hash ~ '^[0-9a-f]{64}$'),
  event_time      timestamptz NOT NULL DEFAULT NOW(),
  send_status     text        NOT NULL DEFAULT 'pending'
                              CHECK (send_status IN ('pending','sent','failed')),
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_events_event_time
  ON marketing_events (event_time DESC);

ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_events_no_dml ON marketing_events;
CREATE POLICY marketing_events_no_dml
  ON marketing_events FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE  marketing_events                 IS 'Log server-side dos eventos enviados via CAPI. Escrita so pela Edge (service-role); acesso via SECURITY DEFINER (admin-marketing 048).';
COMMENT ON COLUMN marketing_events.event_id        IS 'UUID v4 compartilhado com o disparo do Pixel para deduplicacao na Meta (CP-4). UNIQUE: reenvio CAPI nao duplica o log (Req 9.8).';
COMMENT ON COLUMN marketing_events.event_name      IS 'Tracked_Event do dominio fechado: page_view | lead | motorista_registration | embarcador_registration | frete_published.';
COMMENT ON COLUMN marketing_events.visitor_id_hash IS 'SHA-256 (64 hex minusculos) do visitor id, ou NULL. PII em claro nunca persistida (CP-6, Req 11.6).';
COMMENT ON COLUMN marketing_events.user_id_hash    IS 'SHA-256 (64 hex minusculos) do user id, ou NULL.';
COMMENT ON COLUMN marketing_events.email_hash      IS 'SHA-256 (64 hex minusculos) do e-mail normalizado (trim+lowercase), ou NULL (CP-6).';
COMMENT ON COLUMN marketing_events.phone_hash      IS 'SHA-256 (64 hex minusculos) do telefone normalizado (so digitos com DDI), ou NULL (CP-6).';
COMMENT ON COLUMN marketing_events.send_status     IS 'Estado do envio CAPI: pending | sent | failed. Falha CAPI grava failed e preserva o registro (Req 9.6).';


-- ============================================================================
-- 4. Tabela marketing_metrics_cache + indice + RLS no_dml
-- ============================================================================
-- Cache de snapshots de metricas por (ad_account_id, period_key), evitando
-- consultas excessivas a Meta Marketing API (Req 7). O indice com fetched_at
-- DESC suporta a busca do snapshot mais recente. snapshot guarda o agregado
-- (Campaign_Metrics + Creative_Performance + series) como jsonb.
--
-- RLS: bloqueio total de DML direto via policy marketing_metrics_cache_no_dml.
-- Leitura/escrita exclusivamente server-side (Edge via RPCs helper, task 1.5).

CREATE TABLE IF NOT EXISTS marketing_metrics_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id text        NOT NULL CHECK (ad_account_id ~ '^act_[0-9]+$'),
  period_key    text        NOT NULL CHECK (period_key IN ('today','7d','30d')),
  snapshot      jsonb       NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_metrics_cache_lookup
  ON marketing_metrics_cache (ad_account_id, period_key, fetched_at DESC);

ALTER TABLE marketing_metrics_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_metrics_cache_no_dml ON marketing_metrics_cache;
CREATE POLICY marketing_metrics_cache_no_dml
  ON marketing_metrics_cache FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE  marketing_metrics_cache               IS 'Cache de snapshots de metricas por (ad_account_id, period_key). Evita consultas excessivas a Meta (Req 7). Acesso server-side via RPCs helper (admin-marketing 048).';
COMMENT ON COLUMN marketing_metrics_cache.ad_account_id IS 'Ad_Account_Id (act_<digits>) ao qual o snapshot pertence.';
COMMENT ON COLUMN marketing_metrics_cache.period_key    IS 'Metric_Period do snapshot: today | 7d | 30d.';
COMMENT ON COLUMN marketing_metrics_cache.snapshot      IS 'Agregado jsonb (Campaign_Metrics + Creative_Performance + series) retornado ao painel.';
COMMENT ON COLUMN marketing_metrics_cache.fetched_at    IS 'Instante em que o snapshot foi obtido da Meta. Usado para frescor (Req 7.3) e indicador stale (Req 7.4, 7.5).';


-- ============================================================================
-- 5. RBAC: is_admin_with_permission -- paridade MARKETING_VIEW / MARKETING_EDIT
-- ============================================================================
-- Recriacao idempotente (CREATE OR REPLACE) que reproduz a Permission_Matrix
-- server-side, preservando integralmente o corpo da definicao mais recente em
-- producao (migration 047_admin_assistant.sql) e garantindo paridade 1:1 com
-- src/services/admin/permissions.ts. Esta migration NAO altera as listas dos
-- demais papeis -- apenas reafirma a funcao com a documentacao de paridade do
-- modulo Marketing (mesmo padrao herdado: cada modulo admin recria a funcao).
--
-- PARIDADE 1:1 COM permissions.ts (MARKETING_VIEW / MARKETING_EDIT):
--   - SUPER_ADMIN  => Permission_Matrix.SUPER_ADMIN = () => true.
--                     Ramo `a.role = 'SUPER_ADMIN'` retorna true para QUALQUER
--                     acao, logo concede MARKETING_VIEW/EDIT por wildcard.
--   - ADMIN        => Permission_Matrix.ADMIN = ALL.has(a) && !ADMIN_DENY.has(a).
--                     Ramo ADMIN concede tudo EXCETO a deny-list
--                     (USER_DELETE, ADMIN_ROLE_GRANT, ADMIN_ROLE_REVOKE,
--                      ASSISTANT_VIEW, ASSISTANT_EDIT). MARKETING_VIEW/EDIT
--                     NAO estao na deny-list, logo sao concedidas por
--                     construcao (NOT IN). Espelha ADMIN_DENY do TS, onde
--                     MARKETING_* tambem esta ausente.
--   - FINANCEIRO   => allowlist do TS (FINANCEIRO_PERMS) NAO inclui MARKETING_*;
--   - SUPORTE      => allowlist do TS (SUPORTE_PERMS) NAO inclui MARKETING_*;
--   - MODERADOR    => allowlist do TS (MODERADOR_PERMS) NAO inclui MARKETING_*.
--                     Os tres ramos usam `p_action IN (...)` SEM MARKETING_*,
--                     portanto negam por construcao (deny-by-default) -- exatamente
--                     como o TS nega quem nao tem a acao no proprio *_PERMS set
--                     (Req 2.3).
--
-- Caller anonimo (auth.uid() nulo) nao possui linha em `active`, logo a funcao
-- retorna false (deny-by-default preservado, Req 2.7). Mantem SECURITY DEFINER,
-- SET search_path = public e os grants identicos a definicao anterior.
--   Requirements: 2.2, 2.3, 2.4

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


-- ============================================================================
-- 6. RPCs de configuracao: marketing_config_get / marketing_config_update
-- ============================================================================
-- Leitura e escrita da linha singleton de marketing_config. Ambas seguem a RPC
-- Security Posture (admin-patterns Sec. 2 e 10): SECURITY DEFINER, SET
-- search_path = public, auth.uid() obrigatorio, gating via
-- is_admin_with_permission com log negativo MARKETING_VIEW_DENIED, e
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Mesmo padrao das
-- RPCs de config do admin-assistant (047: rpc_assistant_get_config /
-- rpc_assistant_update_config), reusado sem reinventar.
--
-- CONTRATO Masked_Token (CP-7): NENHUMA destas RPCs jamais retorna o
-- Meta_Access_Token bruto. O retorno expoe apenas:
--   - token_is_set := (token_secret_id IS NOT NULL)  -> indicador booleano
--   - token_last4  := marketing_config.token_last4   -> cache dos ultimos 4
--     chars (Masked_Token), lido direto da coluna, SEM tocar no Vault. O valor
--     bruto so e lido server-side pelas Edge Functions (tasks 6.x).

-- 6.1 - marketing_config_get(): config vigente + Masked_Token (CP-7).
--   Gated por MARKETING_VIEW. Path negativo grava MARKETING_VIEW_DENIED
--   (before_data=NULL, after_data={user_id, reason}) e levanta permission_denied
--   (ERRCODE 42501). STABLE: nao muta a config (o INSERT do log de denial e o
--   unico efeito, no caminho de excecao -- mesmo padrao do 047).
--   Requirements: 2.5, 2.7, 3.1, 3.3, 12.1, 12.2
CREATE OR REPLACE FUNCTION marketing_config_get()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_cfg    record;
BEGIN
  -- ---------- Gating: auth.uid() obrigatorio (caller anonimo => deny) ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- Gating: MARKETING_VIEW (log negativo antes do raise) ----------
  IF NOT is_admin_with_permission('MARKETING_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'MARKETING_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'config_get'));
    RAISE EXCEPTION 'permission_denied: MARKETING_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM marketing_config WHERE singleton = true LIMIT 1;

  -- Fallback defensivo: a seed (task 1.6) garante a linha singleton em runtime,
  -- mas se ausente retornamos os defaults para nao quebrar a leitura.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ad_account_id',    NULL,
      'pixel_id',         NULL,
      'default_period',   '7d',
      'consent_required', true,
      'token_is_set',     false,
      'token_last4',      NULL,
      'updated_at',       NULL,
      'updated_by',       NULL
    );
  END IF;

  -- CP-7: token_is_set + token_last4 (Masked_Token) -- NUNCA o valor bruto.
  RETURN jsonb_build_object(
    'ad_account_id',    v_cfg.ad_account_id,
    'pixel_id',         v_cfg.pixel_id,
    'default_period',   v_cfg.default_period,
    'consent_required', v_cfg.consent_required,
    'token_is_set',     (v_cfg.token_secret_id IS NOT NULL),
    'token_last4',      v_cfg.token_last4,
    'updated_at',       v_cfg.updated_at,
    'updated_by',       v_cfg.updated_by
  );
END;
$func$;

REVOKE ALL ON FUNCTION marketing_config_get() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_config_get() TO authenticated;

COMMENT ON FUNCTION marketing_config_get()
  IS 'RPC STABLE SECURITY DEFINER (MARKETING_VIEW) que retorna a config vigente de marketing com Masked_Token (token_is_set + token_last4, NUNCA o valor bruto -- CP-7). Path negativo grava MARKETING_VIEW_DENIED. admin-marketing 048.';

-- 6.2 - marketing_config_update(): update otimista single-row, com validacao.
--   Gated por MARKETING_EDIT (deny => permission_denied sem mutar a config).
--   Valida act_<digits> / pixel numerico / periodo no dominio ANTES de qualquer
--   efeito (invalido => RAISE tipado P0001, sem persistir). Versionamento
--   otimista vs updated_at (mismatch => STALE_VERSION P0001), relaxado quando a
--   linha ainda nao existe (instalacao fresh) ou p_expected_updated_at e NULL
--   (admin-patterns Sec. 3). ad_account_id/pixel_id podem ser NULL (so validados
--   quando fornecidos). Retorna a config atualizada na MESMA forma do _get
--   (Masked_Token, nunca o valor bruto -- CP-7). O audit positivo
--   (MARKETING_CONFIG_UPDATED) e gravado pelo wrapper TS executeAdminMutation
--   (task 4.1); a RPC grava apenas o path negativo MARKETING_VIEW_DENIED.
--   Requirements: 2.6, 2.7, 3.8, 3.9, 3.10, 3.11, 3.12, 12.1, 12.2
CREATE OR REPLACE FUNCTION marketing_config_update(
  p_ad_account_id       text,
  p_pixel_id            text,
  p_default_period      text,
  p_consent_required    boolean,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller  uuid := auth.uid();
  v_current timestamptz;
  v_found   boolean;
  v_cfg     record;
BEGIN
  -- ---------- Gating: auth.uid() obrigatorio (caller anonimo => deny) ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- Gating: MARKETING_EDIT (deny sem mutar; log negativo) ----------
  IF NOT is_admin_with_permission('MARKETING_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'MARKETING_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'config_update'));
    RAISE EXCEPTION 'permission_denied: MARKETING_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- ---------- Validacao de input (so quando fornecido; antes de qualquer efeito) ----------
  -- Ad_Account_Id: formato act_<digits> (Req 3.8). NULL e permitido (limpa o campo).
  IF p_ad_account_id IS NOT NULL AND p_ad_account_id !~ '^act_[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_AD_ACCOUNT_ID: %', p_ad_account_id USING ERRCODE = 'P0001';
  END IF;

  -- Pixel_Id: somente digitos (Req 3.10). NULL e permitido (limpa o campo).
  IF p_pixel_id IS NOT NULL AND p_pixel_id !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_PIXEL_ID: %', p_pixel_id USING ERRCODE = 'P0001';
  END IF;

  -- Metric_Period: dominio fechado (Req 3.12). Validado quando fornecido.
  IF p_default_period IS NOT NULL AND p_default_period NOT IN ('today','7d','30d') THEN
    RAISE EXCEPTION 'INVALID_PERIOD: %', p_default_period USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Versionamento otimista (relaxado: linha fresh / expected NULL) ----------
  SELECT updated_at INTO v_current FROM marketing_config WHERE singleton = true LIMIT 1;
  v_found := FOUND;

  IF v_found
     AND p_expected_updated_at IS NOT NULL
     AND v_current IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- ---------- UPDATE single-row (ou INSERT defensivo se a linha ainda nao existe) ----------
  -- default_period/consent_required: COALESCE preserva o valor atual quando o
  -- parametro vem NULL. ad_account_id/pixel_id sao setados diretamente (NULL
  -- limpa o campo, conforme contrato de full-config-update).
  IF v_found THEN
    UPDATE marketing_config SET
      ad_account_id    = p_ad_account_id,
      pixel_id         = p_pixel_id,
      default_period   = COALESCE(p_default_period, default_period),
      consent_required = COALESCE(p_consent_required, consent_required),
      updated_by       = v_caller,
      updated_at       = now()
    WHERE singleton = true
    RETURNING * INTO v_cfg;
  ELSE
    INSERT INTO marketing_config
      (ad_account_id, pixel_id, default_period, consent_required, updated_by, updated_at, singleton)
    VALUES
      (p_ad_account_id, p_pixel_id, COALESCE(p_default_period, '7d'),
       COALESCE(p_consent_required, true), v_caller, now(), true)
    RETURNING * INTO v_cfg;
  END IF;

  -- CP-7: mesma forma do _get -- token_is_set + token_last4, NUNCA o valor bruto.
  RETURN jsonb_build_object(
    'ad_account_id',    v_cfg.ad_account_id,
    'pixel_id',         v_cfg.pixel_id,
    'default_period',   v_cfg.default_period,
    'consent_required', v_cfg.consent_required,
    'token_is_set',     (v_cfg.token_secret_id IS NOT NULL),
    'token_last4',      v_cfg.token_last4,
    'updated_at',       v_cfg.updated_at,
    'updated_by',       v_cfg.updated_by
  );
END;
$func$;

REVOKE ALL ON FUNCTION marketing_config_update(text, text, text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_config_update(text, text, text, boolean, timestamptz) TO authenticated;

COMMENT ON FUNCTION marketing_config_update(text, text, text, boolean, timestamptz)
  IS 'RPC VOLATILE SECURITY DEFINER (MARKETING_EDIT) que atualiza a linha singleton de marketing_config. Valida act_<digits>/pixel numerico/periodo antes de persistir (RAISE tipado, sem efeito). Update otimista vs updated_at -> STALE_VERSION em mismatch (relaxado quando linha fresh / expected NULL). Retorna a config com Masked_Token (token_is_set + token_last4, NUNCA o valor bruto -- CP-7). Audit positivo (MARKETING_CONFIG_UPDATED) pelo wrapper TS; path negativo grava MARKETING_VIEW_DENIED. admin-marketing 048.';


-- ============================================================================
-- 7. RPCs de token via Vault: marketing_token_set / marketing_token_clear
-- ============================================================================
-- Escrita e remocao do Meta_Access_Token. O valor bruto vive SOMENTE no Vault
-- (supabase_vault, migration 042b) sob o nome estavel 'meta_access_token';
-- marketing_config guarda apenas a referencia token_secret_id (uuid) + o cache
-- token_last4 (ultimos 4 chars do Masked_Token). Espelham exatamente o padrao
-- Vault provado em producao pelas RPCs do admin-assistant (047:
-- rpc_assistant_set_secret / rpc_assistant_clear_secret): vault.create_secret
-- para criar, vault.update_secret para atualizar um segredo existente e
-- DELETE FROM vault.secrets para remover. Referencias ao Vault sempre
-- qualificadas como vault.* (search_path = public).
--
-- Posture (admin-patterns Sec. 2 e 10): SECURITY DEFINER, SET search_path =
-- public, auth.uid() obrigatorio, gating MARKETING_EDIT com log negativo
-- MARKETING_VIEW_DENIED, REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated.
--
-- CONTRATO Masked_Token (CP-7): estas RPCs NUNCA retornam o valor bruto. O
-- retorno expoe apenas { token_is_set, token_last4 }. O audit positivo
-- (MARKETING_TOKEN_UPDATED / MARKETING_TOKEN_CLEARED, somente metadados nao
-- sensiveis) e gravado pelo wrapper TS executeAdminMutation (task 4.1); a RPC
-- grava apenas o path negativo MARKETING_VIEW_DENIED.

-- Nome estavel do segredo no Vault. Estavel para que um set apos set atualize
-- SEMPRE o mesmo segredo (idempotente por nome), e nao crie orfaos.
-- (Definido inline nas funcoes abaixo como 'meta_access_token'.)

-- 7.1 - marketing_token_set(): grava (cria/atualiza) o token no Vault.
--   Gated por MARKETING_EDIT (deny => MARKETING_VIEW_DENIED + permission_denied
--   42501, sem mutar). Versionamento otimista vs updated_at (mismatch =>
--   STALE_VERSION P0001), relaxado quando a linha ainda nao existe (instalacao
--   fresh) ou p_expected_updated_at e NULL. Token em branco/vazio (NULL ou '')
--   em um save que NAO e remocao => preserva o segredo existente sem altera-lo
--   (Req 3.7) e retorna o is_set/last4 vigentes sem erro. Caso contrario grava
--   o valor bruto no Vault (vault.update_secret se token_secret_id ja existe,
--   senao adota segredo orfao de mesmo nome ou vault.create_secret), atualiza
--   token_secret_id + token_last4 (right(p_token,4)) e toca updated_by/updated_at.
--   Retorna { token_is_set: true, token_last4 } -- NUNCA o valor bruto (CP-7).
--   Requirements: 3.2, 3.7, 12.1, 12.2
CREATE OR REPLACE FUNCTION marketing_token_set(
  p_token               text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller      uuid := auth.uid();
  v_secret_name text := 'meta_access_token';
  v_cfg         record;
  v_found       boolean;
  v_secret_id   uuid;
  v_last4       text;
BEGIN
  -- ---------- Gating: auth.uid() obrigatorio (caller anonimo => deny) ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- Gating: MARKETING_EDIT (deny sem mutar; log negativo) ----------
  IF NOT is_admin_with_permission('MARKETING_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'MARKETING_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'token_set'));
    RAISE EXCEPTION 'permission_denied: MARKETING_EDIT required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM marketing_config WHERE singleton = true LIMIT 1;
  v_found := FOUND;

  -- ---------- Token em branco em save que NAO e remocao: preserva (Req 3.7) ----------
  -- Nao toca no Vault nem na config; retorna o estado vigente sem erro. A
  -- remocao explicita e feita por marketing_token_clear, nao por set('').
  IF p_token IS NULL OR length(p_token) = 0 THEN
    RETURN jsonb_build_object(
      'token_is_set', (v_found AND v_cfg.token_secret_id IS NOT NULL),
      'token_last4',  CASE WHEN v_found THEN v_cfg.token_last4 ELSE NULL END
    );
  END IF;

  -- ---------- Versionamento otimista (relaxado: linha fresh / expected NULL) ----------
  IF v_found
     AND p_expected_updated_at IS NOT NULL
     AND v_cfg.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Grava o segredo no Vault (cria/atualiza), nunca em coluna legivel ----------
  -- Preferencia: atualizar o segredo ja referenciado por token_secret_id; senao
  -- adotar um segredo orfao de mesmo nome (idempotencia); senao criar um novo.
  IF v_found AND v_cfg.token_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_cfg.token_secret_id, p_token);
    v_secret_id := v_cfg.token_secret_id;
  ELSE
    SELECT id INTO v_secret_id FROM vault.decrypted_secrets WHERE name = v_secret_name LIMIT 1;
    IF v_secret_id IS NULL THEN
      v_secret_id := vault.create_secret(p_token, v_secret_name, 'Meta Marketing API Access Token (admin-marketing 048, CP-7)');
    ELSE
      PERFORM vault.update_secret(v_secret_id, p_token);
    END IF;
  END IF;

  -- Masked_Token: cache dos ultimos 4 chars (CP-7). right(p_token, 4).
  v_last4 := right(p_token, 4);

  -- ---------- Persiste a referencia + last4 na config (UPDATE, ou INSERT fresh) ----------
  IF v_found THEN
    UPDATE marketing_config SET
      token_secret_id = v_secret_id,
      token_last4     = v_last4,
      updated_by      = v_caller,
      updated_at      = now()
    WHERE singleton = true;
  ELSE
    INSERT INTO marketing_config
      (token_secret_id, token_last4, updated_by, updated_at, singleton)
    VALUES
      (v_secret_id, v_last4, v_caller, now(), true);
  END IF;

  -- CP-7: somente { token_is_set, token_last4 } -- NUNCA o valor bruto.
  RETURN jsonb_build_object('token_is_set', true, 'token_last4', v_last4);
END;
$func$;

REVOKE ALL ON FUNCTION marketing_token_set(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_token_set(text, timestamptz) TO authenticated;

COMMENT ON FUNCTION marketing_token_set(text, timestamptz)
  IS 'RPC VOLATILE SECURITY DEFINER (MARKETING_EDIT) que grava o Meta_Access_Token no Vault (cria/atualiza o segredo meta_access_token) e guarda em marketing_config apenas token_secret_id + token_last4. Token em branco em save que nao e remocao preserva o segredo (Req 3.7). Versionamento otimista vs updated_at -> STALE_VERSION (relaxado quando linha fresh / expected NULL). Retorna apenas { token_is_set, token_last4 }, NUNCA o valor bruto (CP-7). Audit positivo (MARKETING_TOKEN_UPDATED) pelo wrapper TS; path negativo grava MARKETING_VIEW_DENIED. admin-marketing 048.';

-- 7.2 - marketing_token_clear(): apaga o token do Vault (is_set=false).
--   Gated por MARKETING_EDIT (deny => MARKETING_VIEW_DENIED + permission_denied).
--   Versionamento otimista vs updated_at (mismatch => STALE_VERSION P0001),
--   relaxado quando a linha ainda nao existe ou p_expected_updated_at e NULL.
--   Apaga o segredo no Vault (se presente, via token_secret_id) e zera
--   token_secret_id + token_last4, tocando updated_by/updated_at. Idempotente:
--   limpar quando ja vazio nao falha. Retorna { token_is_set: false,
--   token_last4: null } -- NUNCA o valor bruto (CP-7).
--   Requirements: 3.6, 12.1, 12.2
CREATE OR REPLACE FUNCTION marketing_token_clear(
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_cfg    record;
  v_found  boolean;
BEGIN
  -- ---------- Gating: auth.uid() obrigatorio (caller anonimo => deny) ----------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  -- ---------- Gating: MARKETING_EDIT (deny sem mutar; log negativo) ----------
  IF NOT is_admin_with_permission('MARKETING_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'MARKETING_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'token_clear'));
    RAISE EXCEPTION 'permission_denied: MARKETING_EDIT required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM marketing_config WHERE singleton = true LIMIT 1;
  v_found := FOUND;

  -- ---------- Versionamento otimista (relaxado: linha fresh / expected NULL) ----------
  IF v_found
     AND p_expected_updated_at IS NOT NULL
     AND v_cfg.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  -- ---------- Apaga o segredo no Vault (se presente) e zera a referencia ----------
  -- Idempotente: apagar segredo inexistente nao e erro (is_set ja era false).
  -- vault.secrets e a tabela base (decrypted_secrets e a view).
  IF v_found THEN
    IF v_cfg.token_secret_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_cfg.token_secret_id;
    END IF;

    UPDATE marketing_config SET
      token_secret_id = NULL,
      token_last4     = NULL,
      updated_by      = v_caller,
      updated_at      = now()
    WHERE singleton = true;
  END IF;

  -- CP-7: estado limpo -- is_set=false, sem last4. NUNCA o valor bruto.
  RETURN jsonb_build_object('token_is_set', false, 'token_last4', NULL);
END;
$func$;

REVOKE ALL ON FUNCTION marketing_token_clear(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_token_clear(timestamptz) TO authenticated;

COMMENT ON FUNCTION marketing_token_clear(timestamptz)
  IS 'RPC VOLATILE SECURITY DEFINER (MARKETING_EDIT) que apaga o Meta_Access_Token do Vault (via token_secret_id) e zera token_secret_id + token_last4 em marketing_config. Idempotente (limpar quando ja vazio nao falha). Versionamento otimista vs updated_at -> STALE_VERSION (relaxado quando linha fresh / expected NULL). Retorna { token_is_set: false, token_last4: null }, NUNCA o valor bruto (CP-7). Audit positivo (MARKETING_TOKEN_CLEARED) pelo wrapper TS; path negativo grava MARKETING_VIEW_DENIED. admin-marketing 048.';


-- ============================================================================
-- 8. RPCs helper de cache: marketing_cache_read / marketing_cache_write
-- ============================================================================
-- Helpers de cache de snapshots de metricas (marketing_metrics_cache). DIFEREM
-- das demais RPCs deste modulo: NAO sao chamadas pelo frontend e por isso NAO
-- aplicam gating is_admin_with_permission -- o caller (Edge meta-marketing-read)
-- ja foi gated por MARKETING_VIEW antes de chegar aqui. Sao server-only: o
-- consumo real e feito server-side pela Edge usando a service-role key, e por
-- isso o GRANT EXECUTE vai SOMENTE para service_role (NUNCA authenticated/anon).
-- Mesmo padrao server-only herdado de rpc_assistant_persist_critical_event (047:
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO service_role).
--
-- Mantem o restante da posture de SECURITY DEFINER: SET search_path = public
-- (evita search-path attacks) e REVOKE ALL FROM PUBLIC. SECURITY DEFINER bypassa
-- a policy *_no_dml de marketing_metrics_cache (FOR ALL USING(false)), que e o
-- mecanismo intencional para que TODO acesso a tabela passe por estas RPCs.
--
-- CONTRATO de marketing_cache_read (fresh / stale / none) -- desenhado para que
-- a Edge distinga os tres casos sem ambiguidade (Req 7.3, 7.4, 7.5):
--   - FRESCO : existe snapshot e idade (now() - fetched_at) <= janela de
--              frescor (p_max_age_seconds) => retorna
--              jsonb { snapshot, fetched_at, stale: false }. A Edge usa direto
--              sem chamar a Meta (Req 7.3).
--   - STALE  : existe snapshot porem mais antigo que a janela => retorna
--              jsonb { snapshot, fetched_at, stale: true }. Serve de fallback
--              quando a Meta esta indisponivel (Req 7.4); a resposta sempre
--              carrega o indicador stale + o fetched_at para a UI comunicar a
--              idade dos dados (Req 7.5).
--   - NONE   : nao existe nenhum snapshot para (ad_account_id, period_key) =>
--              retorna SQL NULL. A Edge interpreta NULL como "sem cache" e
--              decide entre chamar a Meta ou devolver META_API_UNAVAILABLE.
-- Escolha de NULL (em vez de um objeto com flag) para o caso NONE: e o sentinel
-- mais simples e inequivoco -- IS NULL na Edge separa NONE de
-- fresh/stale (ambos objetos jsonb com a chave snapshot sempre presente).

-- 8.1 - marketing_cache_read(): snapshot mais recente + classificacao fresh/stale.
--   STABLE (somente SELECT). Server-only (service_role). Le o snapshot mais
--   recente de (ad_account_id, period_key) ordenando por fetched_at DESC (o
--   indice idx_marketing_metrics_cache_lookup suporta a busca). Classifica como
--   fresco quando a idade <= make_interval(secs => p_max_age_seconds); senao
--   stale. Sem nenhum snapshot => NULL. p_max_age_seconds nulo/negativo e
--   tratado defensivamente como "nunca fresco" (=> stale fallback), evitando
--   servir cache fresco por engano.
--   Requirements: 7.3, 7.4, 7.5
CREATE OR REPLACE FUNCTION marketing_cache_read(
  p_ad_account_id   text,
  p_period_key      text,
  p_max_age_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_snapshot   jsonb;
  v_fetched_at timestamptz;
  v_stale      boolean;
BEGIN
  -- Snapshot mais recente para o par (ad_account_id, period_key).
  SELECT snapshot, fetched_at
    INTO v_snapshot, v_fetched_at
    FROM marketing_metrics_cache
   WHERE ad_account_id = p_ad_account_id
     AND period_key    = p_period_key
   ORDER BY fetched_at DESC
   LIMIT 1;

  -- NONE: nenhum snapshot disponivel => NULL (a Edge trata como "sem cache").
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Frescor: fresco apenas quando a janela e valida (>= 0) e a idade cabe nela.
  -- Caso contrario (janela NULL/negativa ou snapshot mais velho) => stale.
  v_stale := NOT (
    p_max_age_seconds IS NOT NULL
    AND p_max_age_seconds >= 0
    AND now() - v_fetched_at <= make_interval(secs => p_max_age_seconds)
  );

  RETURN jsonb_build_object(
    'snapshot',   v_snapshot,
    'fetched_at', v_fetched_at,
    'stale',      v_stale
  );
END;
$func$;

REVOKE ALL ON FUNCTION marketing_cache_read(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_cache_read(text, text, integer) TO service_role;

COMMENT ON FUNCTION marketing_cache_read(text, text, integer)
  IS 'RPC STABLE SECURITY DEFINER server-only (GRANT a service_role) chamada pela Edge meta-marketing-read. Retorna o snapshot mais recente de (ad_account_id, period_key): { snapshot, fetched_at, stale:false } se a idade <= p_max_age_seconds (fresco, Req 7.3); { snapshot, fetched_at, stale:true } se houver snapshot mais antigo (fallback, Req 7.4/7.5); NULL se nao houver snapshot. Sem gating is_admin (caller ja gated). admin-marketing 048.';

-- 8.2 - marketing_cache_write(): grava um novo snapshot com fetched_at = NOW().
--   VOLATILE. Server-only (service_role). Cache append-style: cada chamada faz
--   um INSERT novo (o read sempre pega o mais recente por fetched_at DESC),
--   evitando contencao de UPDATE e preservando o historico de snapshots.
--   Validacao minima de dominio antes do INSERT (a CHECK da tabela tambem
--   reforca, defesa em profundidade). Retorna { id, fetched_at } do snapshot
--   recem-gravado.
--   Requirements: 7.2
CREATE OR REPLACE FUNCTION marketing_cache_write(
  p_ad_account_id text,
  p_period_key    text,
  p_snapshot      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_id         uuid;
  v_fetched_at timestamptz;
BEGIN
  -- Guardas minimas (a CHECK da tabela reforca no INSERT; falha cedo e clara).
  IF p_ad_account_id IS NULL OR p_ad_account_id !~ '^act_[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_AD_ACCOUNT_ID: %', p_ad_account_id USING ERRCODE = 'P0001';
  END IF;

  IF p_period_key IS NULL OR p_period_key NOT IN ('today','7d','30d') THEN
    RAISE EXCEPTION 'INVALID_PERIOD: %', p_period_key USING ERRCODE = 'P0001';
  END IF;

  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'INVALID_SNAPSHOT: snapshot nulo' USING ERRCODE = 'P0001';
  END IF;

  -- Append: novo snapshot com fetched_at corrente (Req 7.2).
  INSERT INTO marketing_metrics_cache (ad_account_id, period_key, snapshot, fetched_at)
  VALUES (p_ad_account_id, p_period_key, p_snapshot, now())
  RETURNING id, fetched_at INTO v_id, v_fetched_at;

  RETURN jsonb_build_object('id', v_id, 'fetched_at', v_fetched_at);
END;
$func$;

REVOKE ALL ON FUNCTION marketing_cache_write(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_cache_write(text, text, jsonb) TO service_role;

COMMENT ON FUNCTION marketing_cache_write(text, text, jsonb)
  IS 'RPC VOLATILE SECURITY DEFINER server-only (GRANT a service_role) chamada pela Edge meta-marketing-read. Faz INSERT append-style de um snapshot em marketing_metrics_cache com fetched_at = NOW() (Req 7.2); o read sempre pega o mais recente. Valida ad_account_id/period_key/snapshot antes do INSERT. Retorna { id, fetched_at }. Sem gating is_admin (caller ja gated). admin-marketing 048.';


-- ============================================================================
-- 9. Seed da linha singleton de marketing_config
-- ============================================================================
-- Garante que a unica linha vigente (singleton) exista apos a migration, com os
-- defaults de negocio (default_period = '7d', consent_required = true). As RPCs
-- marketing_config_get / _update / token_set / token_clear operam sobre esta
-- linha (WHERE singleton = true) e possuem fallback defensivo de INSERT, mas a
-- seed deixa o estado pronto desde o primeiro deploy.
--
-- IDEMPOTENTE (Req 13.3): a coluna singleton e UNIQUE (CHECK singleton = true),
-- logo so existe UMA linha possivel. Em reexecucao a tentativa de inserir uma
-- segunda linha colide com a unique constraint do singleton; ON CONFLICT
-- (singleton) DO NOTHING transforma a colisao em no-op (nao falha, nao duplica).
-- Usamos a forma com alvo explicito (singleton) por ser auto-documentada quanto
-- a constraint da qual dependemos; a forma simples ON CONFLICT DO NOTHING tambem
-- seria valida aqui.
INSERT INTO marketing_config (default_period, consent_required)
VALUES ('7d', true)
ON CONFLICT (singleton) DO NOTHING;


-- ============================================================================
-- 10. -- VERIFY -- Smoke test manual (comentado, NAO executado)
-- ============================================================================
-- Bloco de verificacao manual (Req 13.8). Esta INTEIRAMENTE dentro de um
-- comentario de bloco /* ... */ e portanto NAO e executado pela migration --
-- serve apenas como roteiro de smoke test apos o deploy. Para usar: copie os
-- SELECTs de dentro do comentario e rode-os no SQL editor com um JWT de admin
-- (para o teste de is_admin_with_permission). Resultados esperados anotados em
-- cada consulta.
/*
-- (a) As 3 tabelas do modulo existem no schema public (esperado: 3 linhas).
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('marketing_config','marketing_events','marketing_metrics_cache')
 ORDER BY table_name;

-- (b) Os 2 indices declarados existem (esperado: 2 linhas).
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('idx_marketing_events_event_time','idx_marketing_metrics_cache_lookup')
 ORDER BY indexname;

-- (c) RLS habilitada + policy *_no_dml em cada tabela (esperado: 3 linhas,
--     todas com rowsecurity = true).
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, p.polname AS policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE n.nspname = 'public'
   AND c.relname IN ('marketing_config','marketing_events','marketing_metrics_cache')
 ORDER BY c.relname;

-- (d) is_admin_with_permission('MARKETING_VIEW') e reconhecida/chamavel
--     (esperado: retorna boolean -- true para um JWT de admin com a permissao,
--     false caso contrario; o ponto e que a funcao existe e e invocavel).
SELECT is_admin_with_permission('MARKETING_VIEW') AS marketing_view_callable;

-- (e) A linha singleton existe (esperado: exatamente 1 linha, default_period
--     = '7d', consent_required = true).
SELECT count(*) AS singleton_rows, bool_and(singleton) AS all_singleton,
       min(default_period) AS default_period, bool_and(consent_required) AS consent_required
  FROM marketing_config;

-- (f) As 7 RPCs do modulo existem (esperado: 7 linhas).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_admin_with_permission','marketing_config_get','marketing_config_update',
                     'marketing_token_set','marketing_token_clear',
                     'marketing_cache_read','marketing_cache_write')
 ORDER BY p.proname;

-- (g) Grants corretos das RPCs (esperado: as RPCs de frontend com EXECUTE para
--     authenticated; as RPCs server-only de cache com EXECUTE para service_role;
--     nenhuma com grant para PUBLIC/anon).
SELECT routine_name, grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE specific_schema = 'public'
   AND routine_name IN ('is_admin_with_permission','marketing_config_get','marketing_config_update',
                        'marketing_token_set','marketing_token_clear',
                        'marketing_cache_read','marketing_cache_write')
   AND privilege_type = 'EXECUTE'
 ORDER BY routine_name, grantee;
*/


COMMIT;
