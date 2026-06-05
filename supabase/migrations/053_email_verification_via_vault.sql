-- ============================================================================
-- Migration 053: Email verification via Vault
-- ============================================================================
-- NOTA DE NUMERACAO: aplicada no banco em 2026-06-04 sob o nome interno
-- "044_email_verification_via_vault" (antes de notar que 044 ja era
-- trial_e_bloqueio no repo). Registrada aqui como 053 para manter a
-- sequencia do repositorio sem buracos. Idempotente: CREATE OR REPLACE.
--
-- Atualiza generate_email_verification_code para ler edge_url e
-- service_role_key do Vault (padrao 042b/047) em vez de
-- current_setting('app.settings.*'), que requer ALTER DATABASE SET
-- (bloqueado em Supabase Cloud).
--
-- SUPERSEDIDA pela 054 (que troca service_role_key por edge_shared_secret).
-- Mantida para historico.
--
-- Pre-requisito: secrets `edge_url` e `service_role_key` no Vault.

BEGIN;

CREATE OR REPLACE FUNCTION generate_email_verification_code(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_user_id      UUID := auth.uid();
  v_recent_count INTEGER;
  v_code         TEXT;
  v_edge_url     TEXT;
  v_service_key  TEXT;
  v_target_url   TEXT;
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
    v_user_id, 'email', p_email, hash_verification_code(v_code), NOW() + INTERVAL '10 minutes'
  );

  INSERT INTO audit_logs (user_id, action, new_data)
  VALUES (
    v_user_id, 'verification_code_sent',
    jsonb_build_object('purpose', 'email', 'target_masked', '****' || right(p_email, 4))
  );

  SELECT decrypted_secret INTO v_edge_url
    FROM vault.decrypted_secrets WHERE name = 'edge_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_edge_url IS NOT NULL AND v_service_key IS NOT NULL THEN
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
                   'Authorization', 'Bearer ' || v_service_key
                 ),
      body    := jsonb_build_object('email', p_email, 'code', v_code)
    );
  ELSE
    INSERT INTO audit_logs (user_id, action, new_data)
    VALUES (
      v_user_id, 'verification_code_dev_log',
      jsonb_build_object('purpose', 'email', 'code', v_code)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$func$;

REVOKE ALL ON FUNCTION generate_email_verification_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_email_verification_code(TEXT) TO authenticated;

COMMIT;
