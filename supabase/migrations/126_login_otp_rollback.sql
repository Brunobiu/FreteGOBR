-- =====================================================================
-- ROLLBACK da Migration 126: Login sem senha (OTP)
--
-- DOCUMENTAÇÃO — NÃO é auto-aplicado. Reverte os objetos da 126.
-- Não afeta o login por senha (que nunca foi alterado).
-- =====================================================================

BEGIN;

DROP FUNCTION IF EXISTS verify_login_otp(text, text);
DROP FUNCTION IF EXISTS request_login_otp(text);
DROP TABLE IF EXISTS public.login_otp_codes;

COMMIT;
