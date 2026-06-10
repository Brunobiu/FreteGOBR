-- =====================================================
-- ROLLBACK da Migration 066: Verificação de e-mail pré-cadastro
--
-- Documentação — NÃO auto-aplicado. Reverte os objetos da 066.
-- =====================================================

BEGIN;

DROP FUNCTION IF EXISTS resolve_login_email(text);
DROP FUNCTION IF EXISTS consume_signup_email_token(text, uuid);
DROP FUNCTION IF EXISTS confirm_signup_email_code(text, text);
DROP FUNCTION IF EXISTS request_signup_email_code(text);

DROP TABLE IF EXISTS public.signup_email_verifications;

COMMIT;
