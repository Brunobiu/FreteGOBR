-- ============================================================================
-- Migration 011: Corrigir documents.file_url legado
-- ============================================================================
-- Idempotente. Resolve o erro:
--   "null value in column 'file_url' of relation 'documents' violates not-null"
--
-- Causa: a Migration 001 criou `documents` com `file_url TEXT NOT NULL`.
-- O código atual usa `file_path` (Migration 009 garante a coluna). A
-- coluna antiga `file_url` ainda existe em alguns ambientes com
-- restrição NOT NULL.
--
-- Correção: tornar `file_url` nullable e copiar valores entre as colunas
-- quando uma estiver presente e a outra vazia (best-effort).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  -- 1. Se a coluna file_url ainda existe, retira o NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'documents'
       AND column_name  = 'file_url'
  ) THEN
    -- Sincroniza file_url com file_path quando file_url está vazia
    UPDATE documents
       SET file_url = file_path
     WHERE file_url IS NULL
       AND file_path IS NOT NULL;

    -- Sincroniza file_path com file_url no caminho inverso
    UPDATE documents
       SET file_path = file_url
     WHERE file_path IS NULL
       AND file_url IS NOT NULL;

    -- Remove o NOT NULL para permitir inserts que usam só file_path
    ALTER TABLE documents
      ALTER COLUMN file_url DROP NOT NULL;
  END IF;
END $$;

COMMIT;
