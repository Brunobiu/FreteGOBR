-- ============================================================================
-- Setup do bucket `company-logos` para logos de empresas dos embarcadores.
-- ============================================================================
-- Idempotente: pode ser aplicado múltiplas vezes sem erro.
-- Pré-requisito: projeto Supabase com Storage habilitado.
--
-- Estratégia de segurança:
--   * Bucket público (logo é informação institucional pública, exibida em
--     cards de frete para o motorista).
--   * Leitura pública (SELECT) sem restrição.
--   * Escrita (INSERT/UPDATE/DELETE) apenas para o dono, validando que o
--     path começa com `embarcadores/<auth.uid()>/`.
-- ============================================================================

-- 1. Criar bucket público
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Política de leitura pública
DROP POLICY IF EXISTS "company_logos_public_read" ON storage.objects;
CREATE POLICY "company_logos_public_read" ON storage.objects
FOR SELECT
USING (bucket_id = 'company-logos');

-- 3. Política de INSERT — apenas dono no path `embarcadores/<uid>/...`
DROP POLICY IF EXISTS "company_logos_owner_write" ON storage.objects;
CREATE POLICY "company_logos_owner_write" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] = 'embarcadores'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 4. Política de UPDATE
DROP POLICY IF EXISTS "company_logos_owner_update" ON storage.objects;
CREATE POLICY "company_logos_owner_update" ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] = 'embarcadores'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 5. Política de DELETE
DROP POLICY IF EXISTS "company_logos_owner_delete" ON storage.objects;
CREATE POLICY "company_logos_owner_delete" ON storage.objects
FOR DELETE
USING (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] = 'embarcadores'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
