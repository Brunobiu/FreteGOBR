-- 088_commodity_image_no_bg_rollback.sql
-- Reverte 088: remove a coluna da imagem sem fundo. Documentacao, nao auto-aplicada.

BEGIN;

ALTER TABLE public.commodity_categories DROP COLUMN IF EXISTS image_no_bg_path;

COMMIT;
