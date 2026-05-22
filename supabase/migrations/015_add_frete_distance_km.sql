-- ============================================================================
-- Migration 015: Adicionar distância em km
-- ============================================================================
-- Idempotente. Permite armazenar a distância calculada entre origem e
-- destino para evitar recalcular toda vez.
-- ============================================================================

BEGIN;

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS distance_km INTEGER;

COMMIT;
