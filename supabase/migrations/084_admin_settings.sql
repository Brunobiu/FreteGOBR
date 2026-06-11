-- ============================================================================
-- Migration 084: Admin Settings (modulo Configuracoes do painel admin)
-- ============================================================================
-- Spec: finalizacao-lancamento (Area 1).
--
-- Cria a tabela generica chave-valor tipada `platform_settings` e as RPCs
-- de leitura/mutacao do modulo Configuracoes (/admin/settings). Segredos
-- ficam no Supabase Vault; a coluna `value` permanece NULL para secrets.
--
-- Dependencias:
--   - 030 admin-foundation (is_admin_with_permission, admin_audit_logs)
--   - extensao supabase_vault (042b)
--
-- Permission_Matrix NAO muda: SETTINGS_VIEW / SETTINGS_EDIT ja existem (030).
--
-- Numeracao: 084 e a proxima livre real (045/046 foram puladas; ultima
-- aplicada 083).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS antes de CREATE POLICY,
-- INSERT ... ON CONFLICT DO NOTHING.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Validacoes defensivas
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
     WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'admin_audit_logs'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault'
  ) THEN
    RAISE EXCEPTION 'Extensao supabase_vault ausente (ver migration 042b)';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- 2. Tabela platform_settings (chave-valor tipado por categoria)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category          text NOT NULL CHECK (category IN ('integrations','trial','plans','ai','general')),
  key               text NOT NULL,
  value_type        text NOT NULL CHECK (value_type IN ('string','integer','money','boolean','secret','enum')),
  value             jsonb NULL,
  enum_options      jsonb NULL,
  is_readonly       boolean NOT NULL DEFAULT false,
  is_secret         boolean NOT NULL DEFAULT false,
  secret_is_set     boolean NOT NULL DEFAULT false,
  secret_last4      text NULL CHECK (secret_last4 IS NULL OR char_length(secret_last4) <= 4),
  vault_secret_name text NULL,
  label             text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Coerencia: segredo nunca guarda valor bruto em coluna legivel.
  CONSTRAINT chk_platform_settings_value_type
    CHECK (value_type <> 'secret' OR value IS NULL),
  -- Coerencia: enum exige array de opcoes; nao-enum nao tem opcoes.
  CONSTRAINT chk_platform_settings_enum_options
    CHECK (
      (value_type = 'enum' AND enum_options IS NOT NULL AND jsonb_typeof(enum_options) = 'array')
      OR (value_type <> 'enum' AND enum_options IS NULL)
    ),
  -- Coerencia: flag is_secret <=> value_type secret.
  CONSTRAINT chk_platform_settings_secret_flag
    CHECK (is_secret = (value_type = 'secret')),

  CONSTRAINT uq_platform_settings_cat_key UNIQUE (category, key)
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_category
  ON platform_settings (category);

COMMENT ON TABLE platform_settings
  IS 'Configuracoes da plataforma (modulo /admin/settings). Chave-valor tipado por categoria. Segredos vivem no Vault; value permanece NULL para value_type=secret. Toda interacao via RPC SECURITY DEFINER (RLS no-DML). finalizacao-lancamento 084.';
COMMENT ON COLUMN platform_settings.value
  IS 'Valor atual (jsonb). SEMPRE NULL quando value_type=secret (o bruto vive no Vault).';
COMMENT ON COLUMN platform_settings.secret_last4
  IS 'Ultimos 4 caracteres do segredo, para masking na UI. Nunca o bruto.';
COMMENT ON COLUMN platform_settings.vault_secret_name
  IS 'Nome estavel do segredo no Vault (ex: platform_setting:integrations:evolution_api_key).';

-- RLS: nenhuma DML direta. Tudo via RPC SECURITY DEFINER.
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_no_dml ON platform_settings;
CREATE POLICY platform_settings_no_dml
  ON platform_settings FOR ALL
  USING (false) WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 3. RPC admin_settings_get() — leitura agregada por categoria (SETTINGS_VIEW)
-- ----------------------------------------------------------------------------
-- STABLE: nao muta dados; o INSERT em admin_audit_logs no path negativo e
-- admissivel porque e o unico ramo que escreve e encerra com RAISE.
CREATE OR REPLACE FUNCTION admin_settings_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

  IF NOT is_admin_with_permission('SETTINGS_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SETTINGS_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SETTINGS_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'key', s.key,
             'category', s.category,
             'value_type', s.value_type,
             -- Segredo nunca retorna valor bruto (ja e NULL por construcao).
             'value', CASE WHEN s.value_type = 'secret' THEN NULL ELSE s.value END,
             'enum_options', s.enum_options,
             'is_readonly', s.is_readonly,
             'is_secret', s.is_secret,
             'secret_is_set', s.secret_is_set,
             'masked_value', CASE
                               WHEN s.secret_is_set AND s.secret_last4 IS NOT NULL
                                 THEN '••••••••' || s.secret_last4
                               ELSE NULL
                             END,
             'label', s.label,
             'updated_at', s.updated_at
           ) ORDER BY s.category, s.key
         )
    INTO v_result
    FROM platform_settings s;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$func$;

REVOKE ALL ON FUNCTION admin_settings_get() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_settings_get() TO authenticated;

COMMENT ON FUNCTION admin_settings_get()
  IS 'RPC STABLE SECURITY DEFINER que retorna todas as configuracoes agregadas (jsonb array). Secret retorna masked_value (••••••••+last4) e value NULL. Gated por SETTINGS_VIEW; falha grava SETTINGS_VIEW_DENIED. finalizacao-lancamento 084.';

-- ----------------------------------------------------------------------------
-- 4. RPC admin_settings_update(p_key, p_value, p_expected_updated_at)
--    Atualiza valor nao-secreto (SETTINGS_EDIT). Versionamento otimista.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_settings_update(
  p_key text,
  p_value jsonb,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller       uuid := auth.uid();
  v_value_type   text;
  v_is_readonly  boolean;
  v_enum_options jsonb;
  v_existing_uat timestamptz;
  v_num          numeric;
  v_new_uat      timestamptz;
  v_rows         integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SETTINGS_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SETTINGS_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SETTINGS_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- Pre-fetch do registro alvo.
  SELECT value_type, is_readonly, enum_options, updated_at
    INTO v_value_type, v_is_readonly, v_enum_options, v_existing_uat
    FROM platform_settings
   WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTING_NOT_FOUND: %', p_key USING ERRCODE = 'P0001';
  END IF;

  IF v_value_type = 'secret' THEN
    RAISE EXCEPTION 'INVALID_VALUE: secret deve usar admin_settings_secret_set' USING ERRCODE = 'P0001';
  END IF;

  IF v_is_readonly THEN
    RAISE EXCEPTION 'READONLY_SETTING: %', p_key USING ERRCODE = 'P0001';
  END IF;

  -- Validacao por tipo (espelho do helper TS validateSettingValue).
  CASE v_value_type
    WHEN 'string' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'INVALID_VALUE: esperado string' USING ERRCODE = 'P0001';
      END IF;
    WHEN 'boolean' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'INVALID_VALUE: esperado boolean' USING ERRCODE = 'P0001';
      END IF;
    WHEN 'integer' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'INVALID_VALUE: esperado integer' USING ERRCODE = 'P0001';
      END IF;
      v_num := (p_value)::text::numeric;
      IF v_num <> trunc(v_num) THEN
        RAISE EXCEPTION 'INVALID_VALUE: integer nao-inteiro' USING ERRCODE = 'P0001';
      END IF;
      IF p_key = 'trial_duration_days' AND (v_num < 1 OR v_num > 365) THEN
        RAISE EXCEPTION 'INVALID_VALUE: trial_duration_days fora de 1..365' USING ERRCODE = 'P0001';
      END IF;
    WHEN 'money' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'INVALID_VALUE: esperado money (centavos)' USING ERRCODE = 'P0001';
      END IF;
      v_num := (p_value)::text::numeric;
      IF v_num <> trunc(v_num) OR v_num < 0 OR v_num > 1000000 THEN
        RAISE EXCEPTION 'INVALID_VALUE: money fora de 0..1000000 centavos' USING ERRCODE = 'P0001';
      END IF;
    WHEN 'enum' THEN
      IF jsonb_typeof(p_value) <> 'string'
         OR NOT (v_enum_options @> jsonb_build_array(p_value #>> '{}')) THEN
        RAISE EXCEPTION 'INVALID_VALUE: enum fora do dominio' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'INVALID_VALUE: tipo nao suportado' USING ERRCODE = 'P0001';
  END CASE;

  -- Versionamento otimista.
  UPDATE platform_settings
     SET value = p_value, updated_at = now(), updated_by = v_caller
   WHERE key = p_key AND updated_at = p_expected_updated_at
   RETURNING updated_at INTO v_new_uat;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing_uat
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new_uat);
END;
$func$;

REVOKE ALL ON FUNCTION admin_settings_update(text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_settings_update(text, jsonb, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_settings_update(text, jsonb, timestamptz)
  IS 'RPC SECURITY DEFINER que atualiza valor nao-secreto. Valida tipo/enum/range (espelho do TS). Versionamento otimista via expected_updated_at -> STALE_VERSION. Gated por SETTINGS_EDIT; falha grava SETTINGS_VIEW_DENIED. Audit da mutacao real e gravado pelo wrapper TS executeAdminMutation. finalizacao-lancamento 084.';

-- ----------------------------------------------------------------------------
-- 5. RPC admin_settings_secret_set(p_key, p_secret, p_expected_updated_at)
--    Grava segredo no Vault (SETTINGS_EDIT). value permanece NULL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_settings_secret_set(
  p_key text,
  p_secret text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, vault
AS $func$
DECLARE
  v_caller       uuid := auth.uid();
  v_value_type   text;
  v_existing_uat timestamptz;
  v_vault_name   text;
  v_last4        text;
  v_new_uat      timestamptz;
  v_rows         integer;
  v_secret_id    uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SETTINGS_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SETTINGS_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SETTINGS_EDIT required' USING ERRCODE = '42501';
  END IF;

  IF p_secret IS NULL OR char_length(p_secret) = 0 THEN
    RAISE EXCEPTION 'INVALID_VALUE: segredo vazio' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(p_secret) > 4096 THEN
    RAISE EXCEPTION 'INVALID_VALUE: segredo excede 4096 chars' USING ERRCODE = 'P0001';
  END IF;

  SELECT value_type, updated_at, vault_secret_name
    INTO v_value_type, v_existing_uat, v_vault_name
    FROM platform_settings
   WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTING_NOT_FOUND: %', p_key USING ERRCODE = 'P0001';
  END IF;
  IF v_value_type <> 'secret' THEN
    RAISE EXCEPTION 'INVALID_VALUE: % nao e secret', p_key USING ERRCODE = 'P0001';
  END IF;

  -- Versionamento otimista (checa antes de tocar o Vault).
  IF v_existing_uat <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing_uat
      USING ERRCODE = 'P0001';
  END IF;

  v_last4 := right(p_secret, 4);

  -- Grava/atualiza no Vault. Cria pelo nome se ainda nao existe.
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_vault_name LIMIT 1;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_secret, v_vault_name, 'platform_setting ' || p_key);
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secret);
  END IF;

  UPDATE platform_settings
     SET secret_is_set = true, secret_last4 = v_last4, value = NULL,
         updated_at = now(), updated_by = v_caller
   WHERE key = p_key AND updated_at = p_expected_updated_at
   RETURNING updated_at INTO v_new_uat;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION: corrida em %', p_key USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'is_set', true,
    'masked_value', '••••••••' || v_last4,
    'updated_at', v_new_uat
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_settings_secret_set(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_settings_secret_set(text, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_settings_secret_set(text, text, timestamptz)
  IS 'RPC SECURITY DEFINER que grava segredo no Vault. value permanece NULL; persiste secret_is_set/secret_last4 para masking. Versionamento otimista. Gated por SETTINGS_EDIT. finalizacao-lancamento 084.';

-- ----------------------------------------------------------------------------
-- 6. RPC admin_settings_secret_clear(p_key, p_expected_updated_at)
--    Idempotente. Remove segredo (SETTINGS_EDIT).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_settings_secret_clear(
  p_key text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, vault
AS $func$
DECLARE
  v_caller       uuid := auth.uid();
  v_value_type   text;
  v_secret_is_set boolean;
  v_existing_uat timestamptz;
  v_vault_name   text;
  v_new_uat      timestamptz;
  v_rows         integer;
  v_secret_id    uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('SETTINGS_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SETTINGS_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SETTINGS_EDIT required' USING ERRCODE = '42501';
  END IF;

  SELECT value_type, secret_is_set, updated_at, vault_secret_name
    INTO v_value_type, v_secret_is_set, v_existing_uat, v_vault_name
    FROM platform_settings
   WHERE key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTING_NOT_FOUND: %', p_key USING ERRCODE = 'P0001';
  END IF;
  IF v_value_type <> 'secret' THEN
    RAISE EXCEPTION 'INVALID_VALUE: % nao e secret', p_key USING ERRCODE = 'P0001';
  END IF;

  -- Idempotente: ja-limpo grava SKIPPED e retorna skip neutro (nao muta).
  IF NOT v_secret_is_set THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SETTINGS_SECRET_CLEARED_SKIPPED', 'platform_settings', NULL, NULL,
            jsonb_build_object('key', p_key, 'reason', 'ALREADY_CLEARED'));
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_CLEARED');
  END IF;

  IF v_existing_uat <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing_uat
      USING ERRCODE = 'P0001';
  END IF;

  -- Remove do Vault (se existir).
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_vault_name LIMIT 1;
  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  UPDATE platform_settings
     SET secret_is_set = false, secret_last4 = NULL,
         updated_at = now(), updated_by = v_caller
   WHERE key = p_key AND updated_at = p_expected_updated_at
   RETURNING updated_at INTO v_new_uat;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION: corrida em %', p_key USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
  VALUES (v_caller, 'SETTINGS_SECRET_CLEARED', 'platform_settings', NULL,
          jsonb_build_object('key', p_key, 'is_set', true),
          jsonb_build_object('key', p_key, 'is_set', false));

  RETURN jsonb_build_object('ok', true, 'is_set', false, 'updated_at', v_new_uat);
END;
$func$;

REVOKE ALL ON FUNCTION admin_settings_secret_clear(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_settings_secret_clear(text, timestamptz) TO authenticated;

COMMENT ON FUNCTION admin_settings_secret_clear(text, timestamptz)
  IS 'RPC SECURITY DEFINER idempotente que remove segredo do Vault. Ja-limpo grava SETTINGS_SECRET_CLEARED_SKIPPED e retorna {skipped,reason:ALREADY_CLEARED}. Gated por SETTINGS_EDIT. finalizacao-lancamento 084.';

-- ----------------------------------------------------------------------------
-- 7. RPC app_get_setting_secret(p_key) — SERVER-ONLY (sem grant a authenticated)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_get_setting_secret(p_key text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $func$
DECLARE
  v_vault_name text;
  v_secret     text;
BEGIN
  SELECT vault_secret_name INTO v_vault_name
    FROM platform_settings
   WHERE key = p_key AND value_type = 'secret';
  IF v_vault_name IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = v_vault_name
   LIMIT 1;

  RETURN v_secret;
END;
$func$;

-- Server-only: REVOKE de PUBLIC + authenticated + anon (Supabase concede
-- EXECUTE em massa a authenticated por default; o REVOKE explicito e
-- necessario para manter a funcao realmente server-only).
REVOKE ALL ON FUNCTION app_get_setting_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_get_setting_secret(text) FROM authenticated, anon;

COMMENT ON FUNCTION app_get_setting_secret(text)
  IS 'RPC SERVER-ONLY (sem GRANT a authenticated): le o valor bruto de um segredo do Vault para processos de integracao server-side. NUNCA consumida pelo cliente do painel. finalizacao-lancamento 084.';

-- ----------------------------------------------------------------------------
-- 8. Seeds idempotentes (ON CONFLICT DO NOTHING)
-- ----------------------------------------------------------------------------
INSERT INTO platform_settings (category, key, value_type, value, enum_options, is_readonly, is_secret, vault_secret_name, label)
VALUES
  ('trial', 'trial_duration_days', 'integer', '30'::jsonb, NULL, false, false, NULL, 'Duracao do trial (dias)'),
  ('plans', 'plan_price_mensal', 'money', '3900'::jsonb, NULL, false, false, NULL, 'Preco do plano mensal'),
  ('plans', 'plan_price_trimestral', 'money', '8700'::jsonb, NULL, false, false, NULL, 'Preco do plano trimestral'),
  ('plans', 'plan_price_semestral', 'money', '15000'::jsonb, NULL, false, false, NULL, 'Preco do plano semestral'),
  ('integrations', 'evolution_api_base_url', 'string', '""'::jsonb, NULL, false, false, NULL, 'Evolution API — URL base'),
  ('integrations', 'evolution_api_key', 'secret', NULL, NULL, false, true, 'platform_setting:integrations:evolution_api_key', 'Evolution API — chave'),
  ('integrations', 'evolution_instance_name', 'string', '""'::jsonb, NULL, false, false, NULL, 'Evolution API — instancia'),
  ('integrations', 'evolution_connection_status', 'enum', '"disconnected"'::jsonb,
     '["disconnected","connecting","connected","error"]'::jsonb, true, false, NULL, 'Evolution API — status'),
  ('general', 'support_contact_email', 'string', '""'::jsonb, NULL, false, false, NULL, 'E-mail de suporte'),
  ('general', 'support_contact_phone', 'string', '""'::jsonb, NULL, false, false, NULL, 'Telefone de suporte')
ON CONFLICT (category, key) DO NOTHING;

COMMIT;




/*
-- VERIFY (smoke test manual apos aplicar):

-- 1. Tabela e seeds (esperado: 10 linhas; ai sem seed).
SELECT category, count(*) FROM platform_settings GROUP BY category ORDER BY category;

-- 2. Coerencia de secret (value NULL; is_secret true).
SELECT key, value_type, value, is_secret, secret_is_set, vault_secret_name
  FROM platform_settings WHERE value_type = 'secret';

-- 3. Seeds-chave conferem.
SELECT key, value FROM platform_settings
 WHERE key IN ('trial_duration_days','plan_price_mensal','plan_price_trimestral','plan_price_semestral')
 ORDER BY key;
-- esperado: trial_duration_days=30, plan_price_mensal=3900, trimestral=8700, semestral=15000

-- 4. RPCs existem e tem a posture certa.
SELECT proname, prosecdef FROM pg_proc
 WHERE proname IN ('admin_settings_get','admin_settings_update','admin_settings_secret_set',
                   'admin_settings_secret_clear','app_get_setting_secret')
 ORDER BY proname;

-- 5. app_get_setting_secret NAO concedida a authenticated (server-only).
SELECT has_function_privilege('authenticated', 'app_get_setting_secret(text)', 'EXECUTE');
-- esperado: false
*/
