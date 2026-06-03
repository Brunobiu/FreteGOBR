-- ============================================================================
-- Migration 051: body_type no motorista
-- ============================================================================
-- Adiciona o tipo de carroceria que o motorista declara para o veiculo dele.
-- Lista canonica vive em src/data/bodyTypes.ts (front-end). Aqui o tipo eh
-- TEXT para nao acoplar o banco a uma enum rigida — futuras edicoes da
-- lista nao exigem migration.
--
-- Uso:
--  - Perfil do motorista: campo unico (motorista tem 1 carroceria).
--  - Filtro futuro: cruzar com fretes.body_types (multi) para mostrar
--    so fretes que aceitam a carroceria do motorista.
-- ============================================================================

BEGIN;

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS body_type TEXT;

COMMENT ON COLUMN motoristas.body_type IS
  'Slug canonico da carroceria do motorista (ver src/data/bodyTypes.ts).';

COMMIT;

/*
-- VERIFY:
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name='motoristas' AND column_name='body_type';
*/
