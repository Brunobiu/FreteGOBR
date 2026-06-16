-- ============================================================================
-- ROLLBACK da Migration 102 — whatsapp_claim_ai_reply / whatsapp_finalize_ai_reply (task 16.2)
-- ----------------------------------------------------------------------------
-- Documentacao de reversao (NAO auto-aplicada). Desfaz apenas as funcoes
-- criadas pela 102, preservando o schema/tabelas da 092 e quaisquer dados de
-- ai_replies/mensagens ja persistidos (as RPCs nao criam tabelas).
--
-- Ordem inversa da 102 (REVOKE/GRANT somem junto com o DROP).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_finalize_ai_reply(uuid, text, text, text);
DROP FUNCTION IF EXISTS whatsapp_claim_ai_reply(uuid, text, uuid);

COMMIT;
