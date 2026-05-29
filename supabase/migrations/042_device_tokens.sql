-- ============================================================================
-- Migration 042: Device Tokens (push notifications nativas via FCM/APN)
-- ============================================================================
-- Spec: .kiro/specs/mobile-app-capacitor/{design,tasks}.md
--
-- Tabela onde o app nativo (Capacitor) registra o token de push do
-- dispositivo. Edge Function `send-push-notification` consulta esta
-- tabela toda vez que uma notificacao eh inserida em `notifications`
-- e dispara push via FCM (Android) ou APN (iOS).
--
-- Convencoes:
--   - Idempotente.
--   - RLS: usuario so ve/atualiza seus proprios tokens.
--   - INSERT permitido por authenticated apenas com user_id = auth.uid().
-- ============================================================================

BEGIN;

-- 1. Tabela device_tokens
CREATE TABLE IF NOT EXISTS device_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text NOT NULL CHECK (char_length(token) BETWEEN 10 AND 500),
  platform      text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  app_version   text NULL CHECK (app_version IS NULL OR char_length(app_version) <= 50),
  device_model  text NULL CHECK (device_model IS NULL OR char_length(device_model) <= 100),
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON device_tokens (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_tokens_platform
  ON device_tokens (platform);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE device_tokens IS
  'Tokens de push notification por dispositivo. Cada user pode ter varios (celular + tablet). FCM para Android, APN para iOS, Web Push para navegador.';

-- 2. RLS: user só ve/manipula seus proprios tokens
DROP POLICY IF EXISTS device_tokens_select_own ON device_tokens;
CREATE POLICY device_tokens_select_own
  ON device_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS device_tokens_insert_own ON device_tokens;
CREATE POLICY device_tokens_insert_own
  ON device_tokens FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS device_tokens_update_own ON device_tokens;
CREATE POLICY device_tokens_update_own
  ON device_tokens FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS device_tokens_delete_own ON device_tokens;
CREATE POLICY device_tokens_delete_own
  ON device_tokens FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 3. Trigger: atualiza last_seen_at em UPDATE
CREATE OR REPLACE FUNCTION trg_device_tokens_touch_last_seen()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.last_seen_at := NOW();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS device_tokens_touch_last_seen ON device_tokens;
CREATE TRIGGER device_tokens_touch_last_seen
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION trg_device_tokens_touch_last_seen();

-- 4. RPC para registrar/atualizar token (upsert idempotente).
-- O cliente chama com user_id = auth.uid() implicito; a RPC valida.
CREATE OR REPLACE FUNCTION register_device_token(
  p_token        text,
  p_platform     text,
  p_app_version  text DEFAULT NULL,
  p_device_model text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL OR char_length(p_token) < 10 THEN
    RAISE EXCEPTION 'INVALID_TOKEN' USING ERRCODE = 'P0001';
  END IF;

  IF p_platform NOT IN ('android', 'ios', 'web') THEN
    RAISE EXCEPTION 'INVALID_PLATFORM' USING ERRCODE = 'P0001';
  END IF;

  -- Upsert: se ja existe (user_id, token), atualiza last_seen_at + metadados
  INSERT INTO device_tokens (user_id, token, platform, app_version, device_model)
  VALUES (v_caller, p_token, p_platform, p_app_version, p_device_model)
  ON CONFLICT (user_id, token) DO UPDATE
    SET app_version  = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
        device_model = COALESCE(EXCLUDED.device_model, device_tokens.device_model),
        last_seen_at = NOW()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'ok', true);
END;
$func$;

REVOKE ALL ON FUNCTION register_device_token(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_device_token(text, text, text, text) TO authenticated;

-- 5. RPC para remover token (logout)
CREATE OR REPLACE FUNCTION unregister_device_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_rows   int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: login required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM device_tokens
   WHERE user_id = v_caller AND token = p_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('removed', v_rows);
END;
$func$;

REVOKE ALL ON FUNCTION unregister_device_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unregister_device_token(text) TO authenticated;

-- 6. Trigger: ao inserir em notifications, dispara Edge Function de push.
-- Usamos pg_net.http_post para chamar a Edge Function de forma assincrona.
-- Se pg_net nao estiver habilitado, vamos confiar no realtime (fallback).
CREATE OR REPLACE FUNCTION trg_notifications_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_url text;
  v_service_key text;
BEGIN
  -- Le URL e service key de configs do projeto.
  -- Defina via: ALTER DATABASE postgres SET app.settings.edge_url = '...';
  --            ALTER DATABASE postgres SET app.settings.service_role_key = '...';
  v_url := current_setting('app.settings.edge_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_url IS NULL OR v_service_key IS NULL THEN
    -- Sem config: nao dispara push (mas notif ainda chega via realtime).
    RETURN NEW;
  END IF;

  -- Ignora notificacoes "barulhentas" (frete_like_ — Phase 2 fica configuravel)
  IF NEW.type LIKE 'frete_like_%' THEN
    RETURN NEW;
  END IF;

  -- Dispara push via pg_net (assincrono, nao bloqueia INSERT)
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'user_id', NEW.user_id,
      'type', NEW.type,
      'title', NEW.title,
      'message', NEW.message,
      'link', NEW.link
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebra o INSERT por falha de push. So loga warning.
  RAISE WARNING 'Push dispatch failed: %', SQLERRM;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS notifications_dispatch_push_after_insert ON notifications;
CREATE TRIGGER notifications_dispatch_push_after_insert
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION trg_notifications_dispatch_push();

COMMIT;

/*
-- VERIFY (apos apply):
SELECT to_regclass('public.device_tokens');
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema = 'public'
   AND routine_name IN ('register_device_token', 'unregister_device_token',
                        'trg_notifications_dispatch_push');
SELECT trigger_name FROM information_schema.triggers
 WHERE event_object_table IN ('device_tokens', 'notifications')
   AND trigger_name LIKE '%push%';
*/
