-- =====================================================
-- Rollback da Migration 060: RPC admin de Assinaturas
--
-- Documentação (NÃO auto-aplicado). Dropa a RPC admin_list_subscriptions.
-- =====================================================

BEGIN;

DROP FUNCTION IF EXISTS admin_list_subscriptions(text, text, text, int, int);

COMMIT;

-- VERIFY:
/*
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_list_subscriptions'; -- 0 linhas
*/
