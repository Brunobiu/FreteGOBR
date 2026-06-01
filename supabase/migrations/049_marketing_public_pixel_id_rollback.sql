-- ============================================================================
-- ROLLBACK Migration 049: marketing_public_pixel_id
--
-- DOCUMENTACAO APENAS — NAO E AUTO-APLICADO.
-- (As migrations *_rollback.sql nao entram no pipeline de apply automatico do
--  Supabase / CI: o push aplica apenas arquivos cujo nome casa com
--  ^[0-9]+_<nome>\.sql -- o sufixo "_rollback" mantem este script fora do
--  pipeline. Por isso o numero "049" aqui so indica a migration que ele
--  reverte; nao ocupa um slot proprio na sequencia.)
--
-- Reverte a 049_marketing_public_pixel_id.sql: dropa a RPC publica
-- marketing_public_pixel_id(). NAO toca em marketing_config nem em qualquer
-- objeto da 048.
--
-- IMPACTO: apos o drop, o Pixel_Loader do site publico perde a fonte de
-- pixel_id via banco. O fallback de build (env VITE_META_PIXEL_ID, ver
-- src/services/marketing/pixelId.ts) continua funcionando se configurado;
-- caso contrario getPixelId() passa a retornar null e o Pixel nao injeta o
-- script (degradacao segura -- Req 8.7).
--
-- Idempotente: DROP FUNCTION IF EXISTS pode ser reexecutado sem erro.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS marketing_public_pixel_id();

COMMIT;


-- ============================================================================
-- VERIFY (apos rollback; permanentemente comentado)
-- ============================================================================
/*
-- Funcao removida: deve retornar 0 linhas.
SELECT proname FROM pg_proc WHERE proname = 'marketing_public_pixel_id';
*/
