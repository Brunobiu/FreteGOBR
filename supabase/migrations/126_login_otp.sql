-- =====================================================================
-- Migration 126: Login sem senha (OTP por WhatsApp ou e-mail)
--
-- Spec: .kiro/specs/login-sem-senha/{requirements,design,tasks}.md
-- Depende da migration 125 (normalize_phone_e164, send-signup-otp, Vault).
--
-- Verifica a posse do identificador (telefone OU e-mail) por um código de 6
-- dígitos e permite emitir uma sessão do Supabase sem senha (a emissão em si
-- acontece na Edge `login-otp-verify` via admin.generateLink). O login por
-- senha permanece intacto — isto é uma opção adicional.
--
--   1. request_login_otp(identifier) → resolve a conta (anti-enumeração: conta
--      inexistente/inativa/rate-limited ⇒ resposta neutra sem enviar), gera o
--      código, grava o hash e dispara a Edge `send-signup-otp` (reuso do canal).
--   2. verify_login_otp(identifier, code) → valida (10 min, 5 tentativas) e, em
--      sucesso, consome e retorna o e-mail da identidade (auth.users) para o
--      generateLink na Edge.
--
-- Idempotente. Par 126_login_otp_rollback.sql documentado.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ========== 0. Validações defensivas ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='normalize_phone_e164') THEN
    RAISE EXCEPTION 'Migration 125 (auth-otp-whatsapp) nao aplicada: normalize_phone_e164 ausente';
  END IF;
END
$check$;

-- ========== 1. Tabela login_otp_codes ==========
CREATE TABLE IF NOT EXISTS public.login_otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('whatsapp','email')),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  consumed    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_otp_user
  ON public.login_otp_codes (user_id, consumed, created_at DESC);

ALTER TABLE public.login_otp_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_otp_no_access ON public.login_otp_codes;
CREATE POLICY login_otp_no_access ON public.login_otp_codes
  FOR ALL USING (false) WITH CHECK (false);

-- ========== 2. request_login_otp (anon) ==========
CREATE OR REPLACE FUNCTION request_login_otp(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_id          text := trim(coalesce(p_identifier, ''));
  v_is_email    boolean := position('@' in v_id) > 0;
  v_user        users%ROWTYPE;
  v_phone_e164  text;
  v_channel     text;
  v_force_email boolean;
  v_recent      int;
  v_code        text;
  v_edge_url    text;
  v_shared      text;
  v_target_url  text;
BEGIN
  -- Resposta SEMPRE neutra (anti-enumeração): nunca revela se a conta existe.
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF v_is_email THEN
    SELECT * INTO v_user FROM users WHERE lower(trim(coalesce(email, ''))) = lower(v_id) LIMIT 1;
    v_channel := 'email';
  ELSE
    SELECT * INTO v_user FROM users
     WHERE normalize_phone_e164(phone) = normalize_phone_e164(v_id) LIMIT 1;
    v_channel := 'whatsapp';
  END IF;

  -- Conta inexistente ou inativa ⇒ neutro, sem enviar.
  IF v_user.id IS NULL OR v_user.is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Rate limit 5/h por usuário ⇒ neutro, sem enviar (não revela nem o limite).
  SELECT count(*) INTO v_recent
    FROM login_otp_codes
   WHERE user_id = v_user.id AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_phone_e164  := normalize_phone_e164(v_user.phone);
  v_force_email := (v_channel = 'email');
  v_code        := lpad((floor(random() * 1000000))::int::text, 6, '0');

  UPDATE login_otp_codes SET consumed = true WHERE user_id = v_user.id AND consumed = false;

  INSERT INTO login_otp_codes (user_id, channel, code_hash, expires_at)
  VALUES (
    v_user.id, v_channel,
    encode(extensions.digest(v_code, 'sha256'), 'base64'),
    now() + interval '10 minutes'
  );

  -- Dispara a Edge de envio (reusa send-signup-otp: WhatsApp + fallback e-mail).
  SELECT decrypted_secret INTO v_edge_url FROM vault.decrypted_secrets WHERE name = 'edge_url' LIMIT 1;
  SELECT decrypted_secret INTO v_shared   FROM vault.decrypted_secrets WHERE name = 'edge_shared_secret' LIMIT 1;

  IF v_edge_url IS NOT NULL AND v_shared IS NOT NULL AND v_phone_e164 IS NOT NULL THEN
    IF v_edge_url LIKE '%/functions/v1' THEN
      v_target_url := v_edge_url || '/send-signup-otp';
    ELSIF v_edge_url LIKE '%/functions/v1/' THEN
      v_target_url := rtrim(v_edge_url, '/') || '/send-signup-otp';
    ELSE
      v_target_url := rtrim(v_edge_url, '/') || '/functions/v1/send-signup-otp';
    END IF;

    PERFORM net.http_post(
      url     := v_target_url,
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_shared
                 ),
      body    := jsonb_build_object(
                   'phone',       v_phone_e164,
                   'email',       v_user.email,
                   'code',        v_code,
                   'force_email', v_force_email
                 )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$func$;

COMMENT ON FUNCTION request_login_otp(text) IS
  'Login sem senha: gera/dispara OTP para conta existente (anti-enumeracao, rate limit 5/h). (126)';

REVOKE ALL ON FUNCTION request_login_otp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_login_otp(text) TO anon, authenticated;

-- ========== 3. verify_login_otp (anon) ==========
CREATE OR REPLACE FUNCTION verify_login_otp(p_identifier text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_id         text := trim(coalesce(p_identifier, ''));
  v_is_email   boolean := position('@' in v_id) > 0;
  v_user       users%ROWTYPE;
  v_rec        login_otp_codes%ROWTYPE;
  v_auth_email text;
BEGIN
  IF v_id = '' THEN
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  IF v_is_email THEN
    SELECT * INTO v_user FROM users WHERE lower(trim(coalesce(email, ''))) = lower(v_id) LIMIT 1;
  ELSE
    SELECT * INTO v_user FROM users
     WHERE normalize_phone_e164(phone) = normalize_phone_e164(v_id) LIMIT 1;
  END IF;

  -- Conta inexistente/inativa ⇒ EXPIRED (mesma resposta de "sem código pendente"),
  -- para NÃO distinguir conta existente de inexistente numa chamada direta à RPC
  -- (anti-enumeração). O envio (request_login_otp) já é sempre neutro.
  IF v_user.id IS NULL OR v_user.is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  SELECT * INTO v_rec
    FROM login_otp_codes
   WHERE user_id = v_user.id AND consumed = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;
  IF v_rec.expires_at < now() THEN
    UPDATE login_otp_codes SET consumed = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;
  IF v_rec.attempts >= 5 THEN
    UPDATE login_otp_codes SET consumed = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'BLOCKED');
  END IF;
  IF v_rec.code_hash <> encode(extensions.digest(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'base64') THEN
    UPDATE login_otp_codes SET attempts = attempts + 1 WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  -- Sucesso: consome (uso único) e retorna o e-mail da identidade no Auth, que
  -- a Edge usa no admin.generateLink para emitir a sessão.
  UPDATE login_otp_codes SET consumed = true WHERE id = v_rec.id;
  SELECT email INTO v_auth_email FROM auth.users WHERE id = v_user.id LIMIT 1;

  RETURN jsonb_build_object('status', 'OK', 'email', v_auth_email);
END;
$func$;

COMMENT ON FUNCTION verify_login_otp(text, text) IS
  'Login sem senha: valida o codigo e retorna o e-mail de identidade para generateLink. (126)';

REVOKE ALL ON FUNCTION verify_login_otp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_login_otp(text, text) TO anon, authenticated;

COMMIT;

-- ========== VERIFY (smoke test manual) ==========
/*
SELECT request_login_otp('11987654321');     -- {ok:true} (sempre neutro)
SELECT request_login_otp('naoexiste@x.com'); -- {ok:true} (não revela)
-- com um código conhecido inserido via service role:
-- SELECT verify_login_otp('11987654321','123456'); -- {status:OK, email:...}
*/
