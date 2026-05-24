-- ============================================================================
-- Migration 020: Coordenadas exatas de carregamento e entrega
-- ============================================================================
-- Idempotente. Apenas ADD COLUMN IF NOT EXISTS.
--
-- Permite ao embarcador informar latitude/longitude exatas (do Google
-- Maps, etc) do ponto de carregamento e do ponto de entrega. Os campos
-- `origin_detail` e `destination_detail` (Migration 019) continuam
-- guardando o texto livre (nome da fazenda, armazém, etc); estes novos
-- campos guardam o pin GPS opcional para o motorista abrir num app de
-- mapa.
-- ============================================================================

BEGIN;

ALTER TABLE fretes ADD COLUMN IF NOT EXISTS origin_pinned_lat       DOUBLE PRECISION;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS origin_pinned_lng       DOUBLE PRECISION;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS destination_pinned_lat  DOUBLE PRECISION;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS destination_pinned_lng  DOUBLE PRECISION;

-- Range checks defensivos (lat ∈ [-90, 90], lng ∈ [-180, 180])
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'fretes'
       AND constraint_name = 'fretes_origin_pinned_lat_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_origin_pinned_lat_check
      CHECK (origin_pinned_lat IS NULL OR (origin_pinned_lat >= -90 AND origin_pinned_lat <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'fretes'
       AND constraint_name = 'fretes_origin_pinned_lng_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_origin_pinned_lng_check
      CHECK (origin_pinned_lng IS NULL OR (origin_pinned_lng >= -180 AND origin_pinned_lng <= 180));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'fretes'
       AND constraint_name = 'fretes_destination_pinned_lat_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_destination_pinned_lat_check
      CHECK (destination_pinned_lat IS NULL OR (destination_pinned_lat >= -90 AND destination_pinned_lat <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'fretes'
       AND constraint_name = 'fretes_destination_pinned_lng_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_destination_pinned_lng_check
      CHECK (destination_pinned_lng IS NULL OR (destination_pinned_lng >= -180 AND destination_pinned_lng <= 180));
  END IF;
END $$;

COMMIT;
