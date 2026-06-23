-- ============================================================================
-- Script: Popular 200 fretes de demonstração espalhados pelo Brasil (dev)
-- ============================================================================
-- Gera 200 fretes diversificados em ~57 cidades de todas as regiões do país.
--
--   * Rotas variadas (curtas, médias e longas) montadas por combinação
--     pseudo-aleatória + algumas rotas "vizinhas" curtas garantidas.
--   * Valor proporcional à distância: perto = mais barato, longe = mais caro
--     (value ≈ distância_km * tarifa/km, tarifa entre R$ 3,00 e R$ 5,70).
--   * Distância calculada de verdade pelo PostGIS (ST_Distance) com fator 1.2
--     para aproximar a distância rodoviária.
--   * Produtos alinhados às commodity_categories (Soja, Milho, Açúcar, ...),
--     então os fretes aparecem ao filtrar pelo carrossel do motorista.
--   * Distribui os fretes em rodízio entre TODOS os embarcadores existentes
--     (qualquer embarcador serve). Se não houver nenhum, aborta com aviso.
--
-- Cada `value` é único por construção (bucket de 10 + i*0,01), então não há
-- colisão com o índice de dedup uq_fretes_dedup_active (Migration 061).
--
-- IDENTIFICÁVEL: todos têm specifications começando com
-- 'Frete demo (lote de testes)'. Para limpar depois, rode:
--   DELETE FROM fretes WHERE specifications LIKE 'Frete demo (lote de testes)%';
--
-- OBS: rodar duas vezes vai gerar erro de dedup (valores determinísticos
-- repetem). Limpe o lote anterior antes de rodar de novo.
-- ============================================================================

BEGIN;

-- Guarda: precisa existir ao menos um embarcador.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM embarcadores) THEN
    RAISE EXCEPTION 'Nenhum embarcador cadastrado. Crie ao menos um embarcador antes de rodar este seed.';
  END IF;
END
$guard$;

WITH consts AS (
  SELECT
    ARRAY[
      'São Paulo','Campinas','Santos','Ribeirão Preto','São José do Rio Preto',
      'Rio de Janeiro','Campos dos Goytacazes','Belo Horizonte','Uberlândia','Juiz de Fora',
      'Vitória','Curitiba','Londrina','Maringá','Cascavel','Florianópolis','Joinville',
      'Chapecó','Porto Alegre','Caxias do Sul','Passo Fundo','Pelotas','Santa Maria',
      'Goiânia','Rio Verde','Brasília','Campo Grande','Dourados','Cuiabá','Rondonópolis',
      'Sinop','Sorriso','Salvador','Feira de Santana','Vitória da Conquista','Barreiras',
      'Recife','Petrolina','Fortaleza','Juazeiro do Norte','Natal','João Pessoa','Maceió',
      'Aracaju','Teresina','São Luís','Imperatriz','Belém','Santarém','Marabá','Manaus',
      'Porto Velho','Rio Branco','Boa Vista','Macapá','Palmas','Araguaína'
    ]::text[] AS c_nome,
    ARRAY[
      'SP','SP','SP','SP','SP','RJ','RJ','MG','MG','MG','ES','PR','PR','PR','PR','SC','SC',
      'SC','RS','RS','RS','RS','RS','GO','GO','DF','MS','MS','MT','MT','MT','MT','BA','BA',
      'BA','BA','PE','PE','CE','CE','RN','PB','AL','SE','PI','MA','MA','PA','PA','PA','AM',
      'RO','AC','RR','AP','TO','TO'
    ]::text[] AS c_uf,
    ARRAY[
      -23.5505,-22.9099,-23.9608,-21.1775,-20.8197,-22.9068,-21.7545,-19.9167,-18.9186,
      -21.7642,-20.3155,-25.4284,-23.3045,-23.4205,-24.9555,-27.5949,-26.3045,-27.1004,
      -30.0346,-29.1678,-28.2576,-31.7654,-29.6842,-16.6869,-17.7975,-15.7939,-20.4697,
      -22.2231,-15.6014,-16.4673,-11.8642,-12.5450,-12.9777,-12.2664,-14.8615,-12.1528,
      -8.0476,-9.3891,-3.7319,-7.2130,-5.7945,-7.1195,-9.6498,-10.9472,-5.0892,-2.5391,
      -5.5264,-1.4558,-2.4431,-5.3686,-3.1190,-8.7619,-9.9747,2.8235,0.0349,-10.1840,-7.1911
    ]::double precision[] AS c_lat,
    ARRAY[
      -46.6333,-47.0626,-46.3336,-47.8103,-49.3794,-43.1729,-41.3244,-43.9345,-48.2772,
      -43.3496,-40.3128,-49.2733,-51.1696,-51.9331,-53.4552,-48.5482,-48.8487,-52.6152,
      -51.2177,-51.1794,-52.4091,-52.3376,-53.8069,-49.2648,-50.9266,-47.8828,-54.6201,
      -54.8120,-56.0979,-54.6372,-55.5025,-55.7110,-38.5016,-38.9663,-40.8442,-44.9900,
      -34.8770,-40.5030,-38.5267,-39.3153,-35.2110,-34.8450,-35.7089,-37.0731,-42.8019,
      -44.2829,-47.4917,-48.4902,-54.7083,-49.1178,-60.0217,-63.9039,-67.8100,-60.6758,
      -51.0694,-48.3336,-48.2070
    ]::double precision[] AS c_lng,
    ARRAY[
      'Soja','Milho','Açúcar','Trigo','Fertilizante','Farelo de Soja','Farelo de Milho',
      'Calcário','Cevada','Sementes','Defensivo agrícola','Maquinário agrícola',
      'Pluma de Algodão','Agrotóxico'
    ]::text[] AS products,
    ARRAY[
      'soja','milho','acucar','trigo','fertilizante','farelo-de-soja','farelo-de-milho',
      'calcario','cevada','semente','defensivo','maquinario','pluma-de-algodao','agrotoxico'
    ]::text[] AS slugs,
    ARRAY[
      'Granel sólido','Granel sólido','Granel sólido','Granel sólido','Granel sólido',
      'Granel sólido','Granel sólido','Granel sólido','Granel sólido','Carga Geral',
      'Perigosa','Carga Geral','Carga Geral','Perigosa'
    ]::text[] AS cargo_types,
    ARRAY[
      'Granel','Granel','Sacos','Granel','Big Bag','Granel','Granel','Granel','Granel',
      'Sacos','Caixas','Unidades','Fardos','Tambor'
    ]::text[] AS species,
    ARRAY[
      'carreta_truck_5_eixos_40t','bi_trem_9_eixos_74t','carreta_truck_5_eixos_40t',
      'graneleiro_semi_reboque_6_eixos_40t','caminhao_truck_6x2_23t','rodotrem_9_eixos_74t',
      'bi_trem_9_eixos_74t','caminhao_4_eixos_31_5t','carreta_truck_5_eixos_40t',
      'caminhao_truck_6x2_23t','caminhao_3_4_2_eixos_16t','carreta_truck_5_eixos_40t',
      'carreta_ls_truck_6_eixos_48_5t','carreta_truck_5_eixos_40t'
    ]::text[] AS vehicles,
    ARRAY[
      'graneleiro','graneleiro','graneleiro','graneleiro','graneleiro','graneleiro',
      'graneleiro','cacamba_basculante','graneleiro','bau_carga_seca','bau_carga_seca',
      'prancha','sider','sider'
    ]::text[] AS bodies
),
emb AS (
  SELECT array_agg(id ORDER BY created_at) AS ids, count(*)::int AS m
  FROM embarcadores
),
raw AS (
  SELECT g.i AS i,
         (g.i * 7) % 57          AS o0,     -- origem 0-based
         1 + ((g.i * 13) % 56)   AS step    -- passo 1..56 (garante destino != origem)
  FROM generate_series(1, 200) AS g(i)
),
seq AS (
  SELECT i,
         o0 + 1 AS o1,
         CASE
           WHEN i % 5 = 0 THEN ((o0 + 1) % 57) + 1    -- rota "vizinha" curta garantida
           ELSE ((o0 + step) % 57) + 1                -- rota variada
         END AS d1,
         ((i - 1) % 14) + 1 AS p1
  FROM raw
),
geo AS (
  SELECT s.i, s.o1, s.d1, s.p1,
         ST_SetSRID(ST_MakePoint(k.c_lng[s.o1], k.c_lat[s.o1]), 4326)::geography AS o_geo,
         ST_SetSRID(ST_MakePoint(k.c_lng[s.d1], k.c_lat[s.d1]), 4326)::geography AS d_geo
  FROM seq s CROSS JOIN consts k
),
metrics AS (
  SELECT i, o1, d1, p1,
         GREATEST(40, round((ST_Distance(o_geo, d_geo) / 1000.0) * 1.2)::int) AS dist_km
  FROM geo
),
final AS (
  SELECT m.*, (3.0 + ((m.i % 10) * 0.3))::numeric AS rate
  FROM metrics m
)
INSERT INTO fretes (
  embarcador_id, origin, origin_location, destination, destination_location,
  cargo_type, cargo_species, product, product_slug, vehicle_type, body_types,
  weight, weight_unit, value, deadline, loading_time, unloading_time,
  specifications, freight_type, occupancy_percentage, payment_methods,
  price_calculation, advance_percentage, value_known,
  requires_lona, requires_tracker, requires_insurance,
  onu_number, distance_km, status, source
)
SELECT
  emb.ids[1 + ((f.i - 1) % emb.m)],
  k.c_nome[f.o1] || ', ' || k.c_uf[f.o1],
  ST_SetSRID(ST_MakePoint(k.c_lng[f.o1], k.c_lat[f.o1]), 4326)::geography,
  k.c_nome[f.d1] || ', ' || k.c_uf[f.d1],
  ST_SetSRID(ST_MakePoint(k.c_lng[f.d1], k.c_lat[f.d1]), 4326)::geography,
  k.cargo_types[f.p1],
  k.species[f.p1],
  k.products[f.p1],
  k.slugs[f.p1],
  k.vehicles[f.p1],
  k.bodies[f.p1],
  round((8 + (f.i % 28) + ((f.i % 4) * 0.5))::numeric, 2),                 -- peso 8..37 t
  'toneladas',
  round(GREATEST(round((f.dist_km * f.rate) / 10.0) * 10, 350) + (f.i * 0.01), 2), -- valor único
  CURRENT_DATE + ((f.i % 25) + 4),                                        -- prazo 4..28 dias
  30 + ((f.i % 6) * 15),                                                  -- carregamento (min)
  30 + ((f.i % 5) * 20),                                                  -- descarga (min)
  'Frete demo (lote de testes) — ' || k.products[f.p1] || ' de ' ||
    k.c_nome[f.o1] || '/' || k.c_uf[f.o1] || ' para ' ||
    k.c_nome[f.d1] || '/' || k.c_uf[f.d1] || '.',
  CASE WHEN f.i % 7 = 0 THEN 'complemento' ELSE 'completa' END,
  CASE WHEN f.i % 7 = 0 THEN 50 + ((f.i % 5) * 10) ELSE NULL END,
  (ARRAY['Pix/Ted','Pix','Depósito em conta','Pix/Ted, E-frete','E-frete'])[1 + (f.i % 5)],
  (ARRAY['total','toneladas'])[1 + (f.i % 2)],
  20 + ((f.i % 4) * 10),
  true,
  (f.i % 5 = 0),
  (f.i % 3 = 0),
  (f.i % 4 = 0),
  CASE WHEN k.cargo_types[f.p1] = 'Perigosa'
       THEN (ARRAY['1993','3082','1202','1830'])[1 + (f.i % 4)]
       ELSE NULL END,
  f.dist_km,
  'ativo',
  'embarcador'
FROM final f CROSS JOIN consts k CROSS JOIN emb;

COMMIT;

-- ============================================================================
-- CONFERÊNCIA
-- ============================================================================
-- Total inserido
SELECT count(*) AS total_fretes_demo
  FROM fretes
 WHERE specifications LIKE 'Frete demo (lote de testes)%';

-- Amostra: 15 mais curtos/baratos
SELECT origin, '→' AS arrow, destination, distance_km, value, product, vehicle_type
  FROM fretes
 WHERE specifications LIKE 'Frete demo (lote de testes)%'
 ORDER BY distance_km ASC
 LIMIT 15;

-- Amostra: 15 mais longos/caros
SELECT origin, '→' AS arrow, destination, distance_km, value, product, vehicle_type
  FROM fretes
 WHERE specifications LIKE 'Frete demo (lote de testes)%'
 ORDER BY distance_km DESC
 LIMIT 15;
