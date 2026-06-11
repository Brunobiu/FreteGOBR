-- ============================================================================
-- ROLLBACK da Migration 084: Admin Settings
-- ============================================================================
-- Documentacao de reversao. NAO e auto-aplicado.
--
-- ATENCAO: segredos gravados no Vault (vault.secrets com nome
-- 'platform_setting:*') NAO sao removidos automaticamente aqui. Caso queira
-- elimina-los, remova-os manualmente no Vault (Dashboard > Project Settings >
-- Vault) ou via:
--   DELETE FROM vault.secrets WHERE name LIKE 'platform_setting:%';
--
-- Ordem reversa de dependencia: RPCs -> policy -> indice -> tabela.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS app_get_setting_secret(text);
DROP FUNCTION IF EXISTS admin_settings_secret_clear(text, timestamptz);
DROP FUNCTION IF EXISTS admin_settings_secret_set(text, text, timestamptz);
DROP FUNCTION IF EXISTS admin_settings_update(text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS admin_settings_get();

DROP POLICY IF EXISTS platform_settings_no_dml ON platform_settings;
DROP INDEX IF EXISTS idx_platform_settings_category;
DROP TABLE IF EXISTS platform_settings;

COMMIT;
