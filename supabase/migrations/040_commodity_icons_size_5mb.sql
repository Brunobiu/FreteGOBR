-- ============================================================================
-- Migration 040: Aumenta limite do bucket commodity_icons de 1 MB para 5 MB
-- ============================================================================
-- Apos feedback do uso real, 1 MB era restritivo demais para fotos de
-- celular. Sobe para 5 MB (mesmo limite de anuncios_images).
-- ============================================================================

BEGIN;

UPDATE storage.buckets
   SET file_size_limit = 5242880  -- 5 MiB
 WHERE id = 'commodity_icons';

COMMIT;

/*
-- VERIFY:
SELECT id, file_size_limit FROM storage.buckets WHERE id='commodity_icons';
*/
