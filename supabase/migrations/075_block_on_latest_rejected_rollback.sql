-- =====================================================
-- ROLLBACK da Migration 075 — documentação, não auto-aplicada.
-- Restaura admin_review_document e documents_clear_block_on_reupload à
-- versão da migration 071 (contagem por histórico de recusados) e remove
-- has_rejected_current_document.
--
-- ATENÇÃO: com documentos recusados mantidos como histórico, a lógica da 071
-- volta a prender o motorista bloqueado. Use apenas se reverter também a
-- política de manter recusados.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION admin_review_document(
  p_document_id uuid,
  p_approve     boolean,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_doc    record;
  v_new    text;
  v_remaining int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('USER_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'USER_VIEW_DENIED', 'documents', p_document_id, NULL,
            jsonb_build_object('reason', 'permission_denied', 'rpc', 'review_document'));
    RAISE EXCEPTION 'permission_denied: USER_EDIT required' USING ERRCODE = '42501';
  END IF;

  SELECT id, user_id, document_type, status INTO v_doc
    FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_new := CASE WHEN p_approve THEN 'aprovado' ELSE 'rejeitado' END;

  UPDATE documents
     SET status = v_new,
         rejection_reason = CASE WHEN p_approve THEN NULL ELSE p_reason END,
         reviewed_by = v_caller, reviewed_at = now(), updated_at = now()
   WHERE id = p_document_id;

  IF p_approve THEN
    SELECT count(*) INTO v_remaining FROM documents
      WHERE user_id = v_doc.user_id AND status = 'rejeitado';
    IF v_remaining = 0 THEN
      UPDATE users SET documents_blocked = false WHERE id = v_doc.user_id;
    END IF;
  ELSE
    UPDATE users SET documents_blocked = true WHERE id = v_doc.user_id;
  END IF;

  INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
  VALUES (v_caller,
          CASE WHEN p_approve THEN 'DOCUMENT_APPROVED' ELSE 'DOCUMENT_REJECTED' END,
          'documents', p_document_id,
          jsonb_build_object('status', v_doc.status),
          jsonb_build_object('status', v_new, 'user_id', v_doc.user_id,
                             'document_type', v_doc.document_type, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'status', v_new);
END;
$func$;

CREATE OR REPLACE FUNCTION documents_clear_block_on_reupload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining FROM documents
    WHERE user_id = NEW.user_id AND status = 'rejeitado' AND id <> NEW.id;
  IF v_remaining = 0 THEN
    UPDATE users SET documents_blocked = false WHERE id = NEW.user_id AND documents_blocked = true;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS documents_clear_block_on_reupload ON public.documents;
CREATE TRIGGER documents_clear_block_on_reupload
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION documents_clear_block_on_reupload();

DROP FUNCTION IF EXISTS public.has_rejected_current_document(uuid);

COMMIT;
