-- 088_commodity_image_no_bg.sql
-- ---------------------------------------------------------------------------
-- Segunda imagem da categoria de commodity, SEM fundo (PNG/WebP transparente).
-- Exibida no modal do frete do motorista (mais bonita que o ícone normal, que
-- tem fundo). `icon_path` continua sendo a imagem do carrossel; este novo campo
-- é opcional e só aparece no modal quando preenchido.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.commodity_categories
  ADD COLUMN IF NOT EXISTS image_no_bg_path text
  CONSTRAINT commodity_image_no_bg_len CHECK (image_no_bg_path IS NULL OR char_length(image_no_bg_path) <= 500);

COMMENT ON COLUMN public.commodity_categories.image_no_bg_path IS
  'Segunda imagem da categoria, SEM fundo (PNG/WebP transparente), exibida no modal do frete do motorista. Bucket commodity_icons. NULL = usar fallback (icon_path ou nada).';

COMMIT;
