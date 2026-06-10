-- =====================================================
-- Migration 075: bloqueio baseado na ÚLTIMA versão recusada (não no histórico)
--
-- Problema: a 071 contava QUALQUER linha 'rejeitado' para decidir o bloqueio
-- (documents_blocked) e para liberar no reenvio/aprovação. Como agora os
-- documentos recusados são mantidos como histórico/evidência permanente, o
-- contador nunca zerava e o motorista ficava bloqueado para sempre, mesmo
-- após reenviar ou após o admin aprovar a nova versão.
--
-- Correção: a fonte de verdade passa a ser a ÚLTIMA versão (mais recente por
-- created_at) de cada document_type. O motorista está bloqueado se, e somente
-- se, a versão vigente de algum tipo está 'rejeitado'.
--
--   1) has_rejected_current_document(uuid) — predicado canônico.
--   2) admin_review_document — recusar bloqueia; ao aprovar/recusar recalcula
--      pelo predicado (a versão vigente).
--   3) documents_clear_block_on_reupload — recalcula pelo predicado.
-- =====================================================

BEGIN;

-- 1) Predicado: existe algum tipo cuja versão VIGENTE está recusada? --------
CREATE OR REPLACE FUNCTION public.has_rejected_current_document(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_found boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT DISTINCT ON (document_type) document_type, status
          FROM documents
         WHERE user_id = p_user_id
           AND document_type <> 'profile_photo'
         ORDER BY document_type, created_at DESC
      ) latest
     WHERE latest.status = 'rejeitado'
  ) INTO v_found;
  RETURN COALESCE(v_found, false);
END;
$func$;
REVOKE ALL ON FUNCTION public.has_rejected_current_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_rejected_current_document(uuid) TO authenticated;

-- 2) admin_review_document recalcula o bloqueio pela versão vigente ---------
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
  v_blocked boolean;
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

  -- Recalcula o bloqueio pela versão VIGENTE de cada tipo (não pelo histórico).
  v_blocked := has_rejected_current_document(v_doc.user_id);
  UPDATE users SET documents_blocked = v_blocked WHERE id = v_doc.user_id;

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

-- 3) Reenvio recalcula o bloqueio pela versão vigente -----------------------
CREATE OR REPLACE FUNCTION documents_clear_block_on_reupload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_blocked boolean;
BEGIN
  -- Após o INSERT (nova versão vigente), recalcula: se nenhum tipo tem versão
  -- vigente recusada, libera; senão mantém bloqueado.
  v_blocked := has_rejected_current_document(NEW.user_id);
  UPDATE users SET documents_blocked = v_blocked
   WHERE id = NEW.user_id AND documents_blocked <> v_blocked;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS documents_clear_block_on_reupload ON public.documents;
CREATE TRIGGER documents_clear_block_on_reupload
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION documents_clear_block_on_reupload();

-- Reconciliação imediata de todos os motoristas (corrige bloqueios presos).
UPDATE users u
   SET documents_blocked = has_rejected_current_document(u.id)
 WHERE u.user_type = 'motorista'
   AND u.documents_blocked <> has_rejected_current_document(u.id);

COMMIT;

-- VERIFY
/*
SELECT id, documents_blocked, has_rejected_current_document(id)
  FROM users WHERE user_type='motorista';
*/
