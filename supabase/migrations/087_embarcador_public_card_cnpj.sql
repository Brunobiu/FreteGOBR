-- 087_embarcador_public_card_cnpj.sql
-- ---------------------------------------------------------------------------
-- Inclui o CNPJ da empresa no cartao publico do embarcador (modal do frete).
-- O motorista ve "<Empresa> — <CNPJ>" ao lado do nome. Continua expondo APENAS
-- dados publicos (nome, foto, empresa, logo, CNPJ, filial); nada de email,
-- telefone ou senha.
-- ---------------------------------------------------------------------------

BEGIN;

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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT
    e.id,
    e.company_name,
    e.company_logo_url,
    e.cnpj,
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
    'cnpj', v_row.cnpj,
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
