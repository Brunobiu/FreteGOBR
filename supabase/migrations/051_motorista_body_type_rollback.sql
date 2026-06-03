-- Rollback Migration 051
BEGIN;
ALTER TABLE motoristas DROP COLUMN IF EXISTS body_type;
COMMIT;
