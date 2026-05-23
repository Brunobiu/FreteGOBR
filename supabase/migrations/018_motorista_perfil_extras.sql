-- ============================================================================
-- Migration 018: Motorista Perfil Extras
-- ============================================================================
-- Idempotente. Apenas ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS e expansão do CHECK em documents.document_type.
-- NÃO altera embarcadores, fretes ou users.
--
-- Implementa a spec `.kiro/specs/motorista-perfil-extras/`:
--   * Endereço completo + RG na seção Dados Pessoais
--   * CNPJ + nome da empresa proprietária + PIS proprietário
--   * Tabela motorista_references (lista dinâmica)
--   * Adição do tipo de documento `contrato_arrendamento`
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. NOVAS COLUNAS EM motoristas (Req 10.1)
-- ============================================================================

ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_cep           TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_street        TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_number        TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_complement    TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_neighborhood  TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_city          TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS address_uf            TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS rg_number             TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS owner_cnpj            TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS owner_company_name    TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS owner_pis_number      TEXT;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS owner_is_driver       BOOLEAN DEFAULT FALSE;

-- Range check: UF com 2 letras maiúsculas quando preenchido (Req 2.3)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema    = 'public'
       AND table_name      = 'motoristas'
       AND constraint_name = 'motoristas_address_uf_check'
  ) THEN
    ALTER TABLE motoristas
      ADD CONSTRAINT motoristas_address_uf_check
      CHECK (address_uf IS NULL OR address_uf ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- ============================================================================
-- 2. TABELA motorista_references (Req 10.2, 10.3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS motorista_references (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  phone        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motorista_references_user_id
  ON motorista_references(user_id);

-- ============================================================================
-- 3. RLS DE motorista_references (Req 10.5)
-- ============================================================================

ALTER TABLE motorista_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motorista_references_select_own ON motorista_references;
CREATE POLICY motorista_references_select_own
  ON motorista_references FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS motorista_references_insert_own ON motorista_references;
CREATE POLICY motorista_references_insert_own
  ON motorista_references FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS motorista_references_delete_own ON motorista_references;
CREATE POLICY motorista_references_delete_own
  ON motorista_references FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- 4. EXPANDIR CHECK DE documents.document_type (Req 7.9, 10.4)
-- ============================================================================
-- Recriação como SUPERCONJUNTO: 20 tipos atuais (incluindo
-- documento_proprietario da Migration 017) + contrato_arrendamento.
-- Nenhum tipo existente é removido.

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_document_type_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_document_type_check
  CHECK (document_type IN (
    'cpf', 'cnh', 'antt',
    'vehicle_registration', 'vehicle_insurance', 'profile_photo',
    'crlv_cavalo', 'crlv_carreta_1', 'crlv_carreta_2',
    'crlv_carreta_3', 'crlv_carreta_4',
    'rntrc_cavalo', 'rntrc_carreta_1', 'rntrc_carreta_2',
    'foto_segurando_cnh', 'foto_frente_caminhao',
    'comprovante_endereco_proprietario',
    'comprovante_endereco_motorista',
    'foto_caminhao_completo',
    'documento_proprietario',
    'contrato_arrendamento'
  ));

COMMIT;
