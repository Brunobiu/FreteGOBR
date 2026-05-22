-- ============================================================================
-- Migration 010: Onboarding e Perfil do Embarcador
-- ============================================================================
-- Idempotente: pode ser aplicada múltiplas vezes sem erro.
-- Implementa a spec `.kiro/specs/embarcador-onboarding/`:
--   * Verificação de e-mail por código OTP (tabela verification_codes + RPCs)
--   * Logo da empresa (coluna embarcadores.company_logo_url)
--   * Restrição de postagem de fretes para cadastro 100% completo (RLS)
--
-- Pré-requisitos: Migration 009_consolidated_alignment.sql aplicada.
-- ============================================================================

BEGIN;

-- Garante a extensão pgcrypto para digest()/sha256
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Extensão pg_net (para chamar Edge Function a partir da RPC)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 1. COLUNAS NOVAS (Req. 11.1, 11.2)
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE embarcadores
  ADD COLUMN IF NOT EXISTS company_logo_url TEXT;

-- ============================================================================
-- 2. TABELA verification_codes (Req. 11.3, 11.5, 11.7, 6.4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS verification_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('email')),
  target      VARCHAR(255) NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_user_purpose_consumed
  ON verification_codes (user_id, purpose, consumed);

ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_codes_select_policy ON verification_codes;
CREATE POLICY verification_codes_select_policy ON verification_codes
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS verification_codes_update_policy ON verification_codes;
CREATE POLICY verification_codes_update_policy ON verification_codes
  FOR UPDATE USING (user_id = auth.uid());
-- INSERT direto não é permitido (apenas via RPC SECURITY DEFINER)

-- ============================================================================
-- 3. TRIGGER invalidate_old_verification_codes (Req. 6.12)
-- ============================================================================

CREATE OR REPLACE FUNCTION invalidate_old_verification_codes()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE verification_codes
     SET consumed = true
   WHERE user_id  = NEW.user_id
     AND purpose  = NEW.purpose
     AND id      <> NEW.id
     AND consumed = false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invalidate_old_codes_trigger ON verification_codes;
CREATE TRIGGER invalidate_old_codes_trigger
  AFTER INSERT ON verification_codes
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_old_verification_codes();

-- ============================================================================
-- 4. FUNÇÃO hash_verification_code (Req. 11.6, 12.3)
-- ============================================================================
-- SHA-256 em base64 sobre o código normalizado (apenas dígitos).
CREATE OR REPLACE FUNCTION hash_verification_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN encode(
    digest(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'),
    'base64'
  );
END;
$$;

-- ============================================================================
-- 5. RPC generate_email_verification_code (Req. 6.3, 6.4, 6.11, 12.1, 13.1)
-- ============================================================================
-- Gera código de 6 dígitos, persiste hash, audita e dispara Edge Function.
-- Aplica rate limit de 3 envios em 24h por (user_id, purpose='email').
-- Retorna { ok: true } em sucesso. Erros: unauthenticated, invalid_email,
-- rate_limited.
CREATE OR REPLACE FUNCTION generate_email_verification_code(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Rate limit: 3 códigos em 24h por usuário+purpose
  SELECT COUNT(*) INTO v_recent_count
    FROM verification_codes
   WHERE user_id  = v_user_id
     AND purpose  = 'email'
     AND created_at > NOW() - INTERVAL '24 hours';

  IF v_recent_count >= 3 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  -- Gera código de 6 dígitos com leading zeros
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO verification_codes (user_id, purpose, target, code_hash, expires_at)
  VALUES (
    v_user_id,
    'email',
    p_email,
    hash_verification_code(v_code),
    NOW() + INTERVAL '10 minutes'
  );

  -- Audit (target mascarado)
  INSERT INTO audit_logs (user_id, action, new_data)
  VALUES (
    v_user_id,
    'verification_code_sent',
    jsonb_build_object(
      'purpose',       'email',
      'target_masked', '****' || right(p_email, 4)
    )
  );

  -- Disparo da Edge Function via pg_net (best-effort).
  -- Configurações lidas via current_setting com missing_ok = true.
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
    -- Fallback dev: loga no audit_logs com `code` em texto claro APENAS
    -- quando o ambiente não tem Edge Function configurada. Nunca em prod.
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

-- ============================================================================
-- 6. RPC confirm_email_verification_code (Req. 6.6, 6.8, 6.9, 6.10, 12.2, 13.2, 13.3)
-- ============================================================================
-- Valida o código submetido contra o registro mais recente não consumido.
-- Retorna { status: 'OK' | 'INVALID' | 'EXPIRED' | 'BLOCKED' }.
CREATE OR REPLACE FUNCTION confirm_email_verification_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Não há código pendente: tratamos como expirado para a UI.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  -- Expirado por tempo
  IF v_record.expires_at < NOW() THEN
    UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
    RETURN jsonb_build_object('status', 'EXPIRED');
  END IF;

  -- Bloqueado por excesso de tentativas
  IF v_record.attempts >= 3 THEN
    UPDATE verification_codes SET consumed = true WHERE id = v_record.id;
    INSERT INTO audit_logs (user_id, action, new_data)
    VALUES (v_user_id, 'verification_blocked', jsonb_build_object('purpose', 'email'));
    RETURN jsonb_build_object('status', 'BLOCKED');
  END IF;

  -- Hash diferente: incrementa attempts e retorna INVALID
  IF v_record.code_hash <> hash_verification_code(p_code) THEN
    UPDATE verification_codes
       SET attempts = attempts + 1
     WHERE id = v_record.id;
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  -- Sucesso
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

-- ============================================================================
-- 7. RECRIAR fretes_insert_policy COM CADASTRO COMPLETO (Req. 10.5, 10.7)
-- ============================================================================
-- Bloqueia INSERT em fretes se o embarcador não tem:
--   * email_verified = true
--   * profile_photo_url preenchido
--   * company_logo_url preenchido
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

COMMIT;
