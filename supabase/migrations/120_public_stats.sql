-- ============================================================================
-- Migration 120: public_stats — métricas públicas da landing
-- ============================================================================
-- Expõe contagens agregadas (sem PII) para a página inicial pública:
--   - fretes:       total de fretes ativos (status = 'ativo')
--   - motoristas:   total de usuários com user_type = 'motorista'
--   - embarcadores: total de usuários com user_type = 'embarcador'
--
-- RPC SECURITY DEFINER liberada para `anon` porque a landing é pública
-- (pré-login). Retorna APENAS números agregados — nenhum dado individual
-- é exposto, então o acesso anônimo é seguro (mesmo racional de
-- `is_blacklisted` pré-signup).
--
-- IDEMPOTENTE: aplicar 2x não falha nem duplica objetos.
-- Par rollback documentado em 120_public_stats_rollback.sql.
-- ============================================================================

BEGIN;

-- Validações defensivas (aborta se o schema esperado não existir)
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_type'
  ) THEN
    RAISE EXCEPTION 'users.user_type ausente — schema inesperado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fretes'
  ) THEN
    RAISE EXCEPTION 'tabela fretes ausente — migration 001 não aplicada';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION public_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT jsonb_build_object(
    'fretes',       (SELECT COUNT(*) FROM fretes WHERE status = 'ativo'),
    'motoristas',   (SELECT COUNT(*) FROM users WHERE user_type = 'motorista'),
    'embarcadores', (SELECT COUNT(*) FROM users WHERE user_type = 'embarcador')
  );
$func$;

-- Acesso público (landing pré-login): só contagens agregadas, sem PII.
REVOKE ALL ON FUNCTION public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_stats() TO anon, authenticated;

COMMIT;

-- VERIFY (manual):
/*
SELECT public_stats();
-- Esperado: { "fretes": N, "motoristas": N, "embarcadores": N }
*/
