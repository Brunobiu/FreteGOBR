-- ============================================================================
-- Migration 012: Corrigir hash_verification_code para encontrar digest()
-- ============================================================================
-- Idempotente. Resolve o erro:
--   "function digest(text, unknown) does not exist"
--
-- Causa: no Supabase, a extensão pgcrypto fica no schema `extensions`,
-- não em `public`. Como a função `hash_verification_code` foi criada
-- com `SET search_path = public`, o `digest()` da pgcrypto não é
-- encontrado.
--
-- Correção: garantir pgcrypto, ampliar o search_path para incluir
-- `extensions` E qualificar a chamada com schema explícito como
-- segunda camada de defesa.
-- ============================================================================

BEGIN;

-- 1. Garante pgcrypto disponível no schema extensions (padrão Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Recria hash_verification_code qualificando explicitamente o schema
CREATE OR REPLACE FUNCTION hash_verification_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN encode(
    extensions.digest(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'),
    'base64'
  );
END;
$$;

-- 3. Recria as RPCs também com search_path incluindo extensions, caso o
--    Supabase tenha cacheado o search_path anterior.
CREATE OR REPLACE FUNCTION generate_email_verification_code(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_recent_count INTEGER;
  v_code         TEXT;
  v_edge_url     TEXT;
  v_service_key  TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  SELECT COUNT(*) INTO v_recent_count
    FROM verification_codes
   WHERE user_id  = v_user_id
     AND purpose  = 'email'
     AND created_at > NOW() - INTERVAL '24 hours';

  IF v_recent_count >= 3 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO verification_codes (user_id, purpose, target, code_hash, expires_at)
  VALUES (
    v_user_id,
    'email',
    p_email,
    hash_verification_code(v_code),
    NOW() + INTERVAL '10 minutes'
  );

  INSERT INTO audit_logs (user_id, action, new_data)
  VALUES (
    v_user_id,
    'verification_code_sent',
    jsonb_build_object(
      'purpose',       'email',
      'target_masked', '****' || right(p_email, 4)
    )
  );

  v_edge_url    := current_setting('app.settings.edge_url', true);
  v_service_key := current_setting('app.settings.service_key', true);

  IF v_edge_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_edge_url || '/send-verification-email',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_service_key
                 ),
      body    := jsonb_build_object('email', p_email, 'code', v_code)
    );
  ELSE
    -- Modo dev: log do código em audit_logs (apenas em ambiente sem
    -- Edge Function configurada).
    INSERT INTO audit_logs (user_id, action, new_data)
    VALUES (
      v_user_id,
      'verification_code_dev_log',
      jsonb_build_object('purpose', 'email', 'code', v_code)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION confirm_email_verification_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_record  verification_codes%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_record
    FROM verification_codes
   WHERE user_id  = v_user_id
     AND purpose  = 'email'
     AND consumed = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  IF v_record.expires_at < NOW() THEN
    UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  IF v_record.attempts >= 3 THEN
    UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
    INSERT INTO audit_logs (user_id, action, new_data)
    VALUES (v_user_id, 'verification_blocked', jsonb_build_object('purpose', 'email'));
    RETURN jsonb_build_object('status', 'BLOCKED');
  END IF;

  IF v_record.code_hash <> hash_verification_code(p_code) THEN
    UPDATE verification_codes
       SET attempts = attempts + 1
     WHERE id = v_record.id;
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  UPDATE verification_codes SET consumed = true WHERE id = v_record.id;

  UPDATE users
     SET email          = v_record.target,
         email_verified = true,
         updated_at     = NOW()
   WHERE id = v_user_id;

  INSERT INTO audit_logs (user_id, action, new_data)
  VALUES (v_user_id, 'verification_succeeded', jsonb_build_object('purpose', 'email'));

  RETURN jsonb_build_object('status', 'OK');
END;
$$;

COMMIT;
