-- =====================================================
-- ROLLBACK Migration 078 — documentação, não auto-aplicada.
-- Remove o guard de INSERT em users (volta ao estado anterior, inseguro).
-- =====================================================

BEGIN;

DROP TRIGGER IF EXISTS users_guard_insert ON public.users;
DROP FUNCTION IF EXISTS public.users_guard_insert();

COMMIT;
