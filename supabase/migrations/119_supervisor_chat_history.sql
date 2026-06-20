-- ============================================================================
-- Migration 119: Supervisor_Chat_History — histórico de conversas do chat da
--                IA Supervisora (sessões + mensagens, lista lateral)
-- ============================================================================
-- Spec: .kiro/specs/supervisor-chat-history/{requirements,design,tasks}.md
--
-- COMPLEMENTA admin-ia-supervisora (118). Persiste as conversas do Painel
-- Inteligente para listar/reabrir na lateral. A persistência é DIRIGIDA PELO
-- FRONTEND (a página chama supervisor_chat_message_append após a pergunta do
-- usuário e após a resposta da IA) — a edge function `ia-supervisor` NÃO muda.
--
-- ENTREGA:
--   - supervisor_chat_sessions (conversa: dono + título + timestamps).
--   - supervisor_chat_messages (mensagem: sessão + role user/ai + content).
--   - RLS admin-only POR DONO (SELECT sob SUPERVISOR_VIEW + admin_id=auth.uid()).
--   - 6 RPCs SECURITY DEFINER (create/list sessions, list/append messages,
--     rename/delete). Reusa SUPERVISOR_VIEW (sem nova ação RBAC).
--
-- IDEMPOTENTE (admin-patterns §9). Par documentado: 119_..._rollback.sql.
-- Idioma: identifiers/action codes em inglês (UPPER_SNAKE); UI em pt-BR. content
--   chega PRE-sanitizado da camada de service (sem PII/segredos).
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Validações defensivas — dependências DURAS (030, 118)
-- ────────────────────────────────────────────────────────────────────────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                  WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='admin_audit_logs') THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='supervisor_insights') THEN
    RAISE EXCEPTION 'Migration 118 (admin-ia-supervisora) nao aplicada: supervisor_insights ausente';
  END IF;
END
$check$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Trigger de updated_at (reusa a função local da 118; idempotente)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $touch$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$touch$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Tabela supervisor_chat_sessions (Req 1)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervisor_chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Nova conversa' CHECK (char_length(title) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_chat_sessions_owner
  ON supervisor_chat_sessions (admin_id, updated_at DESC);

COMMENT ON TABLE supervisor_chat_sessions IS
  'Conversas do chat da IA Supervisora (supervisor-chat-history / 119). Uma linha por conversa, do dono (admin_id). SELECT admin-only POR DONO; escrita so via RPC. Sem PII no titulo.';

DROP TRIGGER IF EXISTS trg_supervisor_chat_sessions_touch ON supervisor_chat_sessions;
CREATE TRIGGER trg_supervisor_chat_sessions_touch
  BEFORE UPDATE ON supervisor_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION supervisor_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Tabela supervisor_chat_messages (Req 2)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supervisor_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES supervisor_chat_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user','ai')),
  content     text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_chat_messages_session
  ON supervisor_chat_messages (session_id, created_at ASC);

COMMENT ON TABLE supervisor_chat_messages IS
  'Mensagens do chat da IA Supervisora (119): role user/ai. SELECT admin-only POR DONO (via sessao); escrita so via RPC. content chega PRE-sanitizado (sem PII).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS (Req 4) — admin-only POR DONO, escrita só por RPC
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE supervisor_chat_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supervisor_chat_sessions_select_owner ON supervisor_chat_sessions;
CREATE POLICY supervisor_chat_sessions_select_owner ON supervisor_chat_sessions
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('SUPERVISOR_VIEW') AND admin_id = auth.uid());
DROP POLICY IF EXISTS supervisor_chat_sessions_no_dml ON supervisor_chat_sessions;
CREATE POLICY supervisor_chat_sessions_no_dml ON supervisor_chat_sessions
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE supervisor_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supervisor_chat_messages_select_owner ON supervisor_chat_messages;
CREATE POLICY supervisor_chat_messages_select_owner ON supervisor_chat_messages
  FOR SELECT TO authenticated
  USING (
    is_admin_with_permission('SUPERVISOR_VIEW')
    AND EXISTS (
      SELECT 1 FROM supervisor_chat_sessions s
      WHERE s.id = supervisor_chat_messages.session_id AND s.admin_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS supervisor_chat_messages_no_dml ON supervisor_chat_messages;
CREATE POLICY supervisor_chat_messages_no_dml ON supervisor_chat_messages
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC supervisor_chat_session_create (Req 1) — SUPERVISOR_VIEW
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_chat_session_create(p_title text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_title  text := left(COALESCE(NULLIF(btrim(p_title), ''), 'Nova conversa'), 120);
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_chat_sessions', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO supervisor_chat_sessions(admin_id, title) VALUES (v_caller, v_title)
  RETURNING id INTO v_id;

  INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
  VALUES (v_caller, 'SUPERVISOR_CHAT_SESSION_CREATED', 'supervisor_chat_sessions', v_id::text, NULL,
          jsonb_build_object('title', v_title));

  RETURN jsonb_build_object('id', v_id, 'title', v_title);
END;
$func$;
REVOKE ALL ON FUNCTION supervisor_chat_session_create(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_session_create(text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC supervisor_chat_sessions_list (Req 1) — SUPERVISOR_VIEW, só do dono
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_chat_sessions_list(p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_items  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_chat_sessions', NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT id, admin_id, title, created_at, updated_at
    FROM supervisor_chat_sessions
    WHERE admin_id = v_caller
    ORDER BY updated_at DESC, id ASC
    LIMIT v_limit OFFSET v_offset
  ) s;

  RETURN jsonb_build_object('items', v_items);
END;
$func$;
REVOKE ALL ON FUNCTION supervisor_chat_sessions_list(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_sessions_list(int, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPC supervisor_chat_messages_list (Req 2) — SUPERVISOR_VIEW, valida posse
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_chat_messages_list(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_items  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUPERVISOR_VIEW_DENIED', 'supervisor_chat_messages', p_session::text, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied'));
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT admin_id INTO v_owner FROM supervisor_chat_sessions WHERE id = p_session;
  -- Sessão inexistente ou de outro dono ⇒ lista vazia (não vaza existência).
  IF v_owner IS NULL OR v_owner <> v_caller THEN
    RETURN jsonb_build_object('items', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at ASC, m.id ASC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT id, session_id, role, content, created_at
    FROM supervisor_chat_messages
    WHERE session_id = p_session
  ) m;

  RETURN jsonb_build_object('items', v_items);
END;
$func$;
REVOKE ALL ON FUNCTION supervisor_chat_messages_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_messages_list(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. RPC supervisor_chat_message_append (Req 2) — SUPERVISOR_VIEW, valida posse
-- ────────────────────────────────────────────────────────────────────────────
-- content chega PRE-sanitizado da camada de service (sem PII/segredos).
CREATE OR REPLACE FUNCTION supervisor_chat_message_append(p_session uuid, p_role text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT admin_id INTO v_owner FROM supervisor_chat_sessions WHERE id = p_session;
  IF v_owner IS NULL OR v_owner <> v_caller THEN
    RAISE EXCEPTION 'permission_denied: not your session' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('user','ai') THEN
    RAISE EXCEPTION 'INVALID_INPUT: role' USING ERRCODE = 'P0001';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' OR char_length(p_content) > 8000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: content' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO supervisor_chat_messages(session_id, role, content)
  VALUES (p_session, p_role, p_content)
  RETURNING id INTO v_id;

  -- Toca a sessão (sobe na lista lateral).
  UPDATE supervisor_chat_sessions SET updated_at = now() WHERE id = p_session;

  RETURN jsonb_build_object('id', v_id);
END;
$func$;
REVOKE ALL ON FUNCTION supervisor_chat_message_append(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_message_append(uuid, text, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. RPC supervisor_chat_session_rename (Req 3) — SUPERVISOR_VIEW, só do dono
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_chat_session_rename(p_session uuid, p_title text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_title  text := left(COALESCE(NULLIF(btrim(p_title), ''), ''), 120);
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: title' USING ERRCODE = 'P0001';
  END IF;

  UPDATE supervisor_chat_sessions SET title = v_title
  WHERE id = p_session AND admin_id = v_caller;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NOT_FOUND_OR_NOT_OWNER');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$func$;
REVOKE ALL ON FUNCTION supervisor_chat_session_rename(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_session_rename(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. RPC supervisor_chat_session_delete (Req 3) — SUPERVISOR_VIEW, idempotente
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supervisor_chat_session_delete(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('SUPERVISOR_VIEW') THEN
    RAISE EXCEPTION 'permission_denied: SUPERVISOR_VIEW required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM supervisor_chat_sessions WHERE id = p_session AND admin_id = v_caller;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_GONE');
  END IF;

  INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
  VALUES (v_caller, 'SUPERVISOR_CHAT_SESSION_DELETED', 'supervisor_chat_sessions', p_session::text, NULL, NULL);

  RETURN jsonb_build_object('ok', true);
END;
$func$;
REVOKE ALL ON FUNCTION supervisor_chat_session_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_chat_session_delete(uuid) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFY (smoke manual — comentado; nao executa no apply)
-- ============================================================================
/*
SELECT to_regclass('public.supervisor_chat_sessions'), to_regclass('public.supervisor_chat_messages');
SELECT proname FROM pg_proc WHERE proname LIKE 'supervisor_chat_%' ORDER BY proname;
SELECT polname, polcmd FROM pg_policy
 WHERE polrelid IN ('public.supervisor_chat_sessions'::regclass, 'public.supervisor_chat_messages'::regclass);
*/
