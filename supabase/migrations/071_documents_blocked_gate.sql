-- =====================================================
-- Migration 071: bloqueio por documento recusado (aprovação imediata)
--
-- Modelo: documentos valem assim que enviados. Se o admin RECUSA um documento,
-- o motorista fica "pausado" (não interage com fretes) até reenviar.
--
--   1) Coluna users.documents_blocked (default false).
--   2) motorista_can_interact nega quando documents_blocked = true.
--   3) admin_review_document seta documents_blocked=true ao recusar; ao aprovar
--      (se não restam recusados) libera.
--   4) trigger AFTER INSERT em documents: reenvio limpa o bloqueio do dono.
-- =====================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS documents_blocked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.documents_blocked IS
  'true quando um documento do motorista foi recusado pelo admin; pausa a interacao ate reenvio. (071)';

CREATE OR REPLACE FUNCTION motorista_can_interact(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_user_type text; v_status text; v_subscribed boolean; v_trial_ends timestamptz;
  v_grace_ends timestamptz; v_docs_blocked boolean;
BEGIN
  SELECT u.user_type, u.subscription_status, u.is_subscribed, u.trial_ends_at, u.documents_blocked
    INTO v_user_type, v_status, v_subscribed, v_trial_ends, v_docs_blocked
    FROM users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_user_type <> 'motorista' THEN RETURN true; END IF;
  IF v_docs_blocked THEN RETURN false; END IF;
  IF v_status IN ('canceled','blocked') THEN RETURN false; END IF;
  IF v_status = 'active' OR v_subscribed THEN RETURN true; END IF;
  IF v_status = 'past_due' THEN
    SELECT s.grace_ends_at INTO v_grace_ends FROM subscriptions s WHERE s.user_id = p_user_id;
    RETURN (v_grace_ends IS NULL OR v_grace_ends >= NOW());
  END IF;
  RETURN (v_trial_ends IS NOT NULL AND v_trial_ends > NOW());
END;
$func$;
REVOKE ALL ON FUNCTION motorista_can_interact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION motorista_can_interact(uuid) TO authenticated;

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
         reviewed_by = v_caller,
         reviewed_at = now(),
         updated_at = now()
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
REVOKE ALL ON FUNCTION admin_review_document(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_review_document(uuid, boolean, text) TO authenticated;

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

COMMIT;
