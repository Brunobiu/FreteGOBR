-- ============================================================================
-- Rollback Migration 050: remove product_slug de fretes
-- ============================================================================
-- Documentacao apenas, nao auto-aplicada.
-- Aplicar manualmente se precisar reverter a migration 050.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_fretes_product_slug_status;

ALTER TABLE fretes
  DROP COLUMN IF EXISTS product_slug;

COMMIT;
