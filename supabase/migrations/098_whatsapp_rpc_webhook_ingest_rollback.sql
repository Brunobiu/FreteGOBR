-- ============================================================================
-- ROLLBACK da Migration 098 — whatsapp_ingest_inbound_message (task 16.1)
-- ----------------------------------------------------------------------------
-- Documentacao de reversao (NAO auto-aplicada). Desfaz apenas os objetos
-- criados pela 098, preservando o schema/tabelas da 092 e quaisquer dados de
-- conversas/mensagens ja ingeridos (a RPC nao cria tabelas, apenas a funcao).
--
-- Ordem inversa da 098: apenas a funcao (REVOKE/GRANT somem junto com o DROP).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_ingest_inbound_message(uuid, text, text, text, text);

COMMIT;
