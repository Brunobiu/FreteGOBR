-- ============================================================================
-- Migration 033: Filial do embarcador (estado + cidade)
-- ============================================================================
-- Idempotente. Adiciona dois campos opcionais para o embarcador identificar
-- a filial de onde opera (UF de 2 letras + cidade livre). Sao mostrados no
-- painel admin junto ao detalhe do frete.

BEGIN;

ALTER TABLE embarcadores
  ADD COLUMN IF NOT EXISTS branch_state CHAR(2) NULL,
  ADD COLUMN IF NOT EXISTS branch_city  VARCHAR(120) NULL;

-- Garante que branch_state seja sempre uppercase quando preenchido.
ALTER TABLE embarcadores DROP CONSTRAINT IF EXISTS chk_embarcadores_branch_state;
ALTER TABLE embarcadores
  ADD CONSTRAINT chk_embarcadores_branch_state
  CHECK (
    branch_state IS NULL
    OR branch_state IN (
      'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
      'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
    )
  );

-- Indice util pra futuros filtros por filial no painel admin.
CREATE INDEX IF NOT EXISTS idx_embarcadores_branch_state ON embarcadores(branch_state);

COMMIT;

-- VERIFY
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='embarcadores' AND column_name IN ('branch_state','branch_city');
-- Esperado: 2 linhas
