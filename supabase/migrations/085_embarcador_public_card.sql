-- 085_embarcador_public_card.sql
-- ---------------------------------------------------------------------------
-- Cartao publico do embarcador para o modal de frete (lado do motorista).
--
-- PROBLEMA: a policy `users_select_policy` so permite `auth.uid() = id`, entao
-- um motorista logado NAO consegue ler `users.name` / `users.profile_photo_url`
-- do embarcador dono do frete. O join `users!inner(name)` em
-- `getEmbarcadorProfile` era eliminado pelo RLS e a funcao retornava NULL,
-- caindo no fallback "Detalhes do Frete" no cabecalho do modal.
--
-- SOLUCAO: RPC SECURITY DEFINER que devolve APENAS os campos publicos do
-- embarcador (nome da pessoa, foto de perfil, empresa, logo, filial). Nunca
-- expoe email, telefone, cnpj, senha ou qualquer dado sensivel. Exige usuario
-- autenticado (motorista/embarcador/admin).
-- ---------------------------------------------------------------------------

BEGIN;

-- Validacao defensiva: dependencias da foundation.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'embarcadores'
  ) THEN
    RAISE EXCEPTION 'Tabela embarcadores ausente: aplicar migrations base primeiro';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION public.get_embarcador_public_card(p_embarcador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_row    record;
BEGIN
  -- Exige autenticacao: o cartao so aparece para usuarios logados (o motorista
  -- ja precisa estar logado para abrir o detalhe do frete).
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT
    e.id,
    e.company_name,
    e.company_logo_url,
    e.branch_state,
    e.branch_city,
    u.name              AS user_name,
    u.profile_photo_url AS profile_photo_url
  INTO v_row
  FROM embarcadores e
  JOIN users u ON u.id = e.id
  WHERE e.id = p_embarcador_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'company_name', v_row.company_name,
    'company_logo_url', v_row.company_logo_url,
    'branch_state', v_row.branch_state,
    'branch_city', v_row.branch_city,
    'user_name', v_row.user_name,
    'profile_photo_url', v_row.profile_photo_url
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.get_embarcador_public_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_embarcador_public_card(uuid) TO authenticated;

COMMIT;

-- VERIFY (smoke test manual):
/*
SELECT public.get_embarcador_public_card('4475d264-2271-4f74-ac84-4d07f0480a72');
*/
