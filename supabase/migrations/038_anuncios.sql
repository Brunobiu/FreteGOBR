-- ============================================================================
-- Migration 038: Anuncios (carrossel de banners no painel do motorista/embarcador)
-- ============================================================================
-- Sistema simples de banners:
--   - Tabela anuncios: id, name (interno), image_path, link_url, is_active, sort_order
--   - Bucket publico anuncios_images
--   - SELECT publico (qualquer usuario autenticado ou anon ve os anuncios ativos)
--   - INSERT/UPDATE/DELETE so admin (via is_admin())
-- ============================================================================

BEGIN;

-- 1. Tabela anuncios
CREATE TABLE IF NOT EXISTS anuncios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  image_path    text NOT NULL CHECK (char_length(image_path) <= 500),
  link_url      text NULL CHECK (link_url IS NULL OR char_length(link_url) <= 500),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  created_by    uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anuncios_active_order
  ON anuncios (is_active, sort_order ASC, created_at DESC);

ALTER TABLE anuncios ENABLE ROW LEVEL SECURITY;

-- SELECT publico (qualquer usuario logado ve os ativos)
DROP POLICY IF EXISTS anuncios_select_active ON anuncios;
CREATE POLICY anuncios_select_active
  ON anuncios FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

-- SELECT admin (admin ve tudo, ativo ou nao)
DROP POLICY IF EXISTS anuncios_select_admin ON anuncios;
CREATE POLICY anuncios_select_admin
  ON anuncios FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('USER_VIEW') OR is_admin_with_permission('FINANCEIRO_VIEW'));

-- INSERT/UPDATE/DELETE: so admin com FINANCEIRO_EDIT (reaproveita perm existente)
DROP POLICY IF EXISTS anuncios_insert_admin ON anuncios;
CREATE POLICY anuncios_insert_admin
  ON anuncios FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_with_permission('FINANCEIRO_EDIT'));

DROP POLICY IF EXISTS anuncios_update_admin ON anuncios;
CREATE POLICY anuncios_update_admin
  ON anuncios FOR UPDATE
  TO authenticated
  USING (is_admin_with_permission('FINANCEIRO_EDIT'))
  WITH CHECK (is_admin_with_permission('FINANCEIRO_EDIT'));

DROP POLICY IF EXISTS anuncios_delete_admin ON anuncios;
CREATE POLICY anuncios_delete_admin
  ON anuncios FOR DELETE
  TO authenticated
  USING (is_admin_with_permission('FINANCEIRO_EDIT'));

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION trg_anuncios_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS anuncios_set_updated_at ON anuncios;
CREATE TRIGGER anuncios_set_updated_at
  BEFORE UPDATE ON anuncios
  FOR EACH ROW
  EXECUTE FUNCTION trg_anuncios_updated_at();

COMMENT ON TABLE anuncios IS 'Anuncios/banners exibidos no carrossel do motorista e embarcador. Gerenciados pelo admin.';

-- 2. Bucket publico anuncios_images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'anuncios_images',
  'anuncios_images',
  true,
  5242880, -- 5 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies do bucket: SELECT publico (anon + auth), INSERT/UPDATE/DELETE so admin
DROP POLICY IF EXISTS anuncios_images_select ON storage.objects;
CREATE POLICY anuncios_images_select
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'anuncios_images');

DROP POLICY IF EXISTS anuncios_images_insert ON storage.objects;
CREATE POLICY anuncios_images_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'anuncios_images'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );

DROP POLICY IF EXISTS anuncios_images_update ON storage.objects;
CREATE POLICY anuncios_images_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'anuncios_images'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  )
  WITH CHECK (
    bucket_id = 'anuncios_images'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );

DROP POLICY IF EXISTS anuncios_images_delete ON storage.objects;
CREATE POLICY anuncios_images_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'anuncios_images'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );

COMMIT;

/*
-- VERIFY
SELECT to_regclass('public.anuncios');
SELECT id FROM storage.buckets WHERE id='anuncios_images';
SELECT policyname FROM pg_policies WHERE tablename='anuncios';
SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'anuncios_%';
*/
