-- ============================================================================
-- Migration 034: RPC para admin enviar notificação a usuário comum
-- ============================================================================
-- Idempotente. Adiciona admin_notify_user(p_user_id, p_type, p_title, p_message, p_link)
-- usada pelo painel admin para informar embarcadores quando seus fretes são
-- editados, cancelados ou excluídos pela equipe interna.

BEGIN;

CREATE OR REPLACE FUNCTION admin_notify_user(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_message text,
  p_link    text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'admin_notify_user requires authenticated session';
  END IF;
  -- Reaproveita gating já existente na admin-foundation: qualquer admin
  -- com USER_VIEW pode notificar (operações destrutivas exigem permissões
  -- específicas que já foram validadas no service TS).
  IF NOT is_admin_with_permission('USER_VIEW') THEN
    RAISE EXCEPTION 'permission_denied: USER_VIEW required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, p_type, p_title, p_message, p_link)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$func$;

REVOKE ALL ON FUNCTION admin_notify_user(uuid, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION admin_notify_user(uuid, text, text, text, text) TO authenticated;

COMMIT;

-- VERIFY
-- SELECT proname FROM pg_proc WHERE proname = 'admin_notify_user';
