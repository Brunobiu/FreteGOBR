-- =====================================================
-- Rollback da Migration 035: admin-blacklist
--
-- ATENCAO: este script e DESTRUTIVO. Aplicar apenas em
-- caso de incidente confirmado e apos backup completo
-- de admin_audit_logs (varias linhas com action LIKE 'BLACKLIST_%'
-- referenciam admin_blacklist via target_id em formato uuid::text).
--
-- NAO e auto-aplicado. Documentado para recovery.
--
-- Reverte:
--   - 3 triggers (users_blacklist_block, embarcadores_blacklist_block,
--     admin_blacklist_set_updated_at)
--   - 5 RPCs (admin_blacklist_add, admin_blacklist_update,
--     admin_blacklist_reactivate, admin_blacklist_remove,
--     admin_blacklist_remove_by_user)
--   - 2 funcoes utilitarias (is_blacklisted, log_blacklist_block)
--   - 2 funcoes puras (blacklist_normalize, blacklist_validate)
--   - 4 policies RLS
--   - 1 indice unico parcial + 5 secundarios
--   - 1 constraint chk_admin_blacklist_remove_consistency
--   - tabela admin_blacklist
--   - is_admin_with_permission revertida para o estado pos-032 (sem
--     BLACKLIST_VIEW em SUPORTE, sem BLACKLIST_MANAGE em MODERADOR;
--     volta o BLACKLIST_EDIT inerte de MODERADOR conforme migration 030)
-- =====================================================

BEGIN;

-- 1. Triggers em users / embarcadores / admin_blacklist
DROP TRIGGER IF EXISTS users_blacklist_block       ON users;
DROP TRIGGER IF EXISTS embarcadores_blacklist_block ON embarcadores;
DROP TRIGGER IF EXISTS admin_blacklist_set_updated_at ON admin_blacklist;

-- 2. Trigger functions
DROP FUNCTION IF EXISTS users_blacklist_block();
DROP FUNCTION IF EXISTS embarcadores_blacklist_block();
DROP FUNCTION IF EXISTS admin_blacklist_set_updated_at();

-- 3. RPCs SECURITY DEFINER (5)
DROP FUNCTION IF EXISTS admin_blacklist_remove_by_user(uuid);
DROP FUNCTION IF EXISTS admin_blacklist_remove(uuid, text);
DROP FUNCTION IF EXISTS admin_blacklist_reactivate(uuid, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS admin_blacklist_update(uuid, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS admin_blacklist_add(text, text, text, timestamptz, uuid);

-- 4. Funcoes utilitarias user-facing
DROP FUNCTION IF EXISTS log_blacklist_block(text, text, text, text, text);
DROP FUNCTION IF EXISTS is_blacklisted(text, text);

-- 5. Funcoes puras
DROP FUNCTION IF EXISTS blacklist_validate(text, text);
DROP FUNCTION IF EXISTS blacklist_normalize(text, text);

-- 6. Policies RLS
DROP POLICY IF EXISTS admin_blacklist_delete ON admin_blacklist;
DROP POLICY IF EXISTS admin_blacklist_update ON admin_blacklist;
DROP POLICY IF EXISTS admin_blacklist_insert ON admin_blacklist;
DROP POLICY IF EXISTS admin_blacklist_select ON admin_blacklist;

-- 7. Indices (unico parcial + 5 secundarios)
DROP INDEX IF EXISTS idx_admin_blacklist_source_user_id;
DROP INDEX IF EXISTS idx_admin_blacklist_expires_at;
DROP INDEX IF EXISTS idx_admin_blacklist_created_by;
DROP INDEX IF EXISTS idx_admin_blacklist_created_at;
DROP INDEX IF EXISTS idx_admin_blacklist_type;
DROP INDEX IF EXISTS idx_admin_blacklist_active_unique;

-- 8. Constraint
ALTER TABLE IF EXISTS admin_blacklist
  DROP CONSTRAINT IF EXISTS chk_admin_blacklist_remove_consistency;

-- 9. Tabela admin_blacklist (DROP CASCADE para limpar eventuais FKs externas
--    como source_user_id ja sao ON DELETE SET NULL, mas mantemos defensivo)
DROP TABLE IF EXISTS admin_blacklist CASCADE;

-- 10. Reverte is_admin_with_permission para o estado pre-035
--     (igual a versao em 030_admin_foundation.sql; nenhuma alteracao
--     intermediaria em 031/032/033 tocou esta funcao).
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
GRANT  EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;

COMMIT;

-- =====================================================
-- Pos-rollback: validar manualmente
-- =====================================================
/*
-- Tabela removida
SELECT to_regclass('public.admin_blacklist');
-- Esperado: NULL

-- Funcoes removidas
SELECT proname FROM pg_proc
 WHERE proname IN ('blacklist_normalize','blacklist_validate',
                   'is_blacklisted','log_blacklist_block',
                   'admin_blacklist_add','admin_blacklist_update',
                   'admin_blacklist_reactivate','admin_blacklist_remove',
                   'admin_blacklist_remove_by_user',
                   'admin_blacklist_set_updated_at',
                   'users_blacklist_block','embarcadores_blacklist_block');
-- Esperado: 0 linhas

-- Triggers removidos
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('users_blacklist_block','embarcadores_blacklist_block',
                  'admin_blacklist_set_updated_at')
   AND NOT tgisinternal;
-- Esperado: 0 linhas

-- is_admin_with_permission ainda existe mas sem BLACKLIST_MANAGE/BULK
-- (testar em sessao SUPER_ADMIN apenas para fumaca)
SELECT is_admin_with_permission('USER_VIEW');
-- Esperado: true (como antes)
*/
