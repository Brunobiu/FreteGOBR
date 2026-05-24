-- ============================================================================
-- Migration 021: Curtidas de fretes pelos motoristas
-- ============================================================================
-- Idempotente. Cria tabela `frete_likes`, RLS e RPCs `toggle_frete_like` e
-- `get_likers_of_frete`.
--
-- Quando um motorista curte um frete, é criada uma linha em
-- `frete_likes` E uma notificação para o embarcador. Se o motorista
-- descurte, a linha é removida (e a notificação NÃO é desfeita —
-- continua no histórico).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABELA frete_likes
-- ============================================================================

CREATE TABLE IF NOT EXISTS frete_likes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id     UUID NOT NULL REFERENCES fretes(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (frete_id, motorista_id)
);

CREATE INDEX IF NOT EXISTS idx_frete_likes_frete_id ON frete_likes(frete_id);
CREATE INDEX IF NOT EXISTS idx_frete_likes_motorista_id ON frete_likes(motorista_id);

-- ============================================================================
-- 2. RLS DE frete_likes
-- ============================================================================
ALTER TABLE frete_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_likes_select_all ON frete_likes;
CREATE POLICY frete_likes_select_all
  ON frete_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS frete_likes_insert_own ON frete_likes;
CREATE POLICY frete_likes_insert_own
  ON frete_likes FOR INSERT
  WITH CHECK (motorista_id = auth.uid());

DROP POLICY IF EXISTS frete_likes_delete_own ON frete_likes;
CREATE POLICY frete_likes_delete_own
  ON frete_likes FOR DELETE
  USING (motorista_id = auth.uid());

-- ============================================================================
-- 3. RPC toggle_frete_like
-- ============================================================================

CREATE OR REPLACE FUNCTION toggle_frete_like(p_frete_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_motorista_id   UUID := auth.uid();
  v_motorista_name TEXT;
  v_embarcador_id  UUID;
  v_frete_origin   TEXT;
  v_frete_dest     TEXT;
  v_existing_id    UUID;
  v_total          INT;
BEGIN
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT embarcador_id, origin, destination
    INTO v_embarcador_id, v_frete_origin, v_frete_dest
    FROM fretes
   WHERE id = p_frete_id;

  IF v_embarcador_id IS NULL THEN
    RAISE EXCEPTION 'frete not found';
  END IF;

  SELECT id INTO v_existing_id
    FROM frete_likes
   WHERE frete_id    = p_frete_id
     AND motorista_id = v_motorista_id;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM frete_likes WHERE id = v_existing_id;
    -- Remove a notificação correspondente desse motorista nesse frete
    DELETE FROM notifications
     WHERE user_id = v_embarcador_id
       AND type    = 'frete_like'
       AND link    = '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text;
    SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
    RETURN jsonb_build_object('liked', false, 'total', v_total);
  END IF;

  INSERT INTO frete_likes (frete_id, motorista_id) VALUES (p_frete_id, v_motorista_id);

  SELECT name INTO v_motorista_name FROM users WHERE id = v_motorista_id;

  INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (
      v_embarcador_id,
      'frete_like',
      'Motorista interessado',
      coalesce(v_motorista_name, 'Um motorista')
        || ' curtiu o seu frete ' || v_frete_origin || ' → ' || v_frete_dest,
      '/embarcador?frete=' || p_frete_id::text || '&motorista=' || v_motorista_id::text
    );

  SELECT count(*) INTO v_total FROM frete_likes WHERE frete_id = p_frete_id;
  RETURN jsonb_build_object('liked', true, 'total', v_total);
END;
$fn$;

GRANT EXECUTE ON FUNCTION toggle_frete_like(UUID) TO authenticated;

-- ============================================================================
-- 4. RPC get_likers_of_frete
-- ============================================================================

DROP FUNCTION IF EXISTS get_likers_of_frete(UUID);

CREATE OR REPLACE FUNCTION get_likers_of_frete(p_frete_id UUID)
RETURNS TABLE (
  motorista_id    UUID,
  liked_at        TIMESTAMPTZ,
  name            TEXT,
  phone           TEXT,
  profile_photo   TEXT,
  vehicle_model   TEXT,
  vehicle_plate   TEXT,
  trailer_axles   INTEGER,
  cargo_capacity  NUMERIC
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
    m.vehicle_model::TEXT,
    m.vehicle_plate::TEXT,
    m.trailer_axles,
    m.cargo_capacity_ton
    FROM frete_likes fl
    JOIN users u ON u.id = fl.motorista_id
    LEFT JOIN motoristas m ON m.id = fl.motorista_id
   WHERE fl.frete_id = p_frete_id
   ORDER BY fl.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION get_likers_of_frete(UUID) TO authenticated;

-- ============================================================================
-- 5. REALTIME: garante que `notifications` aparece no canal pg_changes.
-- ============================================================================
-- Se a publicação `supabase_realtime` não existir (banco antigo), o
-- ALTER abaixo é silenciosamente ignorado pelo bloco DO.

DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    EXCEPTION WHEN duplicate_object THEN
      -- já estava publicado
      NULL;
    END;
  END IF;
END
$pub$;

COMMIT;
