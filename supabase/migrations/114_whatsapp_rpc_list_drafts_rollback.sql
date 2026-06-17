-- ============================================================================
-- ROLLBACK da Migration 114 — whatsapp_list_drafts (task 20.13)
-- ----------------------------------------------------------------------------
-- Documentação de reversão (NÃO auto-aplicada). Remove apenas a RPC de listagem
-- de rascunhos criada pela 114, preservando o schema/dados. Aplicar manualmente
-- no SQL editor do ambiente hospedado se necessário.
--
-- Idempotente: DROP FUNCTION IF EXISTS com a assinatura exata da 114.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_list_drafts(uuid);

COMMIT;
