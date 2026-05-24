-- =====================================================
-- Migration 030: admin-foundation
--
-- Cria a infraestrutura de banco do painel administrativo:
--   - users.is_superuser
--   - users.admin_username (login admin por username, não telefone)
--   - admin_roles
--   - admin_mfa_secrets
--   - admin_audit_logs
--   - funcoes SECURITY DEFINER:
--       log_admin_action, set_mfa_secret, regenerate_backup_codes,
--       consume_backup_code, validate_admin_session,
--       is_admin_with_permission
--
-- Dependencias: migrations 001..029 aplicadas, em particular:
--   - users (001)
--   - extensao pgcrypto (ja habilitada em 001)
--
-- IMPORTANTE: a promocao inicial do Super_Admin master e feita
-- via supabase/scripts/bootstrap_admin_master.sql.
-- =====================================================

BEGIN;

-- ========== 1. Coluna is_superuser e admin_username em users ==========

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_username TEXT NULL;

-- Username unico (apenas quando preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_admin_username
  ON users(admin_username) WHERE admin_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_superuser
  ON users(id) WHERE is_superuser = true;

-- Trigger: bloqueia mutacao direta de is_superuser por nao-SUPER_ADMIN
CREATE OR REPLACE FUNCTION protect_is_superuser()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF (OLD.is_superuser IS DISTINCT FROM NEW.is_superuser) THEN
    IF NOT EXISTS (
      SELECT 1 FROM admin_roles ar
      WHERE ar.user_id = auth.uid()
        AND ar.role = 'SUPER_ADMIN'
        AND ar.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'forbidden: only SUPER_ADMIN can change is_superuser';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_protect_is_superuser ON users;
CREATE TRIGGER users_protect_is_superuser
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_is_superuser();

-- ========== 2. Tabela admin_roles ==========

CREATE TABLE IF NOT EXISTS admin_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN (
                  'SUPER_ADMIN','ADMIN','SUPORTE','FINANCEIRO','MODERADOR'
                )),
  granted_by   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL,
  revoked_by   uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_roles_active
  ON admin_roles(user_id, role) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_roles_user_active
  ON admin_roles(user_id) WHERE revoked_at IS NULL;

ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

-- ========== 3. Tabela admin_mfa_secrets ==========

CREATE TABLE IF NOT EXISTS admin_mfa_secrets (
  user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret_encrypted   bytea NOT NULL,
  -- backup_codes: JSONB array com EXATAMENTE 10 elementos:
  --   [{ "hash": "$2a$10$...", "used_at": null | "ISO timestamp" }, ...]
  backup_codes            jsonb NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_backup_codes_count CHECK (jsonb_array_length(backup_codes) = 10)
);

CREATE OR REPLACE FUNCTION set_updated_at_admin_mfa()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN NEW.updated_at = now(); RETURN NEW; END $func$;

DROP TRIGGER IF EXISTS admin_mfa_secrets_set_updated_at ON admin_mfa_secrets;
CREATE TRIGGER admin_mfa_secrets_set_updated_at
  BEFORE UPDATE ON admin_mfa_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_admin_mfa();

ALTER TABLE admin_mfa_secrets ENABLE ROW LEVEL SECURITY;

-- ========== 4. Tabela admin_audit_logs ==========

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action       text NOT NULL,
  target_type  text NULL,
  target_id    text NULL,
  before_data  jsonb NULL,
  after_data   jsonb NULL,
  ip           text NULL,
  user_agent   text NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
  ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id
  ON admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action
  ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target
  ON admin_audit_logs(target_type, target_id);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;


-- ========== 5. Helper RBAC: is_admin_with_permission ==========

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

-- ========== 6. RLS - admin_roles ==========

DROP POLICY IF EXISTS admin_roles_select ON admin_roles;
CREATE POLICY admin_roles_select ON admin_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR is_admin_with_permission('ADMIN_ROLE_GRANT')
  );

DROP POLICY IF EXISTS admin_roles_insert ON admin_roles;
CREATE POLICY admin_roles_insert ON admin_roles
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_with_permission('ADMIN_ROLE_GRANT'));

DROP POLICY IF EXISTS admin_roles_update ON admin_roles;
CREATE POLICY admin_roles_update ON admin_roles
  FOR UPDATE TO authenticated
  USING (is_admin_with_permission('ADMIN_ROLE_REVOKE'))
  WITH CHECK (is_admin_with_permission('ADMIN_ROLE_REVOKE'));

DROP POLICY IF EXISTS admin_roles_delete ON admin_roles;
CREATE POLICY admin_roles_delete ON admin_roles
  FOR DELETE TO authenticated USING (false);

-- ========== 7. RLS - admin_mfa_secrets ==========

DROP POLICY IF EXISTS admin_mfa_select ON admin_mfa_secrets;
CREATE POLICY admin_mfa_select ON admin_mfa_secrets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS admin_mfa_insert ON admin_mfa_secrets;
CREATE POLICY admin_mfa_insert ON admin_mfa_secrets
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS admin_mfa_update ON admin_mfa_secrets;
CREATE POLICY admin_mfa_update ON admin_mfa_secrets
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_mfa_delete ON admin_mfa_secrets;
CREATE POLICY admin_mfa_delete ON admin_mfa_secrets
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('ADMIN_ROLE_GRANT'));

-- ========== 8. RLS - admin_audit_logs (imutavel) ==========

DROP POLICY IF EXISTS admin_audit_select ON admin_audit_logs;
CREATE POLICY admin_audit_select ON admin_audit_logs
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('AUDIT_VIEW'));

DROP POLICY IF EXISTS admin_audit_insert ON admin_audit_logs;
CREATE POLICY admin_audit_insert ON admin_audit_logs
  FOR INSERT TO authenticated WITH CHECK (false);

-- UPDATE/DELETE: NEGADO para TODOS (incluindo SUPER_ADMIN)
DROP POLICY IF EXISTS admin_audit_update ON admin_audit_logs;
CREATE POLICY admin_audit_update ON admin_audit_logs
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_audit_delete ON admin_audit_logs;
CREATE POLICY admin_audit_delete ON admin_audit_logs
  FOR DELETE TO authenticated USING (false);


-- ========== 9. SECURITY DEFINER: log_admin_action ==========

CREATE OR REPLACE FUNCTION log_admin_action(
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   text DEFAULT NULL,
  p_before      jsonb DEFAULT NULL,
  p_after       jsonb DEFAULT NULL,
  p_ip          text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_id uuid;
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'log_admin_action requires authenticated session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_admin AND u.is_superuser = true) THEN
    RAISE EXCEPTION 'log_admin_action requires is_superuser';
  END IF;

  INSERT INTO admin_audit_logs(
    admin_id, action, target_type, target_id,
    before_data, after_data, ip, user_agent
  ) VALUES (
    v_admin, p_action, p_target_type, p_target_id,
    p_before, p_after, p_ip, LEFT(coalesce(p_user_agent,''), 512)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$func$;

REVOKE ALL ON FUNCTION log_admin_action(text,text,text,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_admin_action(text,text,text,jsonb,jsonb,text,text) TO authenticated;

-- ========== 10. SECURITY DEFINER: set_mfa_secret ==========

CREATE OR REPLACE FUNCTION set_mfa_secret(
  p_totp_encrypted bytea,
  p_backup_codes   jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_mfa_secret requires authenticated session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_uid AND u.is_superuser = true) THEN
    RAISE EXCEPTION 'set_mfa_secret requires is_superuser';
  END IF;
  IF jsonb_array_length(p_backup_codes) <> 10 THEN
    RAISE EXCEPTION 'backup_codes must have exactly 10 entries';
  END IF;

  INSERT INTO admin_mfa_secrets(user_id, totp_secret_encrypted, backup_codes)
  VALUES (v_uid, p_totp_encrypted, p_backup_codes);

  PERFORM log_admin_action('ADMIN_MFA_SETUP', 'admin_mfa_secrets', v_uid::text, NULL, NULL, NULL, NULL);
END;
$func$;

REVOKE ALL ON FUNCTION set_mfa_secret(bytea, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_mfa_secret(bytea, jsonb) TO authenticated;

-- ========== 11. SECURITY DEFINER: regenerate_backup_codes ==========

CREATE OR REPLACE FUNCTION regenerate_backup_codes(
  p_backup_codes jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'regenerate_backup_codes requires authenticated session';
  END IF;
  IF jsonb_array_length(p_backup_codes) <> 10 THEN
    RAISE EXCEPTION 'backup_codes must have exactly 10 entries';
  END IF;

  UPDATE admin_mfa_secrets
     SET backup_codes = p_backup_codes
   WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no MFA secret to regenerate';
  END IF;

  PERFORM log_admin_action('ADMIN_MFA_BACKUP_CODES_REGENERATED',
                           'admin_mfa_secrets', v_uid::text, NULL, NULL, NULL, NULL);
END;
$func$;

REVOKE ALL ON FUNCTION regenerate_backup_codes(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION regenerate_backup_codes(jsonb) TO authenticated;

-- ========== 12. SECURITY DEFINER: consume_backup_code ==========

CREATE OR REPLACE FUNCTION consume_backup_code(
  p_hash text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_codes jsonb;
  v_new_codes jsonb := '[]'::jsonb;
  v_consumed boolean := false;
  v_entry jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'consume_backup_code requires authenticated session';
  END IF;

  SELECT backup_codes INTO v_codes FROM admin_mfa_secrets WHERE user_id = v_uid;
  IF v_codes IS NULL THEN
    RETURN false;
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_codes) LOOP
    IF NOT v_consumed
       AND (v_entry->>'hash') = p_hash
       AND (v_entry->>'used_at') IS NULL THEN
      v_new_codes := v_new_codes ||
        jsonb_build_object('hash', v_entry->>'hash',
                           'used_at', to_jsonb(now()::text));
      v_consumed := true;
    ELSE
      v_new_codes := v_new_codes || v_entry;
    END IF;
  END LOOP;

  IF v_consumed THEN
    UPDATE admin_mfa_secrets SET backup_codes = v_new_codes WHERE user_id = v_uid;
    PERFORM log_admin_action('ADMIN_MFA_BACKUP_CODE_USED',
                             'admin_mfa_secrets', v_uid::text, NULL, NULL, NULL, NULL);
  END IF;

  RETURN v_consumed;
END;
$func$;

REVOKE ALL ON FUNCTION consume_backup_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_backup_code(text) TO authenticated;

-- ========== 13. SECURITY DEFINER: validate_admin_session ==========

CREATE OR REPLACE FUNCTION validate_admin_session()
RETURNS TABLE(
  is_active     boolean,
  is_superuser  boolean,
  active_roles  text[],
  has_mfa       boolean
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    u.is_active,
    u.is_superuser,
    coalesce(array_agg(ar.role) FILTER (WHERE ar.revoked_at IS NULL), ARRAY[]::text[]),
    EXISTS (SELECT 1 FROM admin_mfa_secrets m WHERE m.user_id = u.id)
  FROM users u
  LEFT JOIN admin_roles ar ON ar.user_id = u.id
  WHERE u.id = auth.uid()
  GROUP BY u.is_active, u.is_superuser, u.id;
$func$;

REVOKE ALL ON FUNCTION validate_admin_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_admin_session() TO authenticated;

COMMIT;
