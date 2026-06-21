-- ============================================================================
-- Rollback da Migration 120: public_stats
-- ============================================================================
-- Remove a RPC pública de estatísticas da landing.
-- NÃO é aplicado automaticamente — execução manual/documentação.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public_stats();

COMMIT;
