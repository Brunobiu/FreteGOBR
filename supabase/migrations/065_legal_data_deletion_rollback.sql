-- =====================================================
-- ROLLBACK da Migration 065: Exclusão de dados + bloqueio anti-reuso
--
-- Documentação — NÃO auto-aplicado. Reverte os objetos da 065.
--
-- ATENÇÃO: dropar `account_deletion_blocklist` apaga o histórico anti-reuso —
-- identificadores antes bloqueados voltam a poder se cadastrar. Avalie antes.
-- =====================================================

BEGIN;

DROP TRIGGER IF EXISTS users_block_deleted_reuse ON public.users;
DROP FUNCTION IF EXISTS users_block_deleted_reuse();
DROP FUNCTION IF EXISTS rpc_delete_my_account();
DROP FUNCTION IF EXISTS is_identifier_blocked(text, text);
DROP FUNCTION IF EXISTS legal_hash_identifier(text, text);
DROP FUNCTION IF EXISTS legal_normalize_identifier(text, text);

DROP TABLE IF EXISTS public.account_deletion_blocklist;

COMMIT;
