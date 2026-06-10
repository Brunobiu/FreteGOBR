-- =====================================================
-- Migration 072: status inicial do documento na inserção (aprovação imediata)
--
-- Modelo "confiança até quebrar": ao enviar um documento, ele vale na hora
-- (status 'aprovado'). O admin só RECUSA o que vier errado. Quando o motorista
-- REENVIA um documento de um tipo que já foi recusado, a nova versão entra
-- como 'pendente' (aguardando a aprovação do admin).
--
-- profile_photo nunca precisa de revisão ⇒ sempre 'aprovado'.
--
-- Implementado como trigger BEFORE INSERT em documents.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.documents_set_initial_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_had_reject boolean;
BEGIN
  -- profile_photo nunca precisa de revisão.
  IF NEW.document_type = 'profile_photo' THEN
    NEW.status := 'aprovado';
    RETURN NEW;
  END IF;

  -- Só decide quando o cliente não forçou um status explícito de revisão.
  IF NEW.status IS NULL OR NEW.status = 'pendente' THEN
    SELECT EXISTS (
      SELECT 1 FROM documents
       WHERE user_id = NEW.user_id
         AND document_type = NEW.document_type
         AND status = 'rejeitado'
    ) INTO v_had_reject;

    IF v_had_reject THEN
      NEW.status := 'pendente';   -- já foi recusado antes: aguarda aprovação
    ELSE
      NEW.status := 'aprovado';   -- primeira vez / sem recusa: imediato
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS documents_set_initial_status ON public.documents;
CREATE TRIGGER documents_set_initial_status
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_set_initial_status();

COMMIT;
