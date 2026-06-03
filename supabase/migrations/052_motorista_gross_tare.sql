-- ============================================================================
-- Migration 052: peso bruto e tara do caminhao do motorista
-- ============================================================================
-- A capacidade de carga (cargo_capacity_ton) era informada direto pelo
-- motorista. Agora ele informa o PESO BRUTO TOTAL (PBT) e a TARA do
-- veiculo, e a UI calcula o LIQUIDO = bruto - tara — que segue gravado
-- em `cargo_capacity_ton` para nao quebrar o calculo financeiro do
-- painel de fretes.
--
-- - gross_weight_ton: PBT em toneladas (ex.: 47.000)
-- - tare_weight_ton:  Tara em toneladas (ex.: 17.000)
-- - cargo_capacity_ton (existente) = bruto - tara, atualizado pelo client
--
-- Limites de sanidade reaproveitam o range existente da capacidade
-- (1 a 80 toneladas).
-- ============================================================================

BEGIN;

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS gross_weight_ton NUMERIC(5, 1);

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS tare_weight_ton NUMERIC(5, 1);

-- Constraint de range no bruto (idempotente)
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'motoristas'
       AND constraint_name = 'motoristas_gross_weight_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_gross_weight_check
      CHECK (
        gross_weight_ton IS NULL
        OR (gross_weight_ton >= 1.0 AND gross_weight_ton <= 100.0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'motoristas'
       AND constraint_name = 'motoristas_tare_weight_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_tare_weight_check
      CHECK (
        tare_weight_ton IS NULL
        OR (tare_weight_ton >= 0.5 AND tare_weight_ton <= 50.0)
      );
  END IF;
END
$check$;

COMMENT ON COLUMN motoristas.gross_weight_ton IS
  'Peso Bruto Total (PBT) do caminhao em toneladas. Informado pelo motorista.';

COMMENT ON COLUMN motoristas.tare_weight_ton IS
  'Tara (peso do caminhao vazio) em toneladas. Informado pelo motorista.';

COMMIT;

/*
-- VERIFY:
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name='motoristas' AND column_name IN ('gross_weight_ton', 'tare_weight_ton');
*/
