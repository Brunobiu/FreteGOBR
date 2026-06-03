-- ============================================================================
-- Migration 050: product_slug em fretes (link com commodity_categories)
-- ============================================================================
-- Acopla cada frete a uma categoria de commodity gerenciada pelo admin
-- (tabela commodity_categories, criada na migration 039).
--
-- - Coluna product_slug TEXT (NULLABLE — fretes legados sem match continuam
--   funcionando, so nao aparecem ao filtrar por categoria).
-- - Indice em product_slug + status pra acelerar o filtro do motorista.
-- - Backfill: tenta casar fretes ja existentes por nome (lower + ILIKE
--   contendo o name da categoria).
--
-- Nao usa FK rigida pra commodity_categories.slug porque:
--   1) slug pode ser renomeado pelo admin sem quebrar fretes antigos.
--   2) Categoria deletada nao deve cascatear apagamento do frete.
--   3) UI do motorista filtra por slug; se a categoria sumir, o frete fica
--      simplesmente "orfao" e segue na lista geral.
-- ============================================================================

BEGIN;

-- Validacao defensiva: 039 (commodity_categories) ja deve estar aplicada.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='commodity_categories'
  ) THEN
    RAISE EXCEPTION 'Migration 039 (commodity_categories) nao aplicada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fretes' AND column_name='product'
  ) THEN
    RAISE EXCEPTION 'Migration 013 (frete product) nao aplicada';
  END IF;
END
$check$;

-- 1. Coluna product_slug
ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS product_slug TEXT;

COMMENT ON COLUMN fretes.product_slug IS
  'Slug da commodity_categories vinculada. NULL = frete legado sem categoria.';

-- 2. Indice composto pra acelerar filtro do motorista (status=ativo + slug)
CREATE INDEX IF NOT EXISTS idx_fretes_product_slug_status
  ON fretes (product_slug, status)
  WHERE product_slug IS NOT NULL;

-- 3. Backfill best-effort: casa fretes legados por nome.
-- Para cada categoria, atualiza fretes ativos onde:
--   - product_slug ainda eh NULL
--   - lower(product) contem lower(name) da categoria
--
-- Match conservador: se o nome da categoria aparece como substring do
-- product, conta. Ex.: "Milho amarelo grao" casa com "Milho".
-- Quem nao bater, fica NULL e segue na lista geral.
DO $backfill$
DECLARE
  v_cat record;
  v_count int;
BEGIN
  FOR v_cat IN
    SELECT slug, name FROM commodity_categories WHERE is_active = true
  LOOP
    UPDATE fretes
       SET product_slug = v_cat.slug
     WHERE product_slug IS NULL
       AND product IS NOT NULL
       AND lower(product) LIKE '%' || lower(v_cat.name) || '%';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE NOTICE 'Backfill: % fretes vinculados a "%" (%)',
        v_count, v_cat.name, v_cat.slug;
    END IF;
  END LOOP;
END
$backfill$;

COMMIT;

/*
-- VERIFY (rodar manualmente apos aplicar):
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name='fretes' AND column_name='product_slug';

SELECT indexname FROM pg_indexes
 WHERE tablename='fretes' AND indexname='idx_fretes_product_slug_status';

-- Quantos fretes pegaram categoria via backfill
SELECT product_slug, count(*)
  FROM fretes
 GROUP BY product_slug
 ORDER BY count(*) DESC;
*/
