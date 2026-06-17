-- ============================================================================
-- ROLLBACK da Migration 107 — Campaign_History (task 11.4)
-- ----------------------------------------------------------------------------
-- Documentacao de reversao (NAO auto-aplicada). Desfaz APENAS as 3 funcoes
-- criadas pela 107, na ORDEM INVERSA da criacao, preservando integralmente:
--   * o schema/tabelas da 092 (whatsapp foundation): whatsapp_dispatch_jobs,
--     whatsapp_dispatch_recipients, whatsapp_contents, whatsapp_content_media,
--     whatsapp_group_dispatches — a 107 NAO cria tabelas, apenas le/copia linhas;
--   * as guardas reusadas (`whatsapp_require_permission`, `whatsapp_assert_instance`
--     da 092) — a 107 NAO as cria nem altera, logo este rollback NAO as toca;
--   * quaisquer Dispatch_Jobs/Contents/Recipients ja persistidos — inclusive os
--     novos jobs gerados por `whatsapp_duplicate_campaign` (DUPLICATE/REUSE/
--     RESEND): reverter a RPC nao apaga os jobs que ela ja criou.
--
-- Os REVOKE/GRANT de cada funcao somem junto com o respectivo DROP FUNCTION.
-- Idempotente: DROP FUNCTION IF EXISTS com as assinaturas exatas da 107.
--
-- Ordem inversa da 107:
--   3) whatsapp_duplicate_campaign(uuid, uuid, text)
--   2) whatsapp_get_campaign_detail(uuid, uuid)
--   1) whatsapp_list_campaign_history(uuid, text, int, int)
-- ============================================================================

BEGIN;

-- (3) ESCRITA: Duplicar/Reenviar/Reutilizar como nova.
DROP FUNCTION IF EXISTS whatsapp_duplicate_campaign(uuid, uuid, text);

-- (2) LEITURA: detalhe escopado por instancia.
DROP FUNCTION IF EXISTS whatsapp_get_campaign_detail(uuid, uuid);

-- (1) LEITURA: listagem do Campaign_History.
DROP FUNCTION IF EXISTS whatsapp_list_campaign_history(uuid, text, int, int);

COMMIT;
