-- =====================================================
-- Migration 063: Frete Comunidade — RPCs de perfil, listagem, publicação, cron
--
-- Spec: .kiro/specs/frete-comunidade (Fase 3, tasks 11 e 12)
--
-- RPCs SECURITY DEFINER (admin-patterns §2, §10):
--   - community_profile_get()                  [FINANCEIRO_VIEW]
--   - community_profile_upsert(...)            [FINANCEIRO_EDIT, STALE_VERSION]
--   - admin_list_community_fretes(...)         [FINANCEIRO_VIEW, STABLE]
--   - community_publish_fretes(p_payload)      [FINANCEIRO_EDIT]
--   - community_expire_stale_fretes()          [cron, idempotente]
--
-- Todas: auth.uid() guard; audit negativo COMMUNITY_VIEW_DENIED; REVOKE/GRANT.
-- Idempotente (CREATE OR REPLACE). Par: 063_..._rollback.sql.
-- =====================================================

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='community_profile') THEN
    RAISE EXCEPTION 'community_profile ausente -- aplique a 061 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'is_admin_with_permission ausente (admin-foundation 030).';
  END IF;
END
$check$;

-- ── community_profile_get ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION community_profile_get()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_row    community_profile%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'COMMUNITY_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'profile_get'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM community_profile WHERE singleton = true LIMIT 1;

  RETURN jsonb_build_object(
    'photo_path', v_row.photo_path,
    'name', v_row.name,
    'secondary_name', v_row.secondary_name,
    'enabled', v_row.enabled,
    'updated_at', v_row.updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION community_profile_get() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community_profile_get() TO authenticated;

-- ── community_profile_upsert ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION community_profile_upsert(
  p_photo_path     text,
  p_name           text,
  p_secondary_name text,
  p_enabled        boolean,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller    uuid := auth.uid();
  v_before    jsonb;
  v_rows      int;
  v_new_updated timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FINANCEIRO_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'COMMUNITY_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'profile_upsert'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_EDIT required' USING ERRCODE = '42501';
  END IF;

  -- Validações de input (Req 2.3/2.4): nome 0..120, secundário 0..160.
  IF p_name IS NULL OR char_length(p_name) > 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: name length' USING ERRCODE = 'P0001';
  END IF;
  IF p_secondary_name IS NULL OR char_length(p_secondary_name) > 160 THEN
    RAISE EXCEPTION 'INVALID_INPUT: secondary_name length' USING ERRCODE = 'P0001';
  END IF;
  IF p_photo_path IS NOT NULL AND char_length(p_photo_path) > 500 THEN
    RAISE EXCEPTION 'INVALID_INPUT: photo_path length' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object('name', name, 'secondary_name', secondary_name,
                            'enabled', enabled, 'photo_path', photo_path)
    INTO v_before FROM community_profile WHERE singleton = true;

  UPDATE community_profile
     SET photo_path     = p_photo_path,
         name           = p_name,
         secondary_name = p_secondary_name,
         enabled        = p_enabled,
         updated_at     = now(),
         updated_by     = v_caller
   WHERE singleton = true
     AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_new_updated;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
  VALUES (v_caller, 'COMMUNITY_PROFILE_UPDATED', 'community_profile', NULL, v_before,
          jsonb_build_object('name', p_name, 'secondary_name', p_secondary_name,
                             'enabled', p_enabled, 'photo_path', p_photo_path));

  RETURN jsonb_build_object('updated_at', v_new_updated);
END;
$func$;

REVOKE ALL ON FUNCTION community_profile_upsert(text, text, text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community_profile_upsert(text, text, text, boolean, timestamptz) TO authenticated;

-- ── admin_list_community_fretes ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_list_community_fretes(
  p_q      text,
  p_sort   text,
  p_limit  int,
  p_offset int
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_q      text;
  v_pat    text;
  v_sort   text;
  v_limit  int;
  v_offset int;
  v_rows   jsonb;
  v_total  int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FINANCEIRO_VIEW') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'COMMUNITY_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'list'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_VIEW required' USING ERRCODE = '42501';
  END IF;

  v_q := NULLIF(btrim(coalesce(p_q, '')), '');
  v_pat := '%' || replace(replace(coalesce(v_q, ''), '%', '\%'), '_', '\_') || '%';
  v_sort := lower(coalesce(p_sort, 'recent'));
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  SELECT count(*) INTO v_total
    FROM fretes f
   WHERE f.source = 'comunidade'
     AND (v_q IS NULL
          OR f.origin ILIKE v_pat OR f.destination ILIKE v_pat
          OR f.community_carrier_name ILIKE v_pat);

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.id, f.origin, f.destination, f.value, f.product,
             f.community_carrier_name AS carrier_name,
             f.community_contact_phone AS contact_phone,
             f.status,
             f.updated_at AS ref_date,
             f.created_at,
             GREATEST(0, CEIL(EXTRACT(EPOCH FROM (f.updated_at + INTERVAL '5 days' - now())) / 86400.0))::int AS days_left
        FROM fretes f
       WHERE f.source = 'comunidade'
         AND (v_q IS NULL
              OR f.origin ILIKE v_pat OR f.destination ILIKE v_pat
              OR f.community_carrier_name ILIKE v_pat)
       ORDER BY
         CASE WHEN v_sort = 'value_desc' THEN f.value END DESC NULLS LAST,
         CASE WHEN v_sort = 'value_asc' THEN f.value END ASC NULLS LAST,
         f.created_at DESC
       LIMIT v_limit OFFSET v_offset
    ) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
                            'limit', v_limit, 'offset', v_offset);
END;
$func$;

REVOKE ALL ON FUNCTION admin_list_community_fretes(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_community_fretes(text, text, int, int) TO authenticated;

-- ── community_publish_fretes ──────────────────────────────────────────────
-- p_payload: jsonb array de linhas. Cada linha:
--   { carrierName, origin, destination, originDetail, destinationDetail,
--     value, product, contactPhone (só dígitos),
--     originLat, originLng, destinationLat, destinationLng, distanceKm,
--     dedupAction ('insert'|'update'|'skip'), existingFreteId }
-- Resiliência por linha: falha individual conta em errors e continua.
CREATE OR REPLACE FUNCTION community_publish_fretes(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_enabled  boolean;
  v_profile  int;
  v_item     jsonb;
  v_published int := 0;
  v_updated   int := 0;
  v_skipped   int := 0;
  v_errors    int := 0;
  v_action   text;
  v_phone    text;
  v_value    numeric;
  v_existing uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  IF NOT is_admin_with_permission('FINANCEIRO_EDIT') THEN
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (v_caller, 'COMMUNITY_VIEW_DENIED', NULL, NULL, NULL,
            jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied', 'rpc', 'publish'));
    RAISE EXCEPTION 'permission_denied: FINANCEIRO_EDIT required' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_payload) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_INPUT: payload must be array' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_payload) > 200 THEN
    RAISE EXCEPTION 'INVALID_INPUT: max 200 rows' USING ERRCODE = 'P0001';
  END IF;

  -- Perfil precisa existir e estar habilitado (Req 8.x).
  SELECT count(*), bool_or(enabled) INTO v_profile, v_enabled
    FROM community_profile WHERE singleton = true;
  IF v_profile = 0 THEN
    RAISE EXCEPTION 'NO_PROFILE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    BEGIN
      v_action := coalesce(v_item->>'dedupAction', 'insert');

      IF v_action = 'skip' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Pré-condição de cidade resolvida (Req 8.3): coords obrigatórias.
      IF (v_item->>'originLat') IS NULL OR (v_item->>'originLng') IS NULL
         OR (v_item->>'destinationLat') IS NULL OR (v_item->>'destinationLng') IS NULL THEN
        RAISE EXCEPTION 'CITY_UNRESOLVED';
      END IF;

      v_phone := regexp_replace(coalesce(v_item->>'contactPhone', ''), '\D', '', 'g');
      IF v_phone !~ '^[0-9]{10,11}$' THEN
        RAISE EXCEPTION 'INVALID_INPUT: phone';
      END IF;

      v_value := (v_item->>'value')::numeric;
      IF v_value IS NULL OR v_value <= 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: value';
      END IF;

      IF v_action = 'update' THEN
        v_existing := nullif(v_item->>'existingFreteId', '')::uuid;
        IF v_existing IS NULL THEN
          RAISE EXCEPTION 'INVALID_INPUT: existingFreteId';
        END IF;
        UPDATE fretes
           SET value = v_value,
               product = nullif(v_item->>'product', ''),
               community_carrier_name = v_item->>'carrierName',
               community_contact_phone = v_phone,
               origin_detail = nullif(v_item->>'originDetail', ''),
               destination_detail = nullif(v_item->>'destinationDetail', ''),
               distance_km = nullif(v_item->>'distanceKm', '')::int,
               status = 'ativo',
               updated_at = now()  -- reabre janela de expiração (Req 7.7)
         WHERE id = v_existing AND source = 'comunidade';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'NOT_FOUND';
        END IF;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO fretes (
          embarcador_id, source, community_carrier_name, community_contact_phone,
          origin, origin_location, destination, destination_location,
          cargo_type, product, vehicle_type, weight, value, deadline,
          loading_time, unloading_time, origin_detail, destination_detail,
          distance_km, status
        ) VALUES (
          NULL, 'comunidade', v_item->>'carrierName', v_phone,
          v_item->>'origin',
          format('POINT(%s %s)', (v_item->>'originLng'), (v_item->>'originLat')),
          v_item->>'destination',
          format('POINT(%s %s)', (v_item->>'destinationLng'), (v_item->>'destinationLat')),
          'comunidade', nullif(v_item->>'product', ''), 'indefinido', 0, v_value,
          (now() + INTERVAL '30 days')::date,
          0, 0, nullif(v_item->>'originDetail', ''), nullif(v_item->>'destinationDetail', ''),
          nullif(v_item->>'distanceKm', '')::int, 'ativo'
        );
        v_published := v_published + 1;
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        -- dedup (índice uq_fretes_dedup_active): trata como skip silencioso.
        v_skipped := v_skipped + 1;
      WHEN others THEN
        v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
  VALUES (v_caller, 'COMMUNITY_FRETES_PUBLISHED', 'fretes', NULL, NULL,
          jsonb_build_object('published', v_published, 'updated', v_updated,
                             'skipped', v_skipped, 'errors', v_errors));

  RETURN jsonb_build_object('published', v_published, 'updated', v_updated,
                            'skipped', v_skipped, 'errors', v_errors);
END;
$func$;

REVOKE ALL ON FUNCTION community_publish_fretes(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community_publish_fretes(jsonb) TO authenticated;

-- ── community_expire_stale_fretes (cron idempotente) ──────────────────────
CREATE OR REPLACE FUNCTION community_expire_stale_fretes()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE v_count int;
BEGIN
  UPDATE fretes SET status = 'encerrado'
   WHERE status = 'ativo' AND now() >= updated_at + INTERVAL '5 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('expired', v_count);
END;
$func$;

REVOKE ALL ON FUNCTION community_expire_stale_fretes() FROM PUBLIC;
-- Sem GRANT a authenticated: só roda via cron/service-role.

COMMIT;
