-- ============================================================================
-- Rollback Migration 039: Categorias de Commodities
-- ============================================================================
-- ATENCAO: rollback documental. NAO eh aplicado automaticamente.
-- Remove tabela, trigger, policies, bucket commodity_icons e todos os arquivos
-- nele. Aplicar APENAS em situacoes de cleanup planejado.
-- ============================================================================

BEGIN;

-- Remove triggers
DROP TRIGGER IF EXISTS commodity_categories_set_updated_at ON commodity_categories;
DROP FUNCTION IF EXISTS trg_commodity_categories_updated_at();

-- Remove policies da tabela
DROP POLICY IF EXISTS commodity_categories_select_active ON commodity_categories;
DROP POLICY IF EXISTS commodity_categories_select_admin ON commodity_categories;
DROP POLICY IF EXISTS commodity_categories_insert_admin ON commodity_categories;
DROP POLICY IF EXISTS commodity_categories_update_admin ON commodity_categories;
DROP POLICY IF EXISTS commodity_categories_delete_admin ON commodity_categories;

-- Remove tabela
DROP TABLE IF EXISTS commodity_categories;

-- Remove policies do bucket
DROP POLICY IF EXISTS commodity_icons_select ON storage.objects;
DROP POLICY IF EXISTS commodity_icons_insert ON storage.objects;
DROP POLICY IF EXISTS commodity_icons_update ON storage.objects;
DROP POLICY IF EXISTS commodity_icons_delete ON storage.objects;

-- Remove arquivos do bucket
DELETE FROM storage.objects WHERE bucket_id = 'commodity_icons';

-- Remove o bucket
DELETE FROM storage.buckets WHERE id = 'commodity_icons';

COMMIT;
