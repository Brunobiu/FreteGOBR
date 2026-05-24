-- =====================================================
-- Migration 031: admin-users
--
-- Adiciona o modulo de gestao de usuarios sobre a fundacao
-- entregue em 030_admin_foundation.sql.
--
-- Componentes:
--   - users.ban_reason / banned_at / banned_by
--   - Triggers Master_Admin imutavel (UPDATE / DELETE / admin_roles)
--   - Trigger Last_Super_Admin protegido (com pg_advisory_xact_lock)
--   - count_active_super_admins() STABLE
--   - admin_force_logout(uuid) SECURITY DEFINER
--   - admin_delete_user(uuid, boolean) SECURITY DEFINER
--   - Policies RLS adicionais em users, motoristas, embarcadores,
--     documents, notifications, chat_messages
--
-- Dependencias: migrations 001..030 aplicadas. Em particular:
--   - users.is_superuser, users.admin_username (030)
--   - admin_roles, admin_audit_logs (030)
--   - is_admin_with_permission(text) (030)
--   - log_admin_action(...) (030)
--
-- IMPORTANTE: Master_Admin e definido pelo username 'Nexus_Vortex99'.
-- Mudancas nesse username devem ser feitas via SQL direto desabilitando
-- temporariamente os triggers, e geram audit forense pos-evento.
--
-- Idempotente: pode ser reaplicada sem erros.
-- =====================================================

BEGIN;

-- Garante que a migration 030 esta aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao esta aplicada';
  END IF;
END
$check$;

-- ========== 1. Colunas ban_reason, banned_at, banned_by em users ==========

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ban_reason  TEXT NULL,
  ADD COLUMN IF NOT EXISTS banned_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS banned_by   UUID NULL REFERENCES users(id) ON DELETE SET NULL;

-- Constraint: ban_reason e banned_at andam juntos
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_ban_consistency;
ALTER TABLE users ADD  CONSTRAINT chk_users_ban_consistency
  CHECK (
    (ban_reason IS NULL AND banned_at IS NULL)
    OR
    (ban_reason IS NOT NULL AND banned_at IS NOT NULL)
  );

-- Tamanho maximo do motivo
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_ban_reason_length;
ALTER TABLE users ADD  CONSTRAINT chk_users_ban_reason_length
  CHECK (ban_reason IS NULL OR char_length(ban_reason) <= 1000);

-- Indice usado no filtro de status banido
CREATE INDEX IF NOT EXISTS idx_users_banned
  ON users(id) WHERE ban_reason IS NOT NULL;


-- ========== 2. Trigger users_master_admin_immutable_update ==========

CREATE OR REPLACE FUNCTION users_master_admin_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_master_username CONSTANT text := 'Nexus_Vortex99';
BEGIN
  IF OLD.admin_username IS NOT DISTINCT FROM v_master_username THEN
    IF (NEW.is_active        IS DISTINCT FROM OLD.is_active)
    OR (NEW.is_superuser     IS DISTINCT FROM OLD.is_superuser)
    OR (NEW.admin_username   IS DISTINCT FROM OLD.admin_username)
    OR (NEW.name             IS DISTINCT FROM OLD.name)
    OR (NEW.ban_reason       IS DISTINCT FROM OLD.ban_reason)
    OR (NEW.banned_at        IS DISTINCT FROM OLD.banned_at)
    THEN
      BEGIN
        PERFORM log_admin_action(
          'MASTER_ADMIN_IMMUTABLE_BLOCKED',
          'users',
          OLD.id::text,
          to_jsonb(OLD),
          to_jsonb(NEW),
          NULL, NULL
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      RAISE EXCEPTION 'master_admin_immutable: cannot modify Master_Admin attributes'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_master_admin_immutable_update ON users;
CREATE TRIGGER users_master_admin_immutable_update
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_master_admin_immutable_update();

-- ========== 3. Trigger users_master_admin_immutable_delete ==========

CREATE OR REPLACE FUNCTION users_master_admin_immutable_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_master_username CONSTANT text := 'Nexus_Vortex99';
BEGIN
  IF OLD.admin_username IS NOT DISTINCT FROM v_master_username THEN
    BEGIN
      PERFORM log_admin_action(
        'MASTER_ADMIN_IMMUTABLE_BLOCKED',
        'users',
        OLD.id::text,
        to_jsonb(OLD),
        jsonb_build_object('attempted', 'DELETE'),
        NULL, NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE EXCEPTION 'master_admin_immutable: cannot delete Master_Admin'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$func$;

DROP TRIGGER IF EXISTS users_master_admin_immutable_delete ON users;
CREATE TRIGGER users_master_admin_immutable_delete
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION users_master_admin_immutable_delete();

-- ========== 4. Trigger admin_roles_master_immutable ==========

CREATE OR REPLACE FUNCTION admin_roles_master_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_master_id uuid;
BEGIN
  SELECT u.id INTO v_master_id
  FROM users u
  WHERE u.admin_username = 'Nexus_Vortex99'
  LIMIT 1;

  IF v_master_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id = v_master_id
     AND NEW.role = 'SUPER_ADMIN'
     AND NEW.revoked_at IS NOT NULL
     AND OLD.revoked_at IS NULL THEN
    BEGIN
      PERFORM log_admin_action(
        'MASTER_ADMIN_IMMUTABLE_BLOCKED',
        'admin_roles',
        OLD.id::text,
        to_jsonb(OLD),
        to_jsonb(NEW),
        NULL, NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE EXCEPTION 'master_admin_immutable: cannot revoke Master_Admin SUPER_ADMIN role'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS admin_roles_master_immutable ON admin_roles;
CREATE TRIGGER admin_roles_master_immutable
  BEFORE UPDATE ON admin_roles
  FOR EACH ROW EXECUTE FUNCTION admin_roles_master_immutable();

-- ========== 5. count_active_super_admins() ==========

CREATE OR REPLACE FUNCTION count_active_super_admins()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT COUNT(DISTINCT user_id)::integer
  FROM admin_roles
  WHERE role = 'SUPER_ADMIN'
    AND revoked_at IS NULL;
$func$;

REVOKE ALL ON FUNCTION count_active_super_admins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_active_super_admins() TO authenticated;

-- ========== 6. Trigger last_super_admin_protected ==========

CREATE OR REPLACE FUNCTION last_super_admin_protected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_remaining integer;
BEGIN
  IF OLD.role = 'SUPER_ADMIN'
     AND OLD.revoked_at IS NULL
     AND NEW.revoked_at IS NOT NULL THEN
    -- Serializa transacoes concorrentes que tentam revogar SUPER_ADMINs
    PERFORM pg_advisory_xact_lock(hashtext('admin_roles_super_admin_revoke'));

    SELECT COUNT(DISTINCT user_id) INTO v_remaining
    FROM admin_roles
    WHERE role = 'SUPER_ADMIN'
      AND revoked_at IS NULL
      AND id <> OLD.id;

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'last_super_admin_protected: cannot revoke the last active SUPER_ADMIN'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS last_super_admin_protected ON admin_roles;
CREATE TRIGGER last_super_admin_protected
  BEFORE UPDATE ON admin_roles
  FOR EACH ROW EXECUTE FUNCTION last_super_admin_protected();


-- ========== 7. SECURITY DEFINER: admin_force_logout ==========

CREATE OR REPLACE FUNCTION admin_force_logout(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
DECLARE
  v_caller     uuid := auth.uid();
  v_target_un  text;
  v_count      integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_force_logout requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('USER_EDIT') THEN
    RAISE EXCEPTION 'permission_denied: USER_EDIT required';
  END IF;
  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'self_action_forbidden';
  END IF;

  SELECT admin_username INTO v_target_un
  FROM users WHERE id = p_user_id;

  IF v_target_un = 'Nexus_Vortex99' THEN
    RAISE EXCEPTION 'master_admin_immutable';
  END IF;

  -- Revoga todos os refresh tokens do usuario
  UPDATE auth.refresh_tokens
     SET revoked = true
   WHERE user_id::uuid = p_user_id
     AND revoked = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_admin_action(
    'USER_FORCE_LOGOUT',
    'users',
    p_user_id::text,
    NULL,
    jsonb_build_object('revoked_tokens', v_count, 'revoked_at', now()),
    NULL, NULL
  );

  RETURN jsonb_build_object('revoked_tokens', v_count);
END;
$func$;

REVOKE ALL ON FUNCTION admin_force_logout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_force_logout(uuid) TO authenticated;

-- ========== 8. SECURITY DEFINER: admin_delete_user ==========

CREATE OR REPLACE FUNCTION admin_delete_user(
  p_user_id              uuid,
  p_cancel_active_fretes boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_target_un      text;
  v_target_type    text;
  v_cancelled      integer := 0;
  v_frete_id       uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_delete_user requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('USER_DELETE') THEN
    RAISE EXCEPTION 'permission_denied: USER_DELETE required';
  END IF;
  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'self_action_forbidden';
  END IF;

  SELECT admin_username, user_type
    INTO v_target_un, v_target_type
  FROM users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_target_un = 'Nexus_Vortex99' THEN
    RAISE EXCEPTION 'master_admin_immutable';
  END IF;

  -- Cancela fretes ativos se solicitado e se for embarcador
  IF p_cancel_active_fretes AND v_target_type = 'embarcador' THEN
    FOR v_frete_id IN
      SELECT id FROM fretes
      WHERE embarcador_id = p_user_id AND status = 'ativo'
      FOR UPDATE
    LOOP
      UPDATE fretes SET status = 'cancelado' WHERE id = v_frete_id;
      v_cancelled := v_cancelled + 1;
      PERFORM log_admin_action(
        'FRETE_AUTO_CANCEL',
        'fretes',
        v_frete_id::text,
        jsonb_build_object('status', 'ativo', 'reason', 'user_delete_cascade'),
        jsonb_build_object('status', 'cancelado'),
        NULL, NULL
      );
    END LOOP;
  END IF;

  -- DELETE com cascade ja configurado nas FKs
  DELETE FROM users WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'cancelled_fretes', v_cancelled
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_delete_user(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_user(uuid, boolean) TO authenticated;


-- ========== 9. RLS Policies adicionais ==========

-- users
DROP POLICY IF EXISTS users_admin_select ON users;
CREATE POLICY users_admin_select ON users
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_VIEW'));

DROP POLICY IF EXISTS users_admin_update ON users;
CREATE POLICY users_admin_update ON users
  FOR UPDATE TO authenticated
  USING (
    is_admin_with_permission('USER_EDIT')
    OR is_admin_with_permission('USER_TOGGLE_ACTIVE')
  )
  WITH CHECK (
    is_admin_with_permission('USER_EDIT')
    OR is_admin_with_permission('USER_TOGGLE_ACTIVE')
  );

DROP POLICY IF EXISTS users_admin_delete ON users;
CREATE POLICY users_admin_delete ON users
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('USER_DELETE'));

-- motoristas
DROP POLICY IF EXISTS motoristas_admin_select ON motoristas;
CREATE POLICY motoristas_admin_select ON motoristas
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_VIEW'));

DROP POLICY IF EXISTS motoristas_admin_update ON motoristas;
CREATE POLICY motoristas_admin_update ON motoristas
  FOR UPDATE TO authenticated
  USING (is_admin_with_permission('USER_EDIT'))
  WITH CHECK (is_admin_with_permission('USER_EDIT'));

DROP POLICY IF EXISTS motoristas_admin_delete ON motoristas;
CREATE POLICY motoristas_admin_delete ON motoristas
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('USER_DELETE'));

-- embarcadores
DROP POLICY IF EXISTS embarcadores_admin_select ON embarcadores;
CREATE POLICY embarcadores_admin_select ON embarcadores
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_VIEW'));

DROP POLICY IF EXISTS embarcadores_admin_update ON embarcadores;
CREATE POLICY embarcadores_admin_update ON embarcadores
  FOR UPDATE TO authenticated
  USING (is_admin_with_permission('USER_EDIT'))
  WITH CHECK (is_admin_with_permission('USER_EDIT'));

DROP POLICY IF EXISTS embarcadores_admin_delete ON embarcadores;
CREATE POLICY embarcadores_admin_delete ON embarcadores
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('USER_DELETE'));

-- documents (apenas SELECT mapeado a USER_VIEW)
DROP POLICY IF EXISTS documents_admin_select ON documents;
CREATE POLICY documents_admin_select ON documents
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_VIEW'));

-- notifications (apenas SELECT)
DROP POLICY IF EXISTS notifications_admin_select ON notifications;
CREATE POLICY notifications_admin_select ON notifications
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_VIEW'));

-- chat_messages (metadata via USER_VIEW; conteudo fica para admin-suporte com SUPORTE_REPLY)
DROP POLICY IF EXISTS chat_messages_admin_metadata ON chat_messages;
CREATE POLICY chat_messages_admin_metadata ON chat_messages
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('USER_VIEW'));

-- ========== 10. VERIFY: smoke test pos-deploy ==========
-- Executar manualmente apos aplicar a migration.

-- 1. Colunas novas em users
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='users'
--   AND column_name IN ('ban_reason','banned_at','banned_by');
-- Esperado: 3 linhas

-- 2. Triggers novos
-- SELECT tgname FROM pg_trigger
-- WHERE tgname IN (
--   'users_master_admin_immutable_update',
--   'users_master_admin_immutable_delete',
--   'admin_roles_master_immutable',
--   'last_super_admin_protected'
-- );
-- Esperado: 4 linhas

-- 3. Funcoes novas
-- SELECT proname FROM pg_proc
-- WHERE proname IN (
--   'count_active_super_admins',
--   'admin_force_logout',
--   'admin_delete_user'
-- );
-- Esperado: 3 linhas

-- 4. Policies RLS adicionais
-- SELECT tablename, policyname FROM pg_policies
-- WHERE policyname IN (
--   'users_admin_select','users_admin_update','users_admin_delete',
--   'motoristas_admin_select','motoristas_admin_update','motoristas_admin_delete',
--   'embarcadores_admin_select','embarcadores_admin_update','embarcadores_admin_delete',
--   'documents_admin_select','notifications_admin_select','chat_messages_admin_metadata'
-- );
-- Esperado: 12 linhas

-- 5. count_active_super_admins() retorna >= 1 (Master existe)
-- SELECT count_active_super_admins();
-- Esperado: >= 1

COMMIT;
