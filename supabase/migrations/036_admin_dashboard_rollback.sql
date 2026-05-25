-- ============================================================================
-- Migration 036 — ROLLBACK (Admin Dashboard)
-- ============================================================================
-- NAO e auto-aplicado. Serve como referencia documentada para recovery.
-- Use apenas em ambiente de desenvolvimento ou em incidente que justifique
-- reverter a migration 036.
--
-- O QUE ESTE SCRIPT FAZ:
--   1) DROP da funcao admin_dashboard_metrics(timestamptz, timestamptz, text, text)
--   2) Reverte is_admin_with_permission para a versao da migration 035
--      (sem DASHBOARD_VIEW na matriz de SUPORTE/FINANCEIRO).
--
-- O QUE ESTE SCRIPT NAO FAZ:
--   - NAO dropa os indices auxiliares idx_users_created_at,
--     idx_fretes_created_at, idx_fretes_updated_at_status. Eles sao
--     auxiliares idempotentes que podem servir a outras consultas.
--     Caso queira remover, descomente o bloco final.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DROP da RPC admin_dashboard_metrics
-- ============================================================================

DROP FUNCTION IF EXISTS admin_dashboard_metrics(timestamptz, timestamptz, text, text);


-- ============================================================================
-- 2. Reverter is_admin_with_permission para versao da migration 035
-- ============================================================================
-- Remove DASHBOARD_VIEW de SUPORTE e FINANCEIRO. Mantem demais actions.
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
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW',
            'BLACKLIST_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_MANAGE'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;


-- ============================================================================
-- 3. (OPCIONAL) DROP dos indices auxiliares — descomente se quiser limpar
-- ============================================================================
/*
DROP INDEX IF EXISTS idx_users_created_at;
DROP INDEX IF EXISTS idx_fretes_created_at;
DROP INDEX IF EXISTS idx_fretes_updated_at_status;
*/

COMMIT;
