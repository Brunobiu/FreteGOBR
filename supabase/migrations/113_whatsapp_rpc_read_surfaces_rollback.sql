-- ============================================================================
-- ROLLBACK da Migration 113 — RPCs de leitura (Dashboard/Queue/Error_Log, task 19)
-- ----------------------------------------------------------------------------
-- Documentação de reversão (NÃO auto-aplicada). Desfaz apenas as RPCs de leitura
-- criadas pela 113, preservando todo o schema/dados das demais migrations.
-- Aplicar manualmente no SQL editor do ambiente hospedado se necessário.
--
-- Idempotente: DROP FUNCTION IF EXISTS com as assinaturas exatas da 113. Nenhum
-- dado é removido — são apenas funções de leitura.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_get_error_log(uuid, uuid);
DROP FUNCTION IF EXISTS whatsapp_get_execution_queue(uuid);
DROP FUNCTION IF EXISTS whatsapp_get_dashboard(uuid);

COMMIT;
