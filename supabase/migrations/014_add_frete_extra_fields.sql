-- ============================================================================
-- Migration 014: Adicionar campos extras de frete
-- ============================================================================
-- Idempotente. Adiciona todos os campos do FreteForm que ainda não tinham
-- coluna na tabela fretes.
-- ============================================================================

BEGIN;

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS onu_number             VARCHAR(50),
  ADD COLUMN IF NOT EXISTS temperature            DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS weight_unit            VARCHAR(20) DEFAULT 'toneladas',
  ADD COLUMN IF NOT EXISTS freight_type           VARCHAR(20) DEFAULT 'completa',
  ADD COLUMN IF NOT EXISTS occupancy_percentage   INTEGER,
  ADD COLUMN IF NOT EXISTS body_types             TEXT,
  ADD COLUMN IF NOT EXISTS requires_lona          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_tracker       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_insurance     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS value_known            BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS price_calculation      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_methods        TEXT,
  ADD COLUMN IF NOT EXISTS advance_percentage     INTEGER;

COMMIT;
