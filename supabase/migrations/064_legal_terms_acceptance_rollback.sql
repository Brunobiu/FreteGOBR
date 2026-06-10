-- =====================================================
-- ROLLBACK da Migration 064: Aceite obrigatório dos Termos
--
-- Documentação — NÃO auto-aplicado. Reverte os objetos da 064.
--
-- ATENÇÃO: dropar as colunas apaga o registro de aceite das contas. Só execute
-- se realmente quiser reverter a feature. Considere manter as colunas e apenas
-- remover o trigger se o objetivo for desativar o carimbo automático.
-- =====================================================

BEGIN;

DROP TRIGGER IF EXISTS users_set_terms_accepted_at ON public.users;
DROP FUNCTION IF EXISTS users_set_terms_accepted_at();

ALTER TABLE public.users DROP COLUMN IF EXISTS terms_version;
ALTER TABLE public.users DROP COLUMN IF EXISTS terms_accepted_at;

COMMIT;
