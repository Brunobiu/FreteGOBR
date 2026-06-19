-- ============================================================================
-- ROLLBACK da Migration 115: Suporte_Inteligente (schema / RBAC / RLS / trigger)
-- ============================================================================
-- DOCUMENTACAO — NAO e auto-aplicado. Reverte 115_suporte_inteligente.sql na
-- ordem inversa. Aplicar manualmente apenas se necessario reverter a entrega.
--
-- ATENCAO (destrutivo / pre-condicoes):
--   - Restaurar o dominio de `status` para 3 estados (open/in_progress/resolved)
--     FALHA se existirem tickets em 'waiting_customer' ou 'closed'. Antes de
--     rodar, remapeie essas linhas (ex.: waiting_customer -> in_progress,
--     closed -> resolved) ou o ADD CONSTRAINT sera rejeitado.
--   - DROP das colunas responder_mode/priority_level/handoff_at/returned_to_ai_at
--     e da coluna author_kind PERDE os dados dessas colunas (esperado no rollback).
--   - As RPCs ficam na 115b; rode 115b_suporte_inteligente_rpcs_rollback.sql
--     ANTES deste arquivo (as RPCs referenciam as colunas/tabelas abaixo).
-- ============================================================================

BEGIN;

-- 1. Trigger de reabertura por mensagem do cliente
DROP TRIGGER IF EXISTS support_ticket_messages_reopen_on_user_msg ON support_ticket_messages;
DROP FUNCTION IF EXISTS support_ticket_reopen_on_user_msg();

-- 2. Triggers de updated_at nas tabelas novas
DROP TRIGGER IF EXISTS support_kb_entries_set_updated_at ON support_kb_entries;
DROP TRIGGER IF EXISTS support_ai_config_set_updated_at ON support_ai_config;

-- 3. Policies + tabelas novas
DROP POLICY IF EXISTS kb_select_view ON support_kb_entries;
DROP POLICY IF EXISTS kb_mutate_edit ON support_kb_entries;
DROP POLICY IF EXISTS ai_config_select ON support_ai_config;
DROP POLICY IF EXISTS ai_config_mutate ON support_ai_config;
DROP TABLE IF EXISTS support_kb_entries;
DROP TABLE IF EXISTS support_ai_config;

-- 4. author_kind em support_ticket_messages
ALTER TABLE support_ticket_messages DROP COLUMN IF EXISTS author_kind;

-- 5. Colunas + indices novos em support_tickets e restauracao do status_check (3 estados)
DROP INDEX IF EXISTS idx_tickets_responder_mode;
DROP INDEX IF EXISTS idx_tickets_priority_level;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS responder_mode;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS priority_level;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS handoff_at;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS returned_to_ai_at;

-- Pre-condicao: nenhum ticket em waiting_customer/closed (ver ATENCAO no topo).
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD  CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open','in_progress','resolved'));

-- 6. Restaura is_admin_with_permission ao corpo pre-115 (estado de 047/048:
--    SUPORTE sem FAQ_VIEW; deny-list de ADMIN com ASSISTANT_VIEW/EDIT).
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
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFY (manual)
-- ============================================================================
/*
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='support_tickets_status_check';
SELECT to_regclass('public.support_kb_entries'), to_regclass('public.support_ai_config');
SELECT column_name FROM information_schema.columns
 WHERE table_name='support_tickets'
   AND column_name IN ('responder_mode','priority_level','handoff_at','returned_to_ai_at');
*/
