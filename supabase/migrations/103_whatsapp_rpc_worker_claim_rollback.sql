-- ============================================================================
-- ROLLBACK da Migration 103 — whatsapp_claim_due_jobs / whatsapp_claim_next_recipient (task 12.1)
-- ----------------------------------------------------------------------------
-- Documentacao de reversao (NAO auto-aplicada). Desfaz apenas as funcoes de
-- claim atomico criadas pela 103, preservando todo o schema/dados das demais
-- migrations (092 foundation, RPCs 096..102). Aplicar manualmente no SQL editor
-- do ambiente hospedado se for necessario reverter a task 12.1.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_claim_next_recipient(uuid);
DROP FUNCTION IF EXISTS whatsapp_claim_due_jobs(int);

COMMIT;
