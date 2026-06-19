-- ============================================================================
-- ROLLBACK da Migration 115b: RPCs da Suporte_Inteligente
-- ============================================================================
-- DOCUMENTACAO — NAO auto-aplicado. Remove as RPCs, o helper de transicao e a
-- tabela support_ai_claims. Rode ANTES do 115_suporte_inteligente_rollback.sql
-- (este reverte as RPCs; aquele reverte o schema que elas referenciam).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS support_change_status(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS support_set_priority(uuid, int, timestamptz);
DROP FUNCTION IF EXISTS support_handoff_to_human(uuid, timestamptz);
DROP FUNCTION IF EXISTS support_return_to_ai(uuid, timestamptz);
DROP FUNCTION IF EXISTS support_insert_human_reply(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS support_claim_ai_reply(uuid, text);
DROP FUNCTION IF EXISTS support_insert_ai_reply(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS support_create_faq(text, text, text, text);
DROP FUNCTION IF EXISTS support_update_faq(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS support_delete_faq(uuid);
DROP FUNCTION IF EXISTS support_update_ai_config(jsonb, timestamptz);
DROP FUNCTION IF EXISTS support_admin_list_tickets(jsonb, int, int);
DROP FUNCTION IF EXISTS support_list_faq(jsonb, int, int);
DROP FUNCTION IF EXISTS support_is_valid_transition(text, text);

DROP POLICY IF EXISTS support_ai_claims_no_dml ON support_ai_claims;
DROP TABLE IF EXISTS support_ai_claims;

COMMIT;
