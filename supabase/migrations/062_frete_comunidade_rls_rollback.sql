-- =====================================================
-- ROLLBACK da Migration 062: restaura a fretes_select_policy original
-- (sem expiração e sem flag de feature). Documentação — não auto-aplicado.
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS fretes_select_policy ON fretes;
CREATE POLICY fretes_select_policy ON fretes
FOR SELECT USING (
  status::text = 'ativo'
  OR embarcador_id = auth.uid()
  OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.user_type::text = 'admin')
);

COMMIT;
