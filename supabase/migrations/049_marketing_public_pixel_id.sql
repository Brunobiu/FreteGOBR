-- ============================================================================
-- Migration 049: Leitura PUBLICA do pixel_id de marketing_config (Pixel_Loader)
-- ============================================================================
-- Adiciona um unico caminho de leitura ANONIMA-SEGURO que expoe EXCLUSIVAMENTE
-- o pixel_id (nao-sensivel) da config vigente de marketing, para alimentar o
-- getPixelId() do Pixel_Loader montado no site PUBLICO (admin-marketing 048,
-- Epico 7 -- task 7.4, Req 8.7, 8.8).
--
-- DEPENDENCIAS:
--   - 048 admin_marketing (tabela marketing_config single-row, coluna pixel_id
--                          com CHECK ~ '^[0-9]+$').
--
-- POR QUE UMA RPC PUBLICA DEDICADA (decisao de seguranca):
--   A RPC marketing_config_get() (048) e GATED por MARKETING_VIEW: so admins
--   autenticados podem le-la, e ela retorna a config inteira (ad_account_id,
--   default_period, consent_required, token_is_set, token_last4, ...). O site
--   PUBLICO precisa do pixel_id para visitantes ANONIMOS (Req 8.8), mas NAO
--   pode receber nenhum outro campo administrativo. Em vez de afrouxar a RPC
--   existente, adicionamos uma funcao minima que devolve SOMENTE o pixel_id.
--
--   O pixel_id NAO e segredo: ele e embutido no HTML/JS entregue ao navegador
--   de qualquer forma quando o Pixel carrega. O Meta_Access_Token (segredo)
--   permanece exclusivamente no Vault e NUNCA e exposto por esta funcao nem por
--   qualquer caminho client-side (CP-7).
--
-- POSTURE (admin-patterns Sec. 10): SECURITY DEFINER, SET search_path = public.
--   Esta e uma das EXCECOES explicitamente suportadas sem login (espelha
--   is_blacklisted da 035, granted a anon): o caso de uso (Pixel do site
--   publico) e anonimo por design (Req 8.8). Sem gating por permissao, sem
--   leitura de PII, sem mutacao. STABLE (apenas le).
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION; reaplicar 2x nao falha nem duplica.
-- ROLLBACK: 049_marketing_public_pixel_id_rollback.sql (nao auto-aplicado).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Validacao defensiva (ver admin-patterns.md Sec. 9)
-- ============================================================================
-- A 048 (admin-marketing) precisa estar aplicada: marketing_config + pixel_id.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketing_config'
      AND column_name = 'pixel_id'
  ) THEN
    RAISE EXCEPTION 'Migration 048 (admin-marketing) nao aplicada: marketing_config.pixel_id ausente';
  END IF;
END
$check$;


-- ============================================================================
-- 2. RPC marketing_public_pixel_id(): leitura anonima-segura do pixel_id
-- ============================================================================
-- Retorna SOMENTE o pixel_id da linha singleton de marketing_config, ou NULL
-- quando a integracao ainda nao foi configurada (nesse caso o Pixel_Loader nao
-- injeta o script -- Req 8.7). NUNCA expoe token, token_secret_id,
-- ad_account_id, nem qualquer outro campo (CP-7). Sem auth check: e PUBLICA por
-- design (Req 8.8). Espelha o padrao anon-safe de is_blacklisted (035).
CREATE OR REPLACE FUNCTION marketing_public_pixel_id()
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT pixel_id
  FROM marketing_config
  WHERE singleton = true
  LIMIT 1;
$func$;

REVOKE ALL ON FUNCTION marketing_public_pixel_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_public_pixel_id() TO anon, authenticated;

COMMENT ON FUNCTION marketing_public_pixel_id()
  IS 'RPC STABLE SECURITY DEFINER PUBLICA (anon + authenticated) que retorna SOMENTE o pixel_id (nao-sensivel) de marketing_config, para o Pixel_Loader do site publico (Req 8.7, 8.8). NUNCA expoe token/ad_account/demais campos (CP-7). Sem gating por permissao -- caso de uso anonimo por design (espelha is_blacklisted da 035). admin-marketing 048 / 049.';


COMMIT;


-- ============================================================================
-- VERIFY (smoke test manual; permanentemente comentado)
-- ============================================================================
/*
-- (a) Funcao existe e e SECURITY DEFINER:
SELECT proname, prosecdef
  FROM pg_proc
 WHERE proname = 'marketing_public_pixel_id';

-- (b) Grants corretos (anon + authenticated, sem PUBLIC):
SELECT grantee, privilege_type
  FROM information_schema.role_routine_grants
 WHERE routine_name = 'marketing_public_pixel_id';

-- (c) Retorna apenas o pixel_id da config vigente (text ou NULL):
SELECT marketing_public_pixel_id();
*/
