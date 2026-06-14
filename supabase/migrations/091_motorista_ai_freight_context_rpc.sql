-- 091_motorista_ai_freight_context_rpc.sql
-- ---------------------------------------------------------------------------
-- (1) Libera 'openai' no constraint de active_provider do assistant_config.
-- (2) Cria a RPC `motorista_ai_freight_context` que retorna o contexto do
--     motorista (km/l, diesel, capacidade, localizacao) + fretes ativos com
--     coordenadas extraidas do PostGIS. Usada pela Edge Function
--     `motorista-ai-chat` para montar o contexto enviado a IA.
-- ---------------------------------------------------------------------------

BEGIN;

-- (1) Permitir 'openai' como provider
ALTER TABLE public.assistant_config
  DROP CONSTRAINT IF EXISTS assistant_config_active_provider_check;

ALTER TABLE public.assistant_config
  ADD CONSTRAINT assistant_config_active_provider_check
  CHECK (active_provider = ANY (ARRAY['claude'::text, 'gemini'::text, 'grok'::text, 'llama'::text, 'openai'::text]));

-- (2) RPC de contexto de fretes do motorista
CREATE OR REPLACE FUNCTION public.motorista_ai_freight_context(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_motorista jsonb;
  v_fretes jsonb;
BEGIN
  SELECT jsonb_build_object(
    'km_per_liter', m.km_per_liter,
    'diesel_price', m.diesel_price,
    'cargo_capacity_ton', m.cargo_capacity_ton,
    'lat', CASE WHEN m.location IS NOT NULL THEN ST_Y(m.location::geometry) ELSE NULL END,
    'lng', CASE WHEN m.location IS NOT NULL THEN ST_X(m.location::geometry) ELSE NULL END
  )
  INTO v_motorista
  FROM public.motoristas m
  WHERE m.id = p_user_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id', f.id,
    'origin', f.origin,
    'destination', f.destination,
    'origin_lat', CASE WHEN f.origin_location IS NOT NULL THEN ST_Y(f.origin_location::geometry) ELSE NULL END,
    'origin_lng', CASE WHEN f.origin_location IS NOT NULL THEN ST_X(f.origin_location::geometry) ELSE NULL END,
    'destination_lat', CASE WHEN f.destination_location IS NOT NULL THEN ST_Y(f.destination_location::geometry) ELSE NULL END,
    'destination_lng', CASE WHEN f.destination_location IS NOT NULL THEN ST_X(f.destination_location::geometry) ELSE NULL END,
    'distance_km', f.distance_km,
    'value', f.value,
    'product', COALESCE(f.product, f.cargo_type),
    'weight', f.weight,
    'vehicle_type', f.vehicle_type
  ))
  INTO v_fretes
  FROM public.fretes f
  WHERE f.status = 'ativo';

  RETURN jsonb_build_object(
    'motorista', v_motorista,
    'fretes', COALESCE(v_fretes, '[]'::jsonb)
  );
END;
$func$;

-- Bloqueio explicito: a RPC aceita p_user_id arbitrario e roda como
-- SECURITY DEFINER, entao SO o service_role (Edge Function) pode chama-la.
-- anon/authenticated nao podem, evitando leitura cruzada de dados.
REVOKE ALL ON FUNCTION public.motorista_ai_freight_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.motorista_ai_freight_context(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.motorista_ai_freight_context(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.motorista_ai_freight_context(uuid) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- (3) Inclui 'openai' no dominio fechado das RPCs do admin-assistant (047):
--     rpc_assistant_get_config (provider_keys), rpc_assistant_update_config
--     (activeProvider), rpc_assistant_set_secret, rpc_assistant_clear_secret
--     e rpc_assistant_read_provider_key. Sem isso a UI quebra (openai key
--     vem undefined) e nao e possivel salvar a chave nem ativar o provider.
--     Aplicado em producao via apply_migration; corpo completo das funcoes
--     esta em 047_admin_assistant.sql + esta extensao do dominio.
-- ---------------------------------------------------------------------------
