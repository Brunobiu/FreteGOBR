-- ============================================================================
-- ROLLBACK da Migration 106 — whatsapp_update_draft (task 11.3)
-- ----------------------------------------------------------------------------
-- Documentacao de reversao (NAO auto-aplicada). Desfaz APENAS a funcao criada
-- pela 106 (`whatsapp_update_draft`), preservando integralmente:
--   * o schema/tabelas da 092 (whatsapp foundation);
--   * as RPCs de criacao/transicao reusadas pelos Drafts
--     (`whatsapp_create_dispatch_job` da 099, `whatsapp_transition_dispatch`
--     da 101) — a 106 NAO as cria nem as altera, logo este rollback NAO as toca;
--   * quaisquer Dispatch_Jobs/Dispatch_Recipients ja persistidos (a RPC nao
--     cria tabelas, apenas edita linhas existentes).
--
-- Ordem inversa da 106 (REVOKE/GRANT somem junto com o DROP da funcao).
-- Idempotente: DROP FUNCTION IF EXISTS com a assinatura exata declarada na 106.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_update_draft(
  uuid, distribution_mode, int, int, int, uuid, text[], uuid[], uuid, timestamptz
);

COMMIT;
