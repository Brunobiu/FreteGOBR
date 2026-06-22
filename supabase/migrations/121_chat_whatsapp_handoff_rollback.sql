-- 121_chat_whatsapp_handoff_rollback.sql
-- ---------------------------------------------------------------------------
-- Rollback da migration 121. Documentacao — NAO aplicada automaticamente.
--
-- Remove a RPC de estado da conversa. A coluna `embarcadores.whatsapp` NAO e
-- removida de proposito: a aplicacao ja a utiliza (perfil do embarcador) desde
-- antes desta migration; derruba-la quebraria o app. Remova manualmente apenas
-- se tiver certeza de que nada mais depende dela.
-- ---------------------------------------------------------------------------

BEGIN;

DROP FUNCTION IF EXISTS public.get_conversation_chat_state(uuid);

-- Intencionalmente NAO removido (dependencia da aplicacao):
-- ALTER TABLE public.embarcadores DROP COLUMN IF EXISTS whatsapp;

COMMIT;
