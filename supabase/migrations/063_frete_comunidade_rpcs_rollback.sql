-- =====================================================
-- ROLLBACK da Migration 063: remove as RPCs do módulo Frete Comunidade.
-- Documentação — não auto-aplicado.
-- =====================================================

BEGIN;

DROP FUNCTION IF EXISTS community_expire_stale_fretes();
DROP FUNCTION IF EXISTS community_publish_fretes(jsonb);
DROP FUNCTION IF EXISTS admin_list_community_fretes(text, text, int, int);
DROP FUNCTION IF EXISTS community_profile_upsert(text, text, text, boolean, timestamptz);
DROP FUNCTION IF EXISTS community_profile_get();

COMMIT;
