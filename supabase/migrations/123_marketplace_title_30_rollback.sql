-- 123_marketplace_title_30_rollback.sql
-- ROLLBACK documentado da migration 123 (NÃO auto-aplicado).
-- Remove o limite de 30 caracteres do título (volta a valer só o teto da 122).

BEGIN;

ALTER TABLE marketplace_posts DROP CONSTRAINT IF EXISTS marketplace_posts_title_max30;

COMMIT;
