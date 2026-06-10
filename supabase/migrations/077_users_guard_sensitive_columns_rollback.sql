-- =====================================================
-- ROLLBACK Migration 077 — documentação, não auto-aplicada.
-- Remove o guard de colunas sensíveis em users (volta ao estado anterior,
-- inseguro). Use apenas se o guard causar regressão inesperada.
-- =====================================================

BEGIN;

DROP TRIGGER IF EXISTS users_guard_sensitive_columns ON public.users;
DROP FUNCTION IF EXISTS public.users_guard_sensitive_columns();

COMMIT;
