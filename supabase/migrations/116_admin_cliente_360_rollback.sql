-- ============================================================================
-- ROLLBACK da Migration 116: Cliente_360
-- ============================================================================
-- Spec: .kiro/specs/admin-cliente-360/{requirements,design,tasks}.md (task 1.6)
--
-- DOCUMENTADO — NAO auto-aplicado (admin-patterns Sec. 9). Reverte a 116 na
-- ordem inversa, sem tocar dados das tabelas REUSADAS (users, subscriptions,
-- subscription_charges, financial_repasses, support_tickets, conversations,
-- login_attempts). So a tabela nova admin_user_notes e removida.
--
-- A re-assercao de is_admin_with_permission abaixo restaura o corpo anterior
-- (== 115, ja que a 116 reconhece USER_NOTE_* POR CONSTRUCAO e nao mudou os
-- ramos). E funcionalmente idempotente: serve para deixar o estado explicito
-- caso a 116 seja revertida sem reverter a 115.
-- ============================================================================

BEGIN;

-- 1. RPCs de CRUD de Internal_Note
DROP FUNCTION IF EXISTS admin_user_note_delete(uuid);
DROP FUNCTION IF EXISTS admin_user_note_update(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS admin_user_note_create(uuid, text);

-- 2. RPCs de leitura
DROP FUNCTION IF EXISTS admin_user_login_history(uuid, int);
DROP FUNCTION IF EXISTS admin_user_financial_history(uuid, int);
DROP FUNCTION IF EXISTS admin_global_search(text, int);

-- 3. Trigger + funcao de updated_at, policies e tabela admin_user_notes
DROP TRIGGER IF EXISTS trg_admin_user_notes_updated_at ON admin_user_notes;
DROP FUNCTION IF EXISTS admin_user_notes_set_updated_at();
DROP POLICY IF EXISTS admin_user_notes_no_direct_write ON admin_user_notes;
DROP POLICY IF EXISTS admin_user_notes_select ON admin_user_notes;
DROP TABLE IF EXISTS admin_user_notes;

-- 4. Restaura is_admin_with_permission ao corpo anterior (== 115). USER_NOTE_*
--    nao tinham ramo proprio, entao o corpo e identico ao da 116; manter aqui
--    deixa o rollback auto-contido.
CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH active AS (
    SELECT role
    FROM admin_roles
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE',
            'ASSISTANT_VIEW','ASSISTANT_EDIT'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW','FAQ_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;

COMMIT;
