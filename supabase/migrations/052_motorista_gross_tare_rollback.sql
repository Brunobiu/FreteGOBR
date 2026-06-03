-- Rollback Migration 052
BEGIN;

ALTER TABLE motoristas DROP CONSTRAINT IF EXISTS motoristas_gross_weight_check;
ALTER TABLE motoristas DROP CONSTRAINT IF EXISTS motoristas_tare_weight_check;
ALTER TABLE motoristas DROP COLUMN IF EXISTS gross_weight_ton;
ALTER TABLE motoristas DROP COLUMN IF EXISTS tare_weight_ton;

COMMIT;
