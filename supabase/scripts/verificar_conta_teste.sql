-- ============================================================================
-- Script: Verificar conta de teste manualmente
-- ============================================================================
-- Execute este SQL no Supabase Studio (SQL Editor) para marcar a conta
-- abaixo como verificada, permitindo postar fretes mesmo sem o fluxo
-- de OTP por e-mail estar 100% funcional.
--
-- USO:
--   1. Edite o telefone abaixo se quiser verificar outra conta.
--   2. Cole no SQL Editor do Supabase e execute.
--   3. Confira a saída do SELECT no final.
-- ============================================================================

DO $$
DECLARE
  v_phone TEXT := '65745684568';   -- (65) 7 4568-4568 sanitizado
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
    FROM users
   WHERE replace(replace(replace(replace(phone, ' ', ''), '(', ''), ')', ''), '-', '') = v_phone
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado pelo telefone %.', v_phone;
  END IF;

  UPDATE users
     SET email_verified = true,
         updated_at     = NOW()
   WHERE id = v_user_id;

  RAISE NOTICE 'Conta % marcada como verificada.', v_user_id;
END $$;

-- Confirmar resultado
SELECT id, name, phone, email, email_verified, profile_photo_url, user_type
  FROM users
 WHERE replace(replace(replace(replace(phone, ' ', ''), '(', ''), ')', ''), '-', '') = '65745684568';
