-- 085_embarcador_public_card_rollback.sql
-- Reverte 085: remove a RPC publica do cartao do embarcador.
-- Documentacao, nao auto-aplicada.

BEGIN;

DROP FUNCTION IF EXISTS public.get_embarcador_public_card(uuid);

COMMIT;
