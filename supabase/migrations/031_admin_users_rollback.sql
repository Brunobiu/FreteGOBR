-- =====================================================
-- ROLLBACK 031: admin-users
-- ATENCAO: aplicar somente se 031 esta causando incidente em prod.
-- A reversao de policies RLS pode reabrir acesso indevido em janelas
-- onde apenas a 030 esta aplicada — coordenar com plano de mitigacao.
--
-- Este script NAO e auto-aplicado. Serve como referencia para recovery.
-- =====================================================
BEGIN;

-- 1. Remover policies adicionais
DROP POLICY IF EXISTS users_admin_select          ON users;
DROP POLICY IF EXISTS users_admin_update          ON users;
DROP POLICY IF EXISTS users_admin_delete          ON users;
DROP POLICY IF EXISTS motoristas_admin_select     ON motoristas;
DROP POLICY IF EXISTS motoristas_admin_update     ON motoristas;
DROP POLICY IF EXISTS motoristas_admin_delete     ON motoristas;
DROP POLICY IF EXISTS embarcadores_admin_select   ON embarcadores;
DROP POLICY IF EXISTS embarcadores_admin_update   ON embarcadores;
DROP POLICY IF EXISTS embarcadores_admin_delete   ON embarcadores;
DROP POLICY IF EXISTS documents_admin_select      ON documents;
DROP POLICY IF EXISTS notifications_admin_select  ON notifications;
DROP POLICY IF EXISTS chat_messages_admin_metadata ON chat_messages;

-- 2. Remover funcoes RPC
DROP FUNCTION IF EXISTS admin_force_logout(uuid);
DROP FUNCTION IF EXISTS admin_delete_user(uuid, boolean);
DROP FUNCTION IF EXISTS count_active_super_admins();

-- 3. Remover triggers e suas funcoes
DROP TRIGGER  IF EXISTS users_master_admin_immutable_update ON users;
DROP FUNCTION IF EXISTS users_master_admin_immutable_update();

DROP TRIGGER  IF EXISTS users_master_admin_immutable_delete ON users;
DROP FUNCTION IF EXISTS users_master_admin_immutable_delete();

DROP TRIGGER  IF EXISTS admin_roles_master_immutable ON admin_roles;
DROP FUNCTION IF EXISTS admin_roles_master_immutable();

DROP TRIGGER  IF EXISTS last_super_admin_protected ON admin_roles;
DROP FUNCTION IF EXISTS last_super_admin_protected();

-- 4. Remover constraints + indice
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_ban_consistency;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_ban_reason_length;
DROP INDEX IF EXISTS idx_users_banned;

-- ATENCAO: dropar colunas perde dados de banimento existentes.
-- Faca backup antes.
ALTER TABLE users DROP COLUMN IF EXISTS banned_by;
ALTER TABLE users DROP COLUMN IF EXISTS banned_at;
ALTER TABLE users DROP COLUMN IF EXISTS ban_reason;

COMMIT;
