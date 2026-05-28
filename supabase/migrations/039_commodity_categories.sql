-- ============================================================================
-- Migration 039: Categorias de Commodities (carrossel horizontal de tipos
-- de carga: Soja, Milho, Acucar, etc.)
-- ============================================================================
-- Sistema simples de categorias visuais para o motorista navegar tipos de
-- frete:
--   - Tabela commodity_categories: id, name, icon_path, slug, sort_order, is_active
--   - Bucket publico commodity_icons (icones pequenos, max 1 MB)
--   - SELECT publico (qualquer usuario ve as categorias ativas)
--   - INSERT/UPDATE/DELETE so admin com FINANCEIRO_EDIT (mesma permissao
--     usada em anuncios; futuro: criar permissao especifica COMMODITY_EDIT)
--   - Seed inicial com 14 itens da imagem do usuario
-- ============================================================================

BEGIN;

-- Validacao defensiva: 030 (admin-foundation) ja deve estar aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema='public' AND routine_name='is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada';
  END IF;
END
$check$;

-- 1. Tabela commodity_categories
CREATE TABLE IF NOT EXISTS commodity_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  slug        text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 60),
  icon_path   text NOT NULL CHECK (char_length(icon_path) <= 500),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  created_by  uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_commodity_categories_active_order
  ON commodity_categories (is_active, sort_order ASC, name ASC);

ALTER TABLE commodity_categories ENABLE ROW LEVEL SECURITY;

-- SELECT publico (qualquer logado ou anon ve os ativos)
DROP POLICY IF EXISTS commodity_categories_select_active ON commodity_categories;
CREATE POLICY commodity_categories_select_active
  ON commodity_categories FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

-- SELECT admin (ve tudo, ativo ou nao)
DROP POLICY IF EXISTS commodity_categories_select_admin ON commodity_categories;
CREATE POLICY commodity_categories_select_admin
  ON commodity_categories FOR SELECT
  TO authenticated
  USING (is_admin_with_permission('USER_VIEW') OR is_admin_with_permission('FINANCEIRO_VIEW'));

-- INSERT/UPDATE/DELETE: admin com FINANCEIRO_EDIT
DROP POLICY IF EXISTS commodity_categories_insert_admin ON commodity_categories;
CREATE POLICY commodity_categories_insert_admin
  ON commodity_categories FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_with_permission('FINANCEIRO_EDIT'));

DROP POLICY IF EXISTS commodity_categories_update_admin ON commodity_categories;
CREATE POLICY commodity_categories_update_admin
  ON commodity_categories FOR UPDATE
  TO authenticated
  USING (is_admin_with_permission('FINANCEIRO_EDIT'))
  WITH CHECK (is_admin_with_permission('FINANCEIRO_EDIT'));

DROP POLICY IF EXISTS commodity_categories_delete_admin ON commodity_categories;
CREATE POLICY commodity_categories_delete_admin
  ON commodity_categories FOR DELETE
  TO authenticated
  USING (is_admin_with_permission('FINANCEIRO_EDIT'));

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_commodity_categories_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS commodity_categories_set_updated_at ON commodity_categories;
CREATE TRIGGER commodity_categories_set_updated_at
  BEFORE UPDATE ON commodity_categories
  FOR EACH ROW
  EXECUTE FUNCTION trg_commodity_categories_updated_at();

COMMENT ON TABLE commodity_categories IS
  'Categorias de carga/commodity exibidas no carrossel horizontal do motorista.';

-- 2. Bucket publico commodity_icons
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'commodity_icons',
  'commodity_icons',
  true,
  5242880, -- 5 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies bucket: SELECT publico, mutacoes so admin
DROP POLICY IF EXISTS commodity_icons_select ON storage.objects;
CREATE POLICY commodity_icons_select
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'commodity_icons');

DROP POLICY IF EXISTS commodity_icons_insert ON storage.objects;
CREATE POLICY commodity_icons_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'commodity_icons'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );

DROP POLICY IF EXISTS commodity_icons_update ON storage.objects;
CREATE POLICY commodity_icons_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'commodity_icons'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  )
  WITH CHECK (
    bucket_id = 'commodity_icons'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );

DROP POLICY IF EXISTS commodity_icons_delete ON storage.objects;
CREATE POLICY commodity_icons_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'commodity_icons'
    AND is_admin_with_permission('FINANCEIRO_EDIT')
  );

-- 3. Seed inicial: 14 commodities da imagem do usuario.
-- Sao inseridas com icon_path apontando para arquivos placeholder no bucket.
-- Como nao podemos subir o arquivo aqui, usamos icon_path = '' (vazio) e a UI
-- exibe um fallback de inicial enquanto o admin nao trocar a imagem.
-- ON CONFLICT (slug) DO NOTHING para idempotencia.
INSERT INTO commodity_categories (name, slug, icon_path, sort_order, is_active) VALUES
  ('Soja',              'soja',              '', 0,  true),
  ('Acucar',            'acucar',            '', 1,  true),
  ('Milho',             'milho',             '', 2,  true),
  ('Defensivo',         'defensivo',         '', 3,  true),
  ('Trigo',             'trigo',             '', 4,  true),
  ('Fertilizante',      'fertilizante',      '', 5,  true),
  ('Semente',           'semente',           '', 6,  true),
  ('Agrotoxico',        'agrotoxico',        '', 7,  true),
  ('Maquinario',        'maquinario',        '', 8,  true),
  ('Cevada',            'cevada',            '', 9,  true),
  ('Calcario',          'calcario',          '', 10, true),
  ('Farelo de Milho',   'farelo-de-milho',   '', 11, true),
  ('Farelo de Soja',    'farelo-de-soja',    '', 12, true),
  ('Pluma de Algodao',  'pluma-de-algodao',  '', 13, true)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

/*
-- VERIFY (rodar manualmente apos aplicar):
SELECT to_regclass('public.commodity_categories');
SELECT id FROM storage.buckets WHERE id='commodity_icons';
SELECT policyname FROM pg_policies WHERE tablename='commodity_categories';
SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'commodity_icons_%';
SELECT name, slug, sort_order FROM commodity_categories ORDER BY sort_order;
*/
