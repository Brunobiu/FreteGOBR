-- =====================================================
-- Migration 064: Aceite obrigatório dos Termos (legal-aceite-termos / Feature 2)
--
-- Entrega:
--   1. Colunas `terms_accepted_at` (timestamptz) e `terms_version` (text) em
--      public.users — ambas nullable (contas legadas ficam NULL).
--   2. Trigger BEFORE INSERT `users_set_terms_accepted_at`: quando o INSERT traz
--      `terms_version` não-nulo, o servidor carimba `terms_accepted_at = now()`
--      (fonte confiável de tempo — Req 2.5), ignorando qualquer valor que o
--      cliente tente enviar nessa coluna.
--
-- O timestamp do aceite é SEMPRE do servidor. A app (src/services/auth.ts)
-- envia apenas `terms_version = currentLegalVersion()` no mesmo INSERT que cria
-- o usuário, garantindo a invariante "nenhuma conta nova sem registro de aceite".
--
-- Idempotente. Par _rollback.sql documentado.
-- =====================================================

BEGIN;

-- ========== 0. Pré-checks defensivos ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela public.users ausente.';
  END IF;
END
$check$;

-- ========== 1. Colunas de aceite ==========
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version     text;

COMMENT ON COLUMN public.users.terms_accepted_at IS
  'Instante UTC do aceite dos Termos/Privacidade (LGPD), definido pelo servidor. NULL = conta legada.';
COMMENT ON COLUMN public.users.terms_version IS
  'Versao dos documentos aceita (currentLegalVersion: terms@<v>|privacy@<v>). NULL = conta legada.';

-- ========== 2. Trigger: servidor carimba o timestamp do aceite ==========
CREATE OR REPLACE FUNCTION users_set_terms_accepted_at()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Quando a conta nova declara a versao aceita, o tempo do aceite e do
  -- servidor (nunca do cliente). Se nao ha versao, nao mexe (conta legada/
  -- fluxos que nao passam aceite).
  IF NEW.terms_version IS NOT NULL AND btrim(NEW.terms_version) <> '' THEN
    NEW.terms_accepted_at := now();
  ELSE
    -- Garante que ninguem grave um timestamp sem versao correspondente.
    NEW.terms_accepted_at := NULL;
  END IF;
  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION users_set_terms_accepted_at() IS
  'BEFORE INSERT em users: carimba terms_accepted_at=now() quando terms_version e fornecida (Feature 2 / 064).';

DROP TRIGGER IF EXISTS users_set_terms_accepted_at ON public.users;
CREATE TRIGGER users_set_terms_accepted_at
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION users_set_terms_accepted_at();

COMMIT;

-- ========== VERIFY (smoke test manual) ==========
/*
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name='users' AND column_name IN ('terms_accepted_at','terms_version');

SELECT tgname FROM pg_trigger WHERE tgname='users_set_terms_accepted_at';
*/
