-- ============================================================================
-- Migration 013: Adicionar coluna product em fretes
-- ============================================================================
-- Idempotente. Permite que o frete armazene o "produto" exato (Soja, Milho,
-- etc), separado do "tipo de carga" (Carga Geral, Granel, etc).
-- ============================================================================

BEGIN;

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS product VARCHAR(255);

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS cargo_species VARCHAR(100);

COMMIT;
