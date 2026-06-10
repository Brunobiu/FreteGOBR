-- =====================================================
-- Migration 067: alarga colunas de documents
--
-- `documents.document_type` era varchar(20), mas o app usa valores longos
-- como 'comprovante_endereco_proprietario' (33), 'comprovante_endereco_motorista'
-- (30) — causando "value too long for type character varying(20)" no upload.
-- =====================================================

BEGIN;

ALTER TABLE public.documents
  ALTER COLUMN document_type TYPE varchar(60),
  ALTER COLUMN status TYPE varchar(20);

-- Remove eventual CHECK antigo de document_type (lista fechada e curta).
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
    FROM pg_constraint
   WHERE conrelid = 'public.documents'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%document_type%';
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

COMMIT;
