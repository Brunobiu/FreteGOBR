-- 122_marketplace.sql
-- ---------------------------------------------------------------------------
-- Marketplace — vitrine de anúncios entre usuários (motorista + embarcador).
--
-- Conteúdo gerado por usuário: cada usuário autenticado publica um anúncio
-- (`venda` ou `noticia`) com título, descrição, de 1 a 10 fotos e a sua
-- localização (obrigatória). A autorização de ESCRITA é por RLS de DONO
-- (`author_id = auth.uid()`), NÃO por `is_admin_with_permission` — isso é
-- conteúdo de usuário, não mutação admin. A moderação (remover anúncio de
-- terceiro) é o ÚNICO caminho admin e passa pela RPC `marketplace_remove_post`
-- (gated + audit via executeAdminMutation no serviço).
--
-- Cria: tabela `marketplace_posts`, índices, trigger de updated_at, RLS
-- owner-scoped, bucket público `marketplace_photos` (escrita só no prefixo do
-- dono) e RPCs de leitura (`marketplace_list_posts`/`marketplace_get_post`,
-- SECURITY DEFINER STABLE, com join do autor) + `marketplace_remove_post`.
--
-- Idempotente; par documentado em 122_marketplace_rollback.sql (não auto-aplicado).
-- ---------------------------------------------------------------------------

BEGIN;

-- ========== 0. Validações defensivas ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'users') THEN
    RAISE EXCEPTION 'Tabela users ausente: aplicar 001_initial_schema antes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'admin_audit_logs') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'Extensao postgis ausente: o tipo geography(POINT) e necessario';
  END IF;
END
$check$;

-- ========== 1. Tabela marketplace_posts ==========
CREATE TABLE IF NOT EXISTS marketplace_posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_type      text NOT NULL DEFAULT 'venda' CHECK (post_type IN ('venda', 'noticia')),
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description    text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  price          numeric(12, 2) NULL CHECK (price IS NULL OR price > 0),
  photo_paths    text[] NOT NULL CHECK (
                   array_length(photo_paths, 1) BETWEEN 1 AND 10
                   AND array_position(photo_paths, NULL::text) IS NULL
                 ),
  location       geography(POINT) NOT NULL,
  location_label text NOT NULL DEFAULT '' CHECK (char_length(location_label) <= 160),
  status         text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'removido')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Coerência: 'noticia' nunca tem valor; 'venda' pode ter ou não.
  CONSTRAINT marketplace_posts_price_coherence CHECK (post_type = 'venda' OR price IS NULL)
);

COMMENT ON TABLE marketplace_posts IS
  'Anuncios do Marketplace publicados por usuarios (venda/noticia). Escrita por RLS de dono (author_id=auth.uid()).';

-- Feed: anúncios ativos por data desc.
CREATE INDEX IF NOT EXISTS idx_marketplace_posts_feed
  ON marketplace_posts (created_at DESC) WHERE status = 'ativo';
-- "Meus anúncios" / moderação por autor.
CREATE INDEX IF NOT EXISTS idx_marketplace_posts_author
  ON marketplace_posts (author_id, created_at DESC);
-- Busca por proximidade (escopo futuro): índice geoespacial dos ativos.
CREATE INDEX IF NOT EXISTS idx_marketplace_posts_location
  ON marketplace_posts USING gist (location) WHERE status = 'ativo';

-- ========== 2. Trigger de updated_at ==========
CREATE OR REPLACE FUNCTION trg_marketplace_posts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS marketplace_posts_set_updated_at ON marketplace_posts;
CREATE TRIGGER marketplace_posts_set_updated_at
  BEFORE UPDATE ON marketplace_posts
  FOR EACH ROW EXECUTE FUNCTION trg_marketplace_posts_updated_at();

-- ========== 3. RLS owner-scoped ==========
ALTER TABLE marketplace_posts ENABLE ROW LEVEL SECURITY;

-- SELECT: só autenticados. Ativos para todos; o dono vê os próprios (inclusive
-- removidos); admin vê tudo (moderação). NÃO exposto a anon.
DROP POLICY IF EXISTS marketplace_posts_select ON marketplace_posts;
CREATE POLICY marketplace_posts_select ON marketplace_posts
  FOR SELECT TO authenticated
  USING (
    status = 'ativo'
    OR author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.user_type = 'admin')
  );

-- INSERT: o usuário só publica como ele mesmo, sempre 'ativo'.
DROP POLICY IF EXISTS marketplace_posts_insert ON marketplace_posts;
CREATE POLICY marketplace_posts_insert ON marketplace_posts
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND status = 'ativo');

-- UPDATE: o dono altera o próprio (ex.: soft-delete status='removido').
DROP POLICY IF EXISTS marketplace_posts_update_owner ON marketplace_posts;
CREATE POLICY marketplace_posts_update_owner ON marketplace_posts
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- DELETE físico: só o dono (a UI usa soft-delete; mantido por simetria).
DROP POLICY IF EXISTS marketplace_posts_delete_owner ON marketplace_posts;
CREATE POLICY marketplace_posts_delete_owner ON marketplace_posts
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- ========== 4. Bucket marketplace_photos (público, escrita só no prefixo do dono) ==========
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketplace_photos',
  'marketplace_photos',
  true,
  5242880, -- 5 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura: pública (bucket público; serve getPublicUrl no feed e no detalhe).
DROP POLICY IF EXISTS marketplace_photos_select ON storage.objects;
CREATE POLICY marketplace_photos_select ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'marketplace_photos');

-- INSERT/UPDATE/DELETE: só no próprio prefixo `<auth.uid()>/...`.
DROP POLICY IF EXISTS marketplace_photos_insert ON storage.objects;
CREATE POLICY marketplace_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'marketplace_photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS marketplace_photos_update ON storage.objects;
CREATE POLICY marketplace_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'marketplace_photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'marketplace_photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS marketplace_photos_delete ON storage.objects;
CREATE POLICY marketplace_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'marketplace_photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ========== 5. RPCs de leitura (join do autor) ==========
-- Feed paginado: anúncios ativos + nome/foto do autor. Não expõe a tabela users.
CREATE OR REPLACE FUNCTION marketplace_list_posts(p_limit int DEFAULT 20, p_offset int DEFAULT 0)
RETURNS TABLE (
  id                uuid,
  author_id         uuid,
  author_name       text,
  author_photo_path text,
  post_type         text,
  title             text,
  description       text,
  price             numeric,
  photo_paths       text[],
  lat               double precision,
  lng               double precision,
  location_label    text,
  created_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    mp.id, mp.author_id, u.name, u.profile_photo_url,
    mp.post_type, mp.title, mp.description, mp.price, mp.photo_paths,
    ST_Y(mp.location::geometry), ST_X(mp.location::geometry),
    mp.location_label, mp.created_at
  FROM marketplace_posts mp
  JOIN users u ON u.id = mp.author_id
  WHERE mp.status = 'ativo'
  ORDER BY mp.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
$fn$;

-- Detalhe: um anúncio ativo (ou do próprio autor) + autor.
CREATE OR REPLACE FUNCTION marketplace_get_post(p_id uuid)
RETURNS TABLE (
  id                uuid,
  author_id         uuid,
  author_name       text,
  author_photo_path text,
  post_type         text,
  title             text,
  description       text,
  price             numeric,
  photo_paths       text[],
  lat               double precision,
  lng               double precision,
  location_label    text,
  created_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    mp.id, mp.author_id, u.name, u.profile_photo_url,
    mp.post_type, mp.title, mp.description, mp.price, mp.photo_paths,
    ST_Y(mp.location::geometry), ST_X(mp.location::geometry),
    mp.location_label, mp.created_at
  FROM marketplace_posts mp
  JOIN users u ON u.id = mp.author_id
  WHERE mp.id = p_id
    AND (mp.status = 'ativo' OR mp.author_id = auth.uid());
$fn$;

-- ========== 6. RPC de moderação admin (gated + audit negativo) ==========
-- Oculta (soft-delete) um anúncio de qualquer autor. O audit POSITIVO
-- (MARKETPLACE_POST_REMOVED) é gravado pelo serviço via executeAdminMutation;
-- aqui gravamos apenas o NEGATIVO (MARKETPLACE_VIEW_DENIED) na falta de permissão.
CREATE OR REPLACE FUNCTION marketplace_remove_post(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('USER_EDIT') THEN
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'MARKETPLACE_VIEW_DENIED', 'marketplace_posts', p_id::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: USER_EDIT required' USING ERRCODE = '42501';
  END IF;

  UPDATE marketplace_posts
     SET status = 'removido'
   WHERE id = p_id AND status = 'ativo';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'removed', v_rows);
END;
$fn$;

-- ========== 7. Security posture: REVOKE/GRANT ==========
REVOKE ALL ON FUNCTION marketplace_list_posts(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_get_post(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_remove_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_list_posts(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION marketplace_get_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION marketplace_remove_post(uuid) TO authenticated;

COMMIT;

/*
-- VERIFY (smoke manual)
SELECT to_regclass('public.marketplace_posts');
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'marketplace_photos';
SELECT policyname FROM pg_policies WHERE tablename = 'marketplace_posts' ORDER BY policyname;
SELECT policyname FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'marketplace_photos_%';
SELECT proname, prosecdef FROM pg_proc
  WHERE proname IN ('marketplace_list_posts', 'marketplace_get_post', 'marketplace_remove_post');
SELECT indexname FROM pg_indexes WHERE tablename = 'marketplace_posts';
*/
