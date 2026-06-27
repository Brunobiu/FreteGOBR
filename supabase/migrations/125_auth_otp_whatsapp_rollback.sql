-- =====================================================================
-- ROLLBACK da Migration 125: Verificação de cadastro por WhatsApp (OTP)
--
-- DOCUMENTAÇÃO — NÃO é auto-aplicado. Reverte os objetos criados pela 125.
-- Ordem reversa. Revisar antes de rodar em produção.
--
-- ATENÇÃO:
--   * Restaurar `embarcadores.company_name NOT NULL` SÓ é seguro se não houver
--     linhas com company_name nulo (embarcadores criados após a 125 podem ter
--     company_name nulo até preencherem no perfil). O bloco abaixo só reaplica
--     o NOT NULL se não houver nulos; caso contrário, deixa como está e avisa.
--   * Reverter o gate de fretes volta ao comportamento da migration 010
--     (exige email_verified; ignora phone_verified e company_name).
-- =====================================================================

BEGIN;

-- 1. Restaurar o gate da migration 010 (apenas email_verified + foto + logo).
DROP POLICY IF EXISTS fretes_insert_policy ON fretes;
CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  embarcador_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM users u
     WHERE u.id              = auth.uid()
       AND u.user_type       = 'embarcador'
       AND u.email_verified  = true
       AND u.profile_photo_url IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM embarcadores e
     WHERE e.id               = auth.uid()
       AND e.company_logo_url IS NOT NULL
  )
);

-- 2. Remover as RPCs.
DROP FUNCTION IF EXISTS consume_signup_otp_token(text, uuid);
DROP FUNCTION IF EXISTS confirm_signup_otp(text, text);
DROP FUNCTION IF EXISTS request_signup_otp(text, text, boolean);
DROP FUNCTION IF EXISTS normalize_phone_e164(text);

-- 3. Remover a tabela de OTP por telefone.
DROP TABLE IF EXISTS public.signup_otp_verifications;

-- 4. Remover a coluna phone_verified.
ALTER TABLE public.users DROP COLUMN IF EXISTS phone_verified;

-- 5. Reaplicar company_name NOT NULL — só se não houver nulos.
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM embarcadores WHERE company_name IS NULL) THEN
    RAISE NOTICE 'company_name possui valores nulos; NOT NULL NAO foi reaplicado. Preencha antes de reverter.';
  ELSE
    ALTER TABLE public.embarcadores ALTER COLUMN company_name SET NOT NULL;
  END IF;
END
$rb$;

COMMIT;
