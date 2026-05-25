-- =====================================================
-- Rollback da Migration 032: admin-fretes
--
-- ATENCAO: este script e DESTRUTIVO. Aplicar apenas em
-- caso de incidente confirmado e apos backup completo
-- de admin_audit_logs.
--
-- NAO e auto-aplicado. Documentado para recovery.
-- =====================================================

BEGIN;

-- 1. Policies RLS
DROP POLICY IF EXISTS frete_clicks_admin_delete ON frete_clicks;
DROP POLICY IF EXISTS frete_clicks_admin_select ON frete_clicks;
DROP POLICY IF EXISTS fretes_admin_delete ON fretes;
DROP POLICY IF EXISTS fretes_admin_update ON fretes;
DROP POLICY IF EXISTS fretes_admin_select ON fretes;

-- 2. RPC
DROP FUNCTION IF EXISTS admin_delete_frete(uuid);

-- 3. Indices
DROP INDEX IF EXISTS idx_fretes_active_deadline;
DROP INDEX IF EXISTS idx_fretes_embarcador_created;
DROP INDEX IF EXISTS idx_fretes_status_created;
DROP INDEX IF EXISTS idx_fretes_flagged;

-- 4. Constraints
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_flag_consistency;
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_cancel_reason_consistency;
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_flagged_reason_length;
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS chk_fretes_cancel_reason_length;

-- 5. Colunas (em ordem reversa)
ALTER TABLE fretes DROP COLUMN IF EXISTS flagged_by;
ALTER TABLE fretes DROP COLUMN IF EXISTS flagged_at;
ALTER TABLE fretes DROP COLUMN IF EXISTS flagged_reason;
ALTER TABLE fretes DROP COLUMN IF EXISTS flagged_for_review;
ALTER TABLE fretes DROP COLUMN IF EXISTS cancel_reason;

COMMIT;
