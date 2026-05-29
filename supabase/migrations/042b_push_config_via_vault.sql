-- ============================================================================
-- Migration 042b: Push config via Supabase Vault
-- ============================================================================
-- Supabase Cloud bloqueia `ALTER DATABASE SET app.settings.*`. Usamos Vault.
--
-- Pre-requisito: extension `vault` habilitada (Dashboard > Database >
-- Extensions). Se nao estiver, este script habilita.
--
-- Apos rodar este script, o usuario deve criar 2 segredos no Vault
-- (Dashboard > Project Settings > Vault > Add new secret) com os nomes:
--   - edge_url             ex: https://kvdwmgchtpdnllxwswtf.supabase.co
--   - service_role_key     a sb_secret_... do projeto
--
-- O trigger `trg_notifications_dispatch_push` eh recriado para ler
-- direto do Vault.
-- ============================================================================

BEGIN;

-- 1. Habilita Vault (idempotente)
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- 2. Recria a funcao do trigger lendo do Vault
CREATE OR REPLACE FUNCTION trg_notifications_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $func$
DECLARE
  v_url         text;
  v_service_key text;
BEGIN
  -- Le do Vault (decrypted_secrets eh uma view exposta pela extension).
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'edge_url'
   LIMIT 1;

  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  IF v_url IS NULL OR v_service_key IS NULL THEN
    -- Sem config no Vault: nao dispara push (notif ainda chega via realtime).
    RETURN NEW;
  END IF;

  -- Ignora notificacoes "barulhentas" (frete_like_*)
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
  RAISE WARNING 'Push dispatch failed: %', SQLERRM;
  RETURN NEW;
END;
$func$;

-- Trigger ja existe da migration 042; nao precisa recriar.

COMMIT;

/*
-- VERIFY (depois de criar os secrets):
SELECT name FROM vault.decrypted_secrets WHERE name IN ('edge_url', 'service_role_key');
*/
