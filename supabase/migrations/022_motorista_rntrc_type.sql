-- ============================================================================
-- Migration 022: Tipo de RNTRC (ANTT) do motorista — Pessoa Física ou Jurídica
-- ============================================================================
-- Idempotente. Adiciona `rntrc_type` em `motoristas` e atualiza a RPC
-- `get_likers_of_frete` pra retornar também `vehicle_type` e `rntrc_type`,
-- usados pelo modal "Motorista interessado".
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Coluna rntrc_type (NULL = não informado, 'fisica' | 'juridica')
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE motoristas
  ADD COLUMN IF NOT EXISTS rntrc_type TEXT
    CHECK (rntrc_type IS NULL OR rntrc_type IN ('fisica', 'juridica'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Atualiza get_likers_of_frete: adiciona vehicle_type e rntrc_type
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_likers_of_frete(UUID);

CREATE OR REPLACE FUNCTION get_likers_of_frete(p_frete_id UUID)
RETURNS TABLE (
  motorista_id    UUID,
  liked_at        TIMESTAMPTZ,
  name            TEXT,
  phone           TEXT,
  profile_photo   TEXT,
  vehicle_type    TEXT,
  vehicle_model   TEXT,
  vehicle_plate   TEXT,
  trailer_axles   INTEGER,
  cargo_capacity  NUMERIC,
  rntrc_type      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_owner  UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT embarcador_id INTO v_owner FROM fretes WHERE id = p_frete_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'frete not found';
  END IF;
  IF v_owner <> v_caller THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  RETURN QUERY
  SELECT
    fl.motorista_id,
    fl.created_at AS liked_at,
    u.name::TEXT,
    u.phone::TEXT,
    u.profile_photo_url::TEXT,
    m.vehicle_type::TEXT,
    m.vehicle_model::TEXT,
    m.vehicle_plate::TEXT,
    m.trailer_axles,
    m.cargo_capacity_ton,
    m.rntrc_type::TEXT
    FROM frete_likes fl
    JOIN users u ON u.id = fl.motorista_id
    LEFT JOIN motoristas m ON m.id = fl.motorista_id
   WHERE fl.frete_id = p_frete_id
   ORDER BY fl.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION get_likers_of_frete(UUID) TO authenticated;

COMMIT;
