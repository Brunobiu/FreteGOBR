-- =====================================================================
-- Migration 125: Verificação de cadastro por WhatsApp (OTP por telefone)
--                com fallback de e-mail
--
-- Spec: .kiro/specs/auth-otp-whatsapp/{requirements,design,tasks}.md
--
-- Adiciona um canal de OTP keyed pelo TELEFONE (Telefone_E164), espelhando o
-- padrão da migration 066 (signup_email_verifications): tabela RLS deny-all
-- acessada só por RPCs SECURITY DEFINER, com despacho assíncrono via pg_net
-- para a Edge `send-signup-otp` (que tenta WhatsApp Cloud API e cai para
-- e-mail). O cadastro passa a verificar a posse do telefone.
--
--   1. request_signup_otp(phone, email, force_email) → gera código, grava hash,
--      dispara a Edge. Anti-enumeração + rate limit 5/h por telefone.
--   2. confirm_signup_otp(phone, code) → valida (10 min, 5 tentativas) e emite
--      verification_token (30 min) + verified_channel.
--   3. consume_signup_otp_token(phone, token) → uso único, consumido no signup.
--
-- Também:
--   * users.phone_verified (coluna nova)
--   * embarcadores.company_name passa a ser opcional (preenchido no perfil)
--   * fretes_insert_policy: aceita (email_verified OR phone_verified) e exige
--     company_name preenchido (Contato_Verificado).
--
-- Idempotente. Par 125_auth_otp_whatsapp_rollback.sql documentado.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ========== 0. Validações defensivas ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela users ausente — schema base nao aplicado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='embarcadores') THEN
    RAISE EXCEPTION 'Tabela embarcadores ausente — schema base nao aplicado';
  END IF;
END
$check$;

-- ========== 1. Tabela signup_otp_verifications ==========
CREATE TABLE IF NOT EXISTS public.signup_otp_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel            text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','email')),
  phone              text,                 -- Telefone_E164 (alvo primário)
  email              text,                 -- alvo do fallback
  code_hash          text NOT NULL,        -- sha256 base64 do código normalizado
  expires_at         timestamptz NOT NULL, -- now() + 10 min
  attempts           int  NOT NULL DEFAULT 0,
  consumed           boolean NOT NULL DEFAULT false,
  verified_at        timestamptz,
  verified_channel   text CHECK (verified_channel IN ('whatsapp','email')),
  verification_token uuid,
  token_expires_at   timestamptz,
  sent_channel       text CHECK (sent_channel IN ('whatsapp','email')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_otp_phone
  ON public.signup_otp_verifications (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_otp_token
  ON public.signup_otp_verifications (verification_token)
  WHERE verification_token IS NOT NULL;

-- RLS deny-all: acesso SOMENTE via RPCs SECURITY DEFINER.
ALTER TABLE public.signup_otp_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signup_otp_no_access ON public.signup_otp_verifications;
CREATE POLICY signup_otp_no_access ON public.signup_otp_verifications
  FOR ALL USING (false) WITH CHECK (false);

-- ========== 2. Colunas novas / ajustes ==========
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

-- company_name passa a ser opcional (preenchido depois no perfil do embarcador).
ALTER TABLE public.embarcadores
  ALTER COLUMN company_name DROP NOT NULL;

-- ========== 3. Helper: normalização E.164 BR (determinística) ==========
CREATE OR REPLACE FUNCTION normalize_phone_e164(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $func$
DECLARE
  v text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  -- Já internacional BR: 55 + (10|11) dígitos locais => 12 ou 13 no total.
  IF left(v, 2) = '55' AND length(v) IN (12, 13) THEN
    RETURN v;
  END IF;
  -- Local BR (DDD + assinante): 10 ou 11 dígitos => prefixa 55.
  IF length(v) IN (10, 11) THEN
    RETURN '55' || v;
  END IF;
  RETURN NULL;  -- fora do formato BR
END;
$func$;

COMMENT ON FUNCTION normalize_phone_e164(text) IS
  'Normaliza telefone BR para E.164 (5511987654321). NULL se invalido. (125)';

-- ========== 4. request_signup_otp (anon) ==========
CREATE OR REPLACE FUNCTION request_signup_otp(p_phone text, p_email text, p_force_email boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_phone      text := normalize_phone_e164(p_phone);
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_recent     int;
  v_code       text;
  v_channel    text;
  v_edge_url   text;
  v_shared     text;
  v_target_url text;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = 'P0001';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = 'P0001';
  END IF;

  -- Anti-enumeração: telefone OU e-mail já cadastrado => ok SEM enviar.
  IF EXISTS (SELECT 1 FROM users WHERE normalize_phone_e164(phone) = v_phone)
     OR (v_email <> '' AND EXISTS (
           SELECT 1 FROM users WHERE lower(trim(coalesce(email, ''))) = v_email)) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Rate limit: máx. 5 códigos por telefone em 1h.
  SELECT count(*) INTO v_recent
    FROM signup_otp_verifications
   WHERE phone = v_phone AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  v_code    := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_channel := CASE WHEN p_force_email THEN 'email' ELSE 'whatsapp' END;

  -- Invalida pendentes anteriores do mesmo telefone.
  UPDATE signup_otp_verifications
     SET consumed = true
   WHERE phone = v_phone AND consumed = false;

  INSERT INTO signup_otp_verifications (channel, phone, email, code_hash, expires_at)
  VALUES (
    v_channel, v_phone, NULLIF(v_email, ''),
    encode(extensions.digest(v_code, 'sha256'), 'base64'),
    now() + interval '10 minutes'
  );

  -- Dispara a Edge send-signup-otp (WhatsApp + fallback). Lê segredos do Vault.
  SELECT decrypted_secret INTO v_edge_url FROM vault.decrypted_secrets WHERE name = 'edge_url' LIMIT 1;
  SELECT decrypted_secret INTO v_shared   FROM vault.decrypted_secrets WHERE name = 'edge_shared_secret' LIMIT 1;

  IF v_edge_url IS NOT NULL AND v_shared IS NOT NULL THEN
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
                   'phone',       v_phone,
                   'email',       NULLIF(v_email, ''),
                   'code',        v_code,
                   'force_email', coalesce(p_force_email, false)
                 )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$func$;

COMMENT ON FUNCTION request_signup_otp(text, text, boolean) IS
  'Pre-cadastro: gera/dispara OTP por WhatsApp (fallback e-mail). Rate limit 5/h por telefone. (125)';

REVOKE ALL ON FUNCTION request_signup_otp(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_signup_otp(text, text, boolean) TO anon, authenticated;

-- ========== 5. confirm_signup_otp (anon) ==========
CREATE OR REPLACE FUNCTION confirm_signup_otp(p_phone text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_phone   text := normalize_phone_e164(p_phone);
  v_rec     signup_otp_verifications%ROWTYPE;
  v_token   uuid;
  v_channel text;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_rec
    FROM signup_otp_verifications
   WHERE phone = v_phone AND consumed = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  IF v_rec.expires_at < now() THEN
    UPDATE signup_otp_verifications SET consumed = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  IF v_rec.attempts >= 5 THEN
    UPDATE signup_otp_verifications SET consumed = true WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'BLOCKED');
  END IF;

  IF v_rec.code_hash <> encode(extensions.digest(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'base64') THEN
    UPDATE signup_otp_verifications SET attempts = attempts + 1 WHERE id = v_rec.id;
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  -- Sucesso: emite token (30 min). Canal verificado = canal efetivamente
  -- despachado pela Edge (sent_channel) ou, na ausência, o canal pretendido.
  v_token   := gen_random_uuid();
  v_channel := COALESCE(v_rec.sent_channel, v_rec.channel);
  UPDATE signup_otp_verifications
     SET verified_at        = now(),
         verified_channel   = v_channel,
         verification_token = v_token,
         token_expires_at   = now() + interval '30 minutes'
   WHERE id = v_rec.id;

  RETURN jsonb_build_object('status', 'OK', 'token', v_token, 'channel', v_channel);
END;
$func$;

COMMENT ON FUNCTION confirm_signup_otp(text, text) IS
  'Pre-cadastro: valida o codigo do telefone e emite verification_token (30 min). (125)';

REVOKE ALL ON FUNCTION confirm_signup_otp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_signup_otp(text, text) TO anon, authenticated;

-- ========== 6. consume_signup_otp_token (anon, usado no signup) ==========
CREATE OR REPLACE FUNCTION consume_signup_otp_token(p_phone text, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_phone text := normalize_phone_e164(p_phone);
  v_rec   signup_otp_verifications%ROWTYPE;
BEGIN
  IF v_phone IS NULL OR p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT * INTO v_rec
    FROM signup_otp_verifications
   WHERE phone = v_phone
     AND verification_token = p_token
     AND consumed = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF v_rec.verified_at IS NULL
     OR v_rec.token_expires_at IS NULL
     OR v_rec.token_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE signup_otp_verifications SET consumed = true WHERE id = v_rec.id;
  RETURN jsonb_build_object('ok', true, 'channel', COALESCE(v_rec.verified_channel, v_rec.channel));
END;
$func$;

COMMENT ON FUNCTION consume_signup_otp_token(text, uuid) IS
  'Pre-cadastro: valida e consome o verification_token (uso unico) no signup. (125)';

REVOKE ALL ON FUNCTION consume_signup_otp_token(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_signup_otp_token(text, uuid) TO anon, authenticated;

-- ========== 7. fretes_insert_policy: Contato_Verificado + company_name ==========
-- Substitui o gate da migration 010: aceita telefone OU e-mail verificado e
-- passa a exigir nome da empresa preenchido (movido do cadastro para o perfil).
DROP POLICY IF EXISTS fretes_insert_policy ON fretes;

CREATE POLICY fretes_insert_policy ON fretes
FOR INSERT
WITH CHECK (
  embarcador_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM users u
     WHERE u.id            = auth.uid()
       AND u.user_type     = 'embarcador'
       AND (u.email_verified = true OR u.phone_verified = true)
       AND u.profile_photo_url IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM embarcadores e
     WHERE e.id               = auth.uid()
       AND e.company_logo_url IS NOT NULL
       AND e.company_name     IS NOT NULL
       AND length(btrim(e.company_name)) > 0
  )
);

COMMIT;

-- ========== VERIFY (smoke test manual) ==========
/*
SELECT normalize_phone_e164('(11) 9 8765-4321');          -- 5511987654321
SELECT normalize_phone_e164('5511987654321');             -- 5511987654321 (idempotente)
SELECT normalize_phone_e164('123');                       -- NULL
SELECT request_signup_otp('11987654321','novo@ex.com', false);  -- {ok:true}
-- pegar o code (WhatsApp/e-mail), depois:
-- SELECT confirm_signup_otp('11987654321','123456');      -- {status:OK, token:..., channel:...}
-- SELECT consume_signup_otp_token('11987654321','<token>'); -- {ok:true, channel:...} (uma vez só)
SELECT column_name FROM information_schema.columns
 WHERE table_name='users' AND column_name='phone_verified';  -- 1 linha
*/
