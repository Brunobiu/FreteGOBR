-- ============================================================================
-- Migration 016: Adicionar CNPJ em embarcadores
-- ============================================================================
-- Idempotente. CNPJ armazenado apenas com dígitos (14 caracteres).
-- ============================================================================

BEGIN;

ALTER TABLE embarcadores
  ADD COLUMN IF NOT EXISTS cnpj VARCHAR(14);

CREATE INDEX IF NOT EXISTS idx_embarcadores_cnpj ON embarcadores(cnpj);

COMMIT;
