-- ============================================================================
-- Migration 017: Campos do Painel do Motorista
-- ============================================================================
-- Idempotente. Apenas ADD COLUMN IF NOT EXISTS e expansão do CHECK em
-- documents.document_type. NÃO altera embarcadores, fretes ou users.
--
-- Implementa a spec `.kiro/specs/motorista-onboarding-painel/`:
--   * Reorganização do perfil do motorista em 3 seções
--   * Cálculos financeiros no painel (km/l, eixos, capacidade, diesel)
--   * Adição do tipo de documento `documento_proprietario`
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. NOVAS COLUNAS EM motoristas (Req 15.1, 15.3)
-- ============================================================================
-- Todas anuláveis ou com default seguro para preservar dados existentes.

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS vehicle_year_manufacture INTEGER;

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS vehicle_year_model       INTEGER;

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS km_per_liter             NUMERIC(4, 1);

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS trailer_axles            INTEGER;

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS cargo_capacity_ton       NUMERIC(5, 1);

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS diesel_price             NUMERIC(5, 2);

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS is_owner                 BOOLEAN DEFAULT TRUE;

-- ============================================================================
-- 2. BACKFILL: vehicle_year (legado) -> vehicle_year_manufacture (Req 15.4)
-- ============================================================================
-- Preserva a coluna vehicle_year intacta. Apenas copia o valor para o novo
-- campo quando ele estiver nulo.

UPDATE motoristas
   SET vehicle_year_manufacture = vehicle_year
 WHERE vehicle_year_manufacture IS NULL
   AND vehicle_year IS NOT NULL;

-- ============================================================================
-- 3. EXPANDIR CHECK DE documents.document_type (Req 15.2)
-- ============================================================================
-- Recriação como SUPERCONJUNTO: todos os 19 tipos atuais + 1 novo.
-- Nenhum tipo existente é removido.

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_document_type_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN (
    'cpf', 'cnh', 'antt',
    'vehicle_registration', 'vehicle_insurance', 'profile_photo',
    'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
    'crlv_carreta_3', 'crlv_carreta_4',
    'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
    'foto_segurando_cnh', 'foto_frente_caminhao',
    'comprovante_endereco_proprietario',
    'comprovante_endereco_motorista',
    'foto_caminhao_completo',
    'documento_proprietario'
  ));

-- ============================================================================
-- 4. CHECKS DE RANGE EM motoristas (Req 15.3)
-- ============================================================================
-- Idempotentes via consulta a information_schema.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_km_per_liter_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_km_per_liter_check
      CHECK (km_per_liter IS NULL OR (km_per_liter >= 1.0 AND km_per_liter <= 10.0));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_trailer_axles_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_trailer_axles_check
      CHECK (trailer_axles IS NULL OR (trailer_axles >= 2 AND trailer_axles <= 9));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_diesel_price_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_diesel_price_check
      CHECK (diesel_price IS NULL OR (diesel_price >= 1.00 AND diesel_price <= 20.00));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_cargo_capacity_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_cargo_capacity_check
      CHECK (cargo_capacity_ton IS NULL OR (cargo_capacity_ton >= 1.0 AND cargo_capacity_ton <= 80.0));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_year_manufacture_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_year_manufacture_check
      CHECK (
        vehicle_year_manufacture IS NULL
        OR (vehicle_year_manufacture >= 1980 AND vehicle_year_manufacture <= 2100)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_year_model_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_year_model_check
      CHECK (
        vehicle_year_model IS NULL
        OR (vehicle_year_model >= 1980 AND vehicle_year_model <= 2100)
      );
  END IF;
END $$;

COMMIT;
