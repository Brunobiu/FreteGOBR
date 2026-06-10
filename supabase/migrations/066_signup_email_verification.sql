-- =====================================================
-- Migration 066: Verificação de e-mail PRÉ-CADASTRO (anônima)
--                (cadastro multi-step: dados → código → senha)
--
-- Contexto: a verificação existente (migration 010) é keyed por `auth.uid()`
-- e exige login — não serve para verificar o e-mail ANTES de a conta existir.
-- Esta migration adiciona um fluxo de verificação por e-mail para VISITANTE
-- ANÔNIMO, keyed pelo próprio e-mail, com rate limit por e-mail.
--
-- Fluxo:
--   1. request_signup_email_code(email)  → gera código de 6 dígitos, grava hash
--      em signup_email_verifications e dispara a Edge `send-verification-email`
--      (reusa a mesma Edge/Resend e os secrets do Vault). Anti-abuso: máx. 5
--      códigos por e-mail em 1h.
--   2. confirm_signup_email_code(email, code) → valida (10 min, 5 tentativas).
--      Em sucesso, marca o registro como `verified_at` e retorna um
--      `verification_token` (uuid) com validade de 30 min.
--   3. O signup (auth.ts) chama check_signup_email_verified(email, token) para
--      garantir que o e-mail foi verificado neste fluxo antes de criar a conta.
--
-- Idempotente. Par _rollback.sql documentado.
-- =====================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ========== 1. Tabela de verificações pré-cadastro ==========
CREATE TABLE IF NOT EXISTS public.signup_email_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  code_hash          text NOT NULL,
  expires_at         timestamptz NOT NULL,
  attempts           int NOT NULL DEFAULT 0,
  consumed           boolean NOT NULL DEFAULT false,
  verified_at        timestamptz,
  verification_token uuid,
  token_expires_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_email_verif_email
  ON public.signup_email_verifications (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_email_verif_token
  ON public.signup_email_verifications (verification_token)
  WHERE verification_token IS NOT NULL;

-- RLS deny-all: tabela acessada SOMENTE via RPCs SECURITY DEFINER.
ALTER TABLE public.signup_email_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signup_email_verif_no_access ON public.signup_email_verifications;
CREATE POLICY signup_email_verif_no_access ON public.signup_email_verifications
  FOR ALL USING (false) WITH CHECK (false);

-- ========== 2. request_signup_email_code (anon) ==========
CREATE OR REPLACE FUNCTION request_signup_email_code(p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_email        text := lower(trim(coalesce(p_email, '')));
  v_recent_count int;
  v_code         text;
  v_edge_url     text;
  v_shared       text;
  v_target_url   text;
BEGIN
  IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = 'P0001';
  END IF;

  -- Já existe conta com este e-mail? Não revela (anti-enumeração): retorna ok,
  -- mas NÃO envia código. O signup final aborta de qualquer forma (duplicado).
  IF EXISTS (SELECT 1 FROM users WHERE lower(trim(coalesce(email, ''))) = v_email) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Anti-abuso: máx. 5 códigos por e-mail em 1h.
  SELECT count(*) INTO v_recent_count
    FROM signup_email_verifications
   WHERE lower(email) = v_email
     AND created_at > now() - interval '1 hour';
  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- Invalida códigos pendentes anteriores do mesmo e-mail.
  UPDATE signup_email_verifications
     SET consumed = true
   WHERE lower(email) = v_email AND consumed = false;

  INSERT INTO signup_email_verifications (email, code_hash, expires_at)
  VALUES (v_email, encode(extensions.digest(v_code, 'sha256'), 'base64'),
          now() + interval '10 minutes');

  -- Dispara a Edge de e-mail (reusa send-verification-email + secrets do Vault).
  SELECT decrypted_secret INTO v_edge_url
    FROM vault.decrypted_secrets WHERE name = 'edge_url' LIMIT 1;
  SELECT decrypted_secret INTO v_shared
    FROM vault.decrypted_secrets WHERE name = 'edge_shared_secret' LIMIT 1;

  IF v_edge_url IS NOT NULL AND v_shared IS NOT NULL THEN
    IF v_edge_url LIKE '%/functions/v1' THEN
      v_target_url := v_edge_url || '/send-verification-email';
    ELSIF v_edge_url LIKE '%/functions/v1/' THEN
      v_target_url := rtrim(v_edge_url, '/') || '/send-verification-email';
    ELSE
      v_target_url := rtrim(v_edge_url, '/') || '/functions/v1/send-verification-email';
    END IF;

    PERFORM net.http_post(
      url     := v_target_url,
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_shared
                 ),
      body    := jsonb_build_object('email', v_email, 'code', v_code)
    );
  END IF;
  -- Sem fallback dev em texto claro aqui: e-mail pré-cadastro é anônimo.

  RETURN jsonb_build_object('ok', true);
END;
$func$;

COMMENT ON FUNCTION request_signup_email_code(text) IS
  'Pre-cadastro: gera/envia codigo de verificacao por e-mail (anon). Rate limit 5/h por e-mail. (066)';

REVOKE ALL ON FUNCTION request_signup_email_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_signup_email_code(text) TO anon, authenticated;

-- ========== 3. confirm_signup_email_code (anon) ==========
CREATE OR REPLACE FUNCTION confirm_signup_email_code(p_email text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_rec   signup_email_verifications%ROWTYPE;
  v_token uuid;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rec
    FROM signup_email_verifications
   WHERE lower(email) = v_email AND consumed = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  IF v_rec.expires_at < now() THEN
    UPDATE signup_email_verifications SET consumed = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  IF v_rec.attempts >= 5 THEN
    UPDATE signup_email_verifications SET consumed = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'BLOCKED');
  END IF;

  IF v_rec.code_hash <> encode(extensions.digest(regexp_replace(coalesce(p_code,''), '\D', '', 'g'), 'sha256'), 'base64') THEN
    UPDATE signup_email_verifications SET attempts = attempts + 1 WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  -- Sucesso: emite token de verificação válido por 30 min. O registro NÃO é
  -- consumido ainda — será consumido no signup ao validar o token.
  v_token := gen_random_uuid();
  UPDATE signup_email_verifications
     SET verified_at        = now(),
         verification_token = v_token,
         token_expires_at   = now() + interval '30 minutes'
   WHERE id = v_rec.id;

  RETURN jsonb_build_object('status', 'OK', 'token', v_token);
END;
$func$;

COMMENT ON FUNCTION confirm_signup_email_code(text, text) IS
  'Pre-cadastro: valida o codigo e emite verification_token (30 min). (066)';

REVOKE ALL ON FUNCTION confirm_signup_email_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_signup_email_code(text, text) TO anon, authenticated;

-- ========== 4. consume_signup_email_token (anon, usado no signup) ==========
-- Valida (e consome) o token emitido na confirmação. Retorna true se o e-mail
-- foi verificado neste fluxo e o token ainda é válido. Consome o registro para
-- impedir reuso do token.
CREATE OR REPLACE FUNCTION consume_signup_email_token(p_email text, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_rec   signup_email_verifications%ROWTYPE;
BEGIN
  IF v_email = '' OR p_token IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_rec
    FROM signup_email_verifications
   WHERE lower(email) = v_email
     AND verification_token = p_token
     AND consumed = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_rec.verified_at IS NULL
     OR v_rec.token_expires_at IS NULL
     OR v_rec.token_expires_at < now() THEN
    RETURN false;
  END IF;

  -- Consome para impedir reuso.
  UPDATE signup_email_verifications SET consumed = true WHERE id = v_rec.id;
  RETURN true;
END;
$func$;

COMMENT ON FUNCTION consume_signup_email_token(text, uuid) IS
  'Pre-cadastro: valida e consome o verification_token no signup. (066)';

REVOKE ALL ON FUNCTION consume_signup_email_token(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_signup_email_token(text, uuid) TO anon, authenticated;

-- ========== 5. resolve_login_email (anon) — login por telefone ==========
-- Resolve o e-mail de login (identidade no Auth) a partir do telefone, para
-- permitir login flexível (e-mail OU telefone). Para contas novas a identidade
-- é o e-mail real; o fallback do cliente cobre contas legadas (sintético).
-- Retorna NULL quando não encontra (o cliente cai no fallback e o Auth nega
-- com a mesma mensagem genérica — anti-enumeração preservada).
CREATE OR REPLACE FUNCTION resolve_login_email(p_phone text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_norm  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_uid   uuid;
  v_email text;
BEGIN
  IF v_norm = '' THEN RETURN NULL; END IF;
  IF length(v_norm) IN (12, 13) AND left(v_norm, 2) = '55' THEN
    v_norm := substring(v_norm, 3);
  END IF;

  SELECT id INTO v_uid
    FROM users
   WHERE regexp_replace(phone, '\D', '', 'g') = v_norm
   LIMIT 1;

  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- E-mail de login é o e-mail da identidade em auth.users.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid LIMIT 1;
  RETURN v_email;
END;
$func$;

COMMENT ON FUNCTION resolve_login_email(text) IS
  'Resolve o e-mail de login (auth.users) a partir do telefone, para login flexivel. (066)';

REVOKE ALL ON FUNCTION resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_login_email(text) TO anon, authenticated;

COMMIT;

-- ========== VERIFY (smoke test manual) ==========
/*
SELECT request_signup_email_code('teste@exemplo.com');   -- {ok:true}
-- pegar o code no email; depois:
-- SELECT confirm_signup_email_code('teste@exemplo.com','123456');  -- {status:OK, token:...}
-- SELECT consume_signup_email_token('teste@exemplo.com','<token>'); -- true (uma vez só)
*/
