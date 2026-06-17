-- ============================================================================
-- ROLLBACK da Migration 112 — RPCs de Scheduled_Dispatch (task 12.6)
-- ----------------------------------------------------------------------------
-- Documentação de reversão (NÃO auto-aplicada). Desfaz apenas as RPCs de
-- agendamento criadas pela 112, preservando todo o schema/dados das demais
-- migrations (092 foundation, tabela whatsapp_scheduled_dispatches, RPC de
-- criação 099, motor 103/111). Aplicar manualmente no SQL editor do ambiente
-- hospedado se for necessário reverter a task 12.6.
--
-- Idempotente: DROP FUNCTION IF EXISTS com as assinaturas exatas da 112. Nenhum
-- dado de whatsapp_scheduled_dispatches/dispatch_jobs é removido.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_cancel_scheduled_dispatch(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS whatsapp_list_scheduled_dispatches(uuid);
DROP FUNCTION IF EXISTS whatsapp_create_scheduled_dispatch(
  uuid, dispatch_kind, distribution_mode, int, int, int, uuid, text[], uuid[], timestamptz
);

COMMIT;
