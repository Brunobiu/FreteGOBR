-- =====================================================
-- Migration 069: RPC admin_review_document (aprovar/recusar documento)
--
-- Gated por USER_EDIT. Atualiza documents.status ('aprovado'|'rejeitado'),
-- registra reviewer/reviewed_at e grava audit log. SECURITY DEFINER.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION admin_review_document(
  p_document_id uuid,
  p_approve     boolean,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_doc    record;
  v_new    text;
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
         reviewed_by = v_caller,
         reviewed_at = now(),
         updated_at = now()
   WHERE id = p_document_id;

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

REVOKE ALL ON FUNCTION admin_review_document(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_review_document(uuid, boolean, text) TO authenticated;

COMMIT;
