-- =====================================================
-- Migration 032: admin-fretes
--
-- Adiciona o modulo de gestao de fretes sobre as fundacoes
-- entregues em 030_admin_foundation.sql e 031_admin_users.sql.
--
-- Componentes:
--   - 5 colunas em fretes: cancel_reason, flagged_for_review,
--     flagged_reason, flagged_at, flagged_by
--   - 4 constraints de coerencia
--   - 4 indices (incluindo parcial em flagged_for_review)
--   - Salvaguarda de cascade em frete_clicks
--   - RPC admin_delete_frete(uuid) SECURITY DEFINER
--   - 5 policies RLS adicionais
--
-- Dependencias: migrations 001..031 aplicadas. Em particular:
--   - is_admin_with_permission(text) (030)
--   - log_admin_action(...) (030)
--   - users.is_active / users.ban_reason (031)
--
-- IMPORTANTE: a exclusao de frete via admin_delete_frete deleta
-- explicitamente as linhas em frete_clicks ANTES de fretes para
-- que a contagem de cliques apagados seja capturada e gravada
-- no audit log da camada TS.
--
-- Idempotente: pode ser reaplicada sem erros.
-- =====================================================

BEGIN;

-- Garante que a migration 030 esta aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao esta aplicada';
  END IF;
END
$check$;

-- Garante que a migration 031 esta aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='ban_reason'
  ) THEN
    RAISE EXCEPTION 'Migration 031 (admin-users) nao esta aplicada';
  END IF;
END
$check$;

-- ========== 1. Colunas novas em fretes ==========

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS cancel_reason       TEXT NULL,
  ADD COLUMN IF NOT EXISTS flagged_for_review  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_reason      TEXT NULL,
  ADD COLUMN IF NOT EXISTS flagged_at          TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS flagged_by          UUID NULL
                                                REFERENCES users(id) ON DELETE SET NULL;

-- ========== 2. Constraints de coerencia ==========

ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_cancel_reason_length;
ALTER TABLE fretes ADD  CONSTRAINT chk_fretes_cancel_reason_length
  CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 1000);

ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_flagged_reason_length;
ALTER TABLE fretes ADD  CONSTRAINT chk_fretes_flagged_reason_length
  CHECK (flagged_reason IS NULL OR char_length(flagged_reason) <= 500);

ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_cancel_reason_consistency;
ALTER TABLE fretes ADD  CONSTRAINT chk_fretes_cancel_reason_consistency
  CHECK (
    (status = 'cancelado' AND cancel_reason IS NOT NULL)
    OR
    (status <> 'cancelado' AND cancel_reason IS NULL)
  );

ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_flag_consistency;
ALTER TABLE fretes ADD  CONSTRAINT chk_fretes_flag_consistency
  CHECK (
    (flagged_for_review = false
       AND flagged_reason IS NULL
       AND flagged_at IS NULL
       AND flagged_by IS NULL)
    OR
    (flagged_for_review = true
       AND flagged_reason IS NOT NULL
       AND flagged_at IS NOT NULL)
  );

-- ========== 3. Indices ==========

CREATE INDEX IF NOT EXISTS idx_fretes_flagged
  ON fretes(id) WHERE flagged_for_review = true;

CREATE INDEX IF NOT EXISTS idx_fretes_status_created
  ON fretes(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fretes_embarcador_created
  ON fretes(embarcador_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fretes_active_deadline
  ON fretes(deadline) WHERE status = 'ativo';


-- ========== 4. Salvaguarda de cascade em frete_clicks ==========

-- Verifica que a FK existe e tem ON DELETE CASCADE.
-- Bloco DO defensivo: se por algum motivo a FK foi recriada sem CASCADE
-- em migration intermediaria, este bloco corrige.
DO $fk$
DECLARE
  v_action text;
BEGIN
  SELECT confdeltype INTO v_action
  FROM pg_constraint
  WHERE conrelid = 'frete_clicks'::regclass
    AND contype = 'f'
    AND conname LIKE '%frete_id%'
  LIMIT 1;

  IF v_action IS NULL THEN
    RAISE NOTICE 'frete_clicks.frete_id FK nao encontrada — schema inesperado';
  ELSIF v_action <> 'c' THEN
    RAISE NOTICE 'frete_clicks.frete_id FK encontrada sem ON DELETE CASCADE; recriando';
    -- Drop dinamico do constraint name
    DECLARE v_conname text;
    BEGIN
      SELECT conname INTO v_conname FROM pg_constraint
      WHERE conrelid = 'frete_clicks'::regclass
        AND contype = 'f'
        AND conname LIKE '%frete_id%'
      LIMIT 1;
      IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE frete_clicks DROP CONSTRAINT %I', v_conname);
        ALTER TABLE frete_clicks ADD CONSTRAINT frete_clicks_frete_id_fkey
          FOREIGN KEY (frete_id) REFERENCES fretes(id) ON DELETE CASCADE;
      END IF;
    END;
  END IF;
END
$fk$;

-- ========== 5. RPC admin_delete_frete ==========

CREATE OR REPLACE FUNCTION admin_delete_frete(p_frete_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_clicks_deleted integer := 0;
  v_existed        boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_delete_frete requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('FRETE_DELETE') THEN
    RAISE EXCEPTION 'permission_denied: FRETE_DELETE required';
  END IF;

  SELECT EXISTS (SELECT 1 FROM fretes WHERE id = p_frete_id) INTO v_existed;
  IF NOT v_existed THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Lock no frete para evitar concorrencia
  PERFORM 1 FROM fretes WHERE id = p_frete_id FOR UPDATE;

  -- Apaga cliques explicitamente capturando count
  DELETE FROM frete_clicks WHERE frete_id = p_frete_id;
  GET DIAGNOSTICS v_clicks_deleted = ROW_COUNT;

  -- Apaga frete (CASCADE em frete_clicks e redundante mas segura)
  DELETE FROM fretes WHERE id = p_frete_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'clicks_deleted', v_clicks_deleted
  );
END;
$func$;

REVOKE ALL ON FUNCTION admin_delete_frete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_frete(uuid) TO authenticated;

-- ========== 6. Policies RLS adicionais ==========

DROP POLICY IF EXISTS fretes_admin_select ON fretes;
CREATE POLICY fretes_admin_select ON fretes
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('FRETE_VIEW'));

DROP POLICY IF EXISTS fretes_admin_update ON fretes;
CREATE POLICY fretes_admin_update ON fretes
  FOR UPDATE TO authenticated
  USING (
    is_admin_with_permission('FRETE_EDIT')
    OR is_admin_with_permission('FRETE_FORCE_CLOSE')
  )
  WITH CHECK (
    is_admin_with_permission('FRETE_EDIT')
    OR is_admin_with_permission('FRETE_FORCE_CLOSE')
  );

DROP POLICY IF EXISTS fretes_admin_delete ON fretes;
CREATE POLICY fretes_admin_delete ON fretes
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('FRETE_DELETE'));

DROP POLICY IF EXISTS frete_clicks_admin_select ON frete_clicks;
CREATE POLICY frete_clicks_admin_select ON frete_clicks
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('FRETE_VIEW'));

DROP POLICY IF EXISTS frete_clicks_admin_delete ON frete_clicks;
CREATE POLICY frete_clicks_admin_delete ON frete_clicks
  FOR DELETE TO authenticated
  USING (is_admin_with_permission('FRETE_DELETE'));

-- ========== 7. VERIFY: smoke test pos-deploy ==========
-- Executar manualmente apos aplicar a migration.

-- 1. Colunas novas em fretes
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='fretes'
--   AND column_name IN ('cancel_reason','flagged_for_review','flagged_reason','flagged_at','flagged_by');
-- Esperado: 5 linhas

-- 2. Constraints
-- SELECT conname FROM pg_constraint
-- WHERE conname IN ('chk_fretes_cancel_reason_length','chk_fretes_cancel_reason_consistency',
--                   'chk_fretes_flagged_reason_length','chk_fretes_flag_consistency');
-- Esperado: 4 linhas

-- 3. Indices
-- SELECT indexname FROM pg_indexes
-- WHERE indexname IN ('idx_fretes_flagged','idx_fretes_status_created',
--                     'idx_fretes_embarcador_created','idx_fretes_active_deadline');
-- Esperado: 4 linhas

-- 4. RPC
-- SELECT proname FROM pg_proc WHERE proname='admin_delete_frete';
-- Esperado: 1 linha

-- 5. Policies
-- SELECT tablename, policyname FROM pg_policies
-- WHERE policyname IN ('fretes_admin_select','fretes_admin_update','fretes_admin_delete',
--                      'frete_clicks_admin_select','frete_clicks_admin_delete');
-- Esperado: 5 linhas

COMMIT;
