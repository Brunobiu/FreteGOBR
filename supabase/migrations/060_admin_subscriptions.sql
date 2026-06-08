-- =====================================================
-- Migration 060: RPC admin de Assinaturas
--
-- Spec: .kiro/specs/assinaturas-pagamento (Fase 6, task 16)
--
-- Entrega:
--   - admin_list_subscriptions(p_group, p_q, p_sort, p_limit, p_offset):
--       listagem paginada de assinaturas para o painel admin, gated por
--       FINANCEIRO_VIEW (reusa a permissão existente). Audit negativo
--       SUBSCRIPTION_VIEW_DENIED + permission_denied (42501) com Stealth_404
--       na UI. Agrupamento:
--         'a_vencer'      -> active com next_charge_at nos próximos 7 dias
--         'pagas'         -> active (assinatura em dia)
--         'inadimplentes' -> past_due + suspended
--         'todos'/NULL    -> todas
--
-- Padrões: SECURITY DEFINER, search_path=public, REVOKE/GRANT (admin-patterns §2,§10).
-- STABLE (somente leitura). Espelha admin_list_trial_motoristas (056).
--
-- Idempotente. Par: 060_admin_subscriptions_rollback.sql.
-- =====================================================

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'is_admin_with_permission ausente (admin-foundation 030).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='subscriptions') THEN
    RAISE EXCEPTION 'Tabela subscriptions ausente -- aplique a 055 antes.';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION admin_list_subscriptions(
  p_group  text,
  p_q      text,
  p_sort   text,
  p_limit  int,
  p_offset int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller        uuid := auth.uid();
  v_group         text;
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

  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'SUBSCRIPTION_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'list'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required' USING ERRCODE = '42501';
  END IF;

  v_group := NULLIF(p_group, '');
  IF v_group = 'todos' THEN v_group := NULL; END IF;
  IF v_group IS NOT NULL AND v_group NOT IN ('a_vencer','pagas','inadimplentes') THEN
    RAISE EXCEPTION 'INVALID_INPUT: group' USING ERRCODE = 'P0001';
  END IF;

  v_sort := COALESCE(NULLIF(p_sort, ''), 'next_charge_asc');
  IF v_sort NOT IN ('next_charge_asc','next_charge_desc','started_desc') THEN
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
    SELECT s.id, s.user_id, s.plan, s.payment_method, s.status, s.auto_recurring,
           s.started_at, s.next_charge_at, s.grace_ends_at, s.canceled_at, s.updated_at,
           u.name AS user_name, u.phone AS user_phone, u.admin_username,
           CASE
             WHEN s.status IN ('past_due','suspended') THEN 'inadimplentes'
             WHEN s.status = 'active'
                  AND s.next_charge_at IS NOT NULL
                  AND s.next_charge_at <= NOW() + INTERVAL '7 days' THEN 'a_vencer'
             WHEN s.status = 'active' THEN 'pagas'
             ELSE 'outros'
           END AS grupo
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
  ),
  filtered AS (
    SELECT b.* FROM base b
     WHERE (
            v_group IS NULL
            OR (v_group = 'inadimplentes' AND b.status IN ('past_due','suspended'))
            OR (v_group = 'a_vencer'      AND b.grupo = 'a_vencer')
            OR (v_group = 'pagas'         AND b.status = 'active')
           )
       AND (NOT v_search_active OR b.user_name ILIKE v_search_pat OR b.user_phone ILIKE v_search_pat)
  ),
  page AS (
    SELECT f.*, row_number() OVER (
        ORDER BY
          CASE WHEN v_sort = 'next_charge_asc'  THEN f.next_charge_at END ASC  NULLS LAST,
          CASE WHEN v_sort = 'next_charge_desc' THEN f.next_charge_at END DESC NULLS LAST,
          CASE WHEN v_sort = 'started_desc'     THEN f.started_at     END DESC NULLS LAST,
          f.id ASC) AS rn
      FROM filtered f ORDER BY rn LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id,
             'user_id', p.user_id,
             'user_name', p.user_name,
             'user_phone', p.user_phone,
             'plan', p.plan,
             'payment_method', p.payment_method,
             'status', p.status,
             'auto_recurring', p.auto_recurring,
             'started_at', p.started_at,
             'next_charge_at', p.next_charge_at,
             'grace_ends_at', p.grace_ends_at,
             'canceled_at', p.canceled_at,
             'updated_at', p.updated_at,
             'grupo', p.grupo,
             'admin_username', p.admin_username) ORDER BY p.rn)
      FROM page p), '[]'::jsonb),
    (SELECT count(*) FROM filtered)
  INTO v_rows, v_total;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total,0), 'limit', v_limit, 'offset', v_offset);
END;
$func$;

REVOKE ALL ON FUNCTION admin_list_subscriptions(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_subscriptions(text, text, text, int, int) TO authenticated;

COMMIT;

-- =====================================================
-- VERIFY (descomente para smoke test manual):
-- =====================================================
/*
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_list_subscriptions';
-- Como admin com FINANCEIRO_VIEW:
SELECT admin_list_subscriptions(NULL, NULL, NULL, 10, 0);
*/
