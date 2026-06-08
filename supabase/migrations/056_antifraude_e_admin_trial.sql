-- =====================================================
-- Migration 056: anti-fraude de cadastro + RPCs admin de trial
--
-- Recupera as partes da migration 044 (trial-e-bloqueio) que NUNCA foram
-- aplicadas neste banco, complementando a 055 (assinaturas-asaas), que já
-- criou as colunas de trial e o trigger users_set_trial_defaults.
--
-- Entrega:
--   1. is_identifier_available(type, value)  — pré-check de disponibilidade
--      (phone|cpf|email), usado pelo src/services/auth.ts no cadastro.
--   2. users_antifraud_duplicate_block()      — trigger BEFORE INSERT em users:
--      AUTORIDADE atômica que aborta cadastro duplicado (phone/cpf/email).
--   3. admin_list_trial_motoristas(...)        — listagem admin (USER_VIEW).
--   4. admin_extend_trial(...)                 — extensão manual (USER_EDIT).
--
-- NOTA: a função antiga is_motorista_trial_blocked NÃO é recriada — foi
-- deliberadamente substituída por motorista_can_interact (migration 055),
-- que cobre o novo modelo "suspenso vê o feed mas não interage".
--
-- Duplicidades PRÉ-EXISTENTES não são afetadas (o trigger só compara o NEW
-- contra OUTRAS contas no momento do INSERT). Idempotente. Par _rollback.sql.
-- =====================================================

BEGIN;

-- ========== 0. Pré-checks defensivos ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'is_admin_with_permission ausente (admin-foundation).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='admin_audit_logs') THEN
    RAISE EXCEPTION 'admin_audit_logs ausente (admin-foundation).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='users' AND column_name='trial_ends_at') THEN
    RAISE EXCEPTION 'users.trial_ends_at ausente -- aplique a migration 055 antes.';
  END IF;
END
$check$;

-- ========== 1. is_identifier_available (pré-check de cadastro) ==========
CREATE OR REPLACE FUNCTION is_identifier_available(p_type text, p_value text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_norm   text;
  v_exists boolean;
BEGIN
  IF p_type = 'phone' THEN
    v_norm := regexp_replace(p_value, '\D', '', 'g');
    IF length(v_norm) IN (12, 13) AND left(v_norm, 2) = '55' THEN
      v_norm := substring(v_norm, 3);
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM users
       WHERE regexp_replace(phone, '\D', '', 'g') = v_norm
    ) INTO v_exists;
  ELSIF p_type = 'cpf' THEN
    v_norm := regexp_replace(p_value, '\D', '', 'g');
    SELECT EXISTS (
      SELECT 1 FROM users
       WHERE regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_norm
         AND v_norm <> ''
    ) INTO v_exists;
  ELSIF p_type = 'email' THEN
    v_norm := lower(trim(p_value));
    SELECT EXISTS (
      SELECT 1 FROM users
       WHERE lower(trim(coalesce(email, ''))) = v_norm
         AND v_norm <> ''
    ) INTO v_exists;
  ELSE
    RAISE EXCEPTION 'invalid_identifier_type: %', p_type USING ERRCODE = 'P0001';
  END IF;

  RETURN NOT v_exists;
END;
$func$;

COMMENT ON FUNCTION is_identifier_available(text, text) IS 'Checagem isolada de disponibilidade (phone|cpf|email). Pre-signup; nao cria conta. Recuperada da 044 (056).';

REVOKE ALL ON FUNCTION is_identifier_available(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_identifier_available(text, text) TO anon, authenticated;

-- ========== 2. Trigger anti-fraude: aborto atômico de duplicidade ==========
CREATE OR REPLACE FUNCTION users_antifraud_duplicate_block()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_norm text;
BEGIN
  -- phone
  IF NEW.phone IS NOT NULL THEN
    v_norm := regexp_replace(NEW.phone, '\D', '', 'g');
    IF EXISTS (
      SELECT 1 FROM users WHERE id <> NEW.id
        AND regexp_replace(phone, '\D', '', 'g') = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_identifier:phone' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- cpf
  IF NEW.cpf IS NOT NULL AND regexp_replace(NEW.cpf, '\D', '', 'g') <> '' THEN
    v_norm := regexp_replace(NEW.cpf, '\D', '', 'g');
    IF EXISTS (
      SELECT 1 FROM users WHERE id <> NEW.id
        AND regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_identifier:cpf' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- email
  IF NEW.email IS NOT NULL AND lower(trim(NEW.email)) <> '' THEN
    v_norm := lower(trim(NEW.email));
    IF EXISTS (
      SELECT 1 FROM users WHERE id <> NEW.id
        AND lower(trim(coalesce(email, ''))) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_identifier:email' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION users_antifraud_duplicate_block() IS 'BEFORE INSERT em users: aborta cadastro duplicado (phone/cpf/email). Recuperada da 044 (056).';

DROP TRIGGER IF EXISTS users_antifraud_duplicate_block ON users;
CREATE TRIGGER users_antifraud_duplicate_block
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_antifraud_duplicate_block();

-- ========== 3. admin_list_trial_motoristas (USER_VIEW) ==========
CREATE OR REPLACE FUNCTION admin_list_trial_motoristas(
  p_status          text,
  p_about_to_expire boolean,
  p_q               text,
  p_sort            text,
  p_limit           int,
  p_offset          int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller        uuid := auth.uid();
  v_status        text;
  v_about         boolean := COALESCE(p_about_to_expire, false);
  v_search        text;
  v_search_pat    text;
  v_search_active boolean;
  v_sort          text;
  v_limit         int;
  v_offset        int;
  v_rows          jsonb;
  v_total         int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('USER_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'TRIAL_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'list'));
    RAISE EXCEPTION 'permission_denied: USER_VIEW required' USING ERRCODE = '42501';
  END IF;

  v_status := NULLIF(p_status, '');
  IF v_status = 'todos' THEN v_status := NULL; END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('em_trial','expirado','assinante') THEN
    RAISE EXCEPTION 'INVALID_INPUT: status' USING ERRCODE = 'P0001';
  END IF;

  v_sort := COALESCE(NULLIF(p_sort, ''), 'days_left_asc');
  IF v_sort NOT IN ('days_left_asc','days_left_desc','created_desc') THEN
    RAISE EXCEPTION 'INVALID_INPUT: sort' USING ERRCODE = 'P0001';
  END IF;

  v_search        := trim(COALESCE(p_q, ''));
  v_search_active := char_length(v_search) >= 2;
  v_search_pat    := '%' || v_search || '%';

  v_limit  := COALESCE(p_limit, 10);
  v_offset := COALESCE(p_offset, 0);
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_INPUT: limit' USING ERRCODE = 'P0001';
  END IF;
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: offset' USING ERRCODE = 'P0001';
  END IF;

  WITH base AS (
    SELECT u.id, u.name, u.phone, u.trial_ends_at, u.subscription_status, u.is_subscribed,
           u.updated_at, u.created_at, u.admin_username,
           GREATEST(0, CEIL(EXTRACT(EPOCH FROM (u.trial_ends_at - NOW())) / 86400.0))::int AS days_left,
           CASE WHEN u.is_subscribed THEN 'assinante'
                WHEN u.trial_ends_at IS NOT NULL AND u.trial_ends_at <= NOW() THEN 'expirado'
                ELSE 'em_trial' END AS trial_state
      FROM users u WHERE u.user_type = 'motorista'
  ),
  filtered AS (
    SELECT b.* FROM base b
     WHERE (v_status IS NULL OR b.trial_state = v_status)
       AND (NOT v_about OR (b.days_left > 0 AND b.days_left <= 5))
       AND (NOT v_search_active OR b.name ILIKE v_search_pat OR b.phone ILIKE v_search_pat)
  ),
  page AS (
    SELECT f.*, row_number() OVER (
        ORDER BY
          CASE WHEN v_sort = 'days_left_asc'  THEN f.days_left  END ASC  NULLS LAST,
          CASE WHEN v_sort = 'days_left_desc' THEN f.days_left  END DESC NULLS LAST,
          CASE WHEN v_sort = 'created_desc'   THEN f.created_at END DESC NULLS LAST,
          f.id ASC) AS rn
      FROM filtered f ORDER BY rn LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'phone', p.phone,
             'trial_ends_at', p.trial_ends_at, 'subscription_status', p.subscription_status,
             'is_subscribed', p.is_subscribed, 'days_left', p.days_left,
             'trial_state', p.trial_state, 'updated_at', p.updated_at,
             'admin_username', p.admin_username) ORDER BY p.rn)
      FROM page p), '[]'::jsonb),
    (SELECT count(*) FROM filtered)
  INTO v_rows, v_total;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total,0), 'limit', v_limit, 'offset', v_offset);
END;
$func$;

REVOKE ALL ON FUNCTION admin_list_trial_motoristas(text, boolean, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_trial_motoristas(text, boolean, text, text, int, int) TO authenticated;

-- ========== 4. admin_extend_trial (USER_EDIT) ==========
CREATE OR REPLACE FUNCTION admin_extend_trial(
  p_user_id             uuid,
  p_new_trial_ends_at   timestamptz,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_existing       record;
  v_new_updated_at timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  IF NOT is_admin_with_permission('USER_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'TRIAL_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'extend'));
    RAISE EXCEPTION 'permission_denied: USER_EDIT required' USING ERRCODE = '42501';
  END IF;

  IF p_new_trial_ends_at IS NULL OR p_new_trial_ends_at <= NOW() THEN
    RAISE EXCEPTION 'INVALID_INPUT: nova data deve ser futura' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, user_type, admin_username, trial_ends_at, updated_at
    INTO v_existing FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.admin_username = 'Nexus_Vortex99' THEN
    RAISE EXCEPTION 'MASTER_PROTECTED' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.user_type <> 'motorista' THEN
    RAISE EXCEPTION 'NOT_MOTORISTA' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing.updated_at
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE users
     SET trial_ends_at = p_new_trial_ends_at,
         subscription_status = 'trial',
         updated_at = NOW()
   WHERE id = p_user_id AND updated_at = p_expected_updated_at
   RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_new_updated_at);
END;
$func$;

REVOKE ALL ON FUNCTION admin_extend_trial(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_extend_trial(uuid, timestamptz, timestamptz) TO authenticated;

COMMIT;
