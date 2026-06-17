-- ============================================================================
-- ROLLBACK da Migration 110 — whatsapp_record_extraction (task 18.1)
-- ----------------------------------------------------------------------------
-- Documentacao de reversao (NAO auto-aplicada). Desfaz apenas a RPC de
-- persistencia de Contact_Extraction criada pela 110, preservando todo o
-- schema/dados das demais migrations (092 foundation, tabela
-- `whatsapp_extracted_contacts`, RPCs 096..109). Aplicar manualmente no SQL
-- editor do ambiente hospedado se for necessario reverter a task 18.1.
--
-- Idempotente: DROP FUNCTION IF EXISTS com a assinatura exata da 110. Nenhuma
-- linha de `whatsapp_extracted_contacts` e removida — o rollback reverte apenas
-- a funcao, nao os dados eventualmente gravados por ela.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_record_extraction(uuid, jsonb);

COMMIT;
