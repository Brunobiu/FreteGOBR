-- 122_marketplace_rollback.sql
-- ---------------------------------------------------------------------------
-- ROLLBACK documentado da migration 122 (Marketplace). NÃO é auto-aplicado.
-- Reverte a feature na ordem inversa de dependências. Executar manualmente e
-- com cautela — remover o bucket apaga as fotos dos anúncios publicados.
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. RPCs
DROP FUNCTION IF EXISTS marketplace_remove_post(uuid);
DROP FUNCTION IF EXISTS marketplace_get_post(uuid);
DROP FUNCTION IF EXISTS marketplace_list_posts(int, int);

-- 2. Policies do Storage (objects)
DROP POLICY IF EXISTS marketplace_photos_delete ON storage.objects;
DROP POLICY IF EXISTS marketplace_photos_update ON storage.objects;
DROP POLICY IF EXISTS marketplace_photos_insert ON storage.objects;
DROP POLICY IF EXISTS marketplace_photos_select ON storage.objects;

-- 3. RLS da tabela
DROP POLICY IF EXISTS marketplace_posts_delete_owner ON marketplace_posts;
DROP POLICY IF EXISTS marketplace_posts_update_owner ON marketplace_posts;
DROP POLICY IF EXISTS marketplace_posts_insert ON marketplace_posts;
DROP POLICY IF EXISTS marketplace_posts_select ON marketplace_posts;

-- 4. Trigger + função
DROP TRIGGER IF EXISTS marketplace_posts_set_updated_at ON marketplace_posts;
DROP FUNCTION IF EXISTS trg_marketplace_posts_updated_at();

-- 5. Tabela (índices caem junto)
DROP TABLE IF EXISTS marketplace_posts;

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Bucket de fotos (DESTRUTIVO — descomente para apagar os arquivos também).
--    O DELETE do bucket falha enquanto houver objetos; limpe os objetos antes.
-- ---------------------------------------------------------------------------
/*
DELETE FROM storage.objects WHERE bucket_id = 'marketplace_photos';
DELETE FROM storage.buckets WHERE id = 'marketplace_photos';
*/
