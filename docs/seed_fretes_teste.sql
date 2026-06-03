-- ============================================================================
-- SEED de fretes ficticios para teste
-- ============================================================================
-- Apaga TODOS os fretes existentes e insere 54 novos:
--  - 2 por estado do Brasil (27 UFs)
--  - 1 frete CURTO (intra-estadual ou cidade vizinha)
--  - 1 frete LONGO (interestadual de longa distancia)
--  - Produtos rotacionando entre as categorias ativas em
--    commodity_categories
--  - Coordenadas reais das capitais e cidades grandes
--  - Status 'ativo'
--
-- Como usar:
--  1. Abra o Supabase Dashboard -> SQL Editor
--  2. Cole TODO este script
--  3. Clique em Run
--
-- O script usa o PRIMEIRO embarcador do banco como owner. Se quiser
-- usar um embarcador especifico, troque a CTE `dono` na linha
-- correspondente.
--
-- Idempotencia: o DELETE no inicio garante que nao acumula. Rodar de
-- novo simplesmente reseta os 54 fretes.
-- ============================================================================

BEGIN;

-- Apaga TUDO de fretes (inclusive frete_clicks via CASCADE).
DELETE FROM fretes;

-- Funcao auxiliar local (CTE) que pega o primeiro embarcador.
-- Adapta automaticamente ao banco em qualquer ambiente.
WITH dono AS (
  SELECT id AS embarcador_id FROM embarcadores ORDER BY created_at LIMIT 1
),
-- Lista de produtos canonicos (slugs vindos da migration 039 +
-- aliases que voce pode ter adicionado depois).
produtos AS (
  SELECT slug, name FROM commodity_categories WHERE is_active = true
)

-- 54 fretes: 2 por UF, alternando produtos.
INSERT INTO fretes (
  embarcador_id, origin, origin_location, destination, destination_location,
  cargo_type, vehicle_type, weight, value, deadline,
  loading_time, unloading_time, status, product, product_slug,
  cargo_species, distance_km, body_types, payment_methods,
  freight_type, weight_unit, value_known, requires_lona,
  requires_tracker, requires_insurance
)
SELECT
  (SELECT embarcador_id FROM dono),
  f.origin,
  ST_GeogFromText('SRID=4326;POINT(' || f.origin_lng || ' ' || f.origin_lat || ')'),
  f.destination,
  ST_GeogFromText('SRID=4326;POINT(' || f.dest_lng || ' ' || f.dest_lat || ')'),
  'Carga Geral',
  'caminhao_truck_6x2_23t, carreta_simples_truck_4_eixos_33t',
  f.weight,
  f.value,
  CURRENT_DATE + INTERVAL '7 days',
  60, 60, 'ativo',
  p.name,
  p.slug,
  'Granel',
  f.distance_km,
  'graneleiro',
  'Pix/Ted, Depósito em conta',
  'completa',
  'toneladas',
  true,
  CASE WHEN f.idx % 3 = 0 THEN true ELSE false END,
  CASE WHEN f.idx % 4 = 0 THEN true ELSE false END,
  CASE WHEN f.idx % 5 = 0 THEN true ELSE false END
FROM (
  VALUES
    -- ─── ACRE (AC) ─────────────────────────────────────────────────────
    (1,  'Rio Branco, AC',     -67.8243, -9.9747,  'Cruzeiro do Sul, AC', -72.6694, -7.6306,  640.0,    7500.0,  28.0),
    (2,  'Rio Branco, AC',     -67.8243, -9.9747,  'Manaus, AM',          -60.0212, -3.1190,  1450.0,   18000.0, 28.0),

    -- ─── ALAGOAS (AL) ──────────────────────────────────────────────────
    (3,  'Maceió, AL',         -35.7350, -9.6658,  'Arapiraca, AL',       -36.6614, -9.7528,  130.0,    2200.0,  25.0),
    (4,  'Maceió, AL',         -35.7350, -9.6658,  'São Paulo, SP',       -46.6388, -23.5505, 2380.0,   28000.0, 25.0),

    -- ─── AMAPA (AP) ────────────────────────────────────────────────────
    (5,  'Macapá, AP',         -51.0664, 0.0349,   'Santana, AP',         -51.1812, -0.0583,  20.0,     1200.0,  22.0),
    (6,  'Macapá, AP',         -51.0664, 0.0349,   'Belém, PA',           -48.5024, -1.4558,  600.0,    9000.0,  22.0),

    -- ─── AMAZONAS (AM) ─────────────────────────────────────────────────
    (7,  'Manaus, AM',         -60.0212, -3.1190,  'Itacoatiara, AM',     -58.4439, -3.1372,  270.0,    4500.0,  30.0),
    (8,  'Manaus, AM',         -60.0212, -3.1190,  'Boa Vista, RR',       -60.6753, 2.8198,   780.0,    11000.0, 30.0),

    -- ─── BAHIA (BA) ────────────────────────────────────────────────────
    (9,  'Salvador, BA',       -38.5023, -12.9714, 'Feira de Santana, BA',-38.9667, -12.2668, 110.0,    2000.0,  24.0),
    (10, 'Salvador, BA',       -38.5023, -12.9714, 'Brasília, DF',        -47.9292, -15.7801, 1450.0,   17000.0, 24.0),

    -- ─── CEARA (CE) ────────────────────────────────────────────────────
    (11, 'Fortaleza, CE',      -38.5267, -3.7172,  'Caucaia, CE',         -38.6531, -3.7361,  20.0,     1000.0,  22.0),
    (12, 'Fortaleza, CE',      -38.5267, -3.7172,  'Goiânia, GO',         -49.2532, -16.6864, 2300.0,   26000.0, 22.0),

    -- ─── DISTRITO FEDERAL (DF) ─────────────────────────────────────────
    (13, 'Brasília, DF',       -47.9292, -15.7801, 'Anápolis, GO',        -48.9531, -16.3267, 150.0,    2400.0,  30.0),
    (14, 'Brasília, DF',       -47.9292, -15.7801, 'Cuiabá, MT',          -56.0974, -15.6014, 1130.0,   14000.0, 30.0),

    -- ─── ESPIRITO SANTO (ES) ───────────────────────────────────────────
    (15, 'Vitória, ES',        -40.3128, -20.3155, 'Vila Velha, ES',      -40.2925, -20.3419, 12.0,     900.0,   25.0),
    (16, 'Vitória, ES',        -40.3128, -20.3155, 'Porto Alegre, RS',    -51.2177, -30.0346, 2050.0,   23000.0, 25.0),

    -- ─── GOIAS (GO) ────────────────────────────────────────────────────
    (17, 'Goiânia, GO',        -49.2532, -16.6864, 'Anápolis, GO',        -48.9531, -16.3267, 60.0,     1500.0,  28.0),
    (18, 'Goiânia, GO',        -49.2532, -16.6864, 'Recife, PE',          -34.8770, -8.0476,  2150.0,   25000.0, 28.0),

    -- ─── MARANHAO (MA) ─────────────────────────────────────────────────
    (19, 'São Luís, MA',       -44.3068, -2.5307,  'Imperatriz, MA',      -47.4925, -5.5258,  630.0,    8500.0,  26.0),
    (20, 'São Luís, MA',       -44.3068, -2.5307,  'Curitiba, PR',        -49.2718, -25.4284, 3060.0,   33000.0, 26.0),

    -- ─── MATO GROSSO (MT) ──────────────────────────────────────────────
    (21, 'Cuiabá, MT',         -56.0974, -15.6014, 'Várzea Grande, MT',   -56.1326, -15.6469, 12.0,     900.0,   30.0),
    (22, 'Cuiabá, MT',         -56.0974, -15.6014, 'Rio de Janeiro, RJ',  -43.1729, -22.9068, 2050.0,   24000.0, 30.0),

    -- ─── MATO GROSSO DO SUL (MS) ───────────────────────────────────────
    (23, 'Campo Grande, MS',   -54.6464, -20.4697, 'Dourados, MS',        -54.8051, -22.2211, 230.0,    3500.0,  28.0),
    (24, 'Campo Grande, MS',   -54.6464, -20.4697, 'Belo Horizonte, MG',  -43.9352, -19.9167, 1450.0,   17000.0, 28.0),

    -- ─── MINAS GERAIS (MG) ─────────────────────────────────────────────
    (25, 'Belo Horizonte, MG', -43.9352, -19.9167, 'Contagem, MG',        -44.0535, -19.9319, 22.0,     1100.0,  26.0),
    (26, 'Belo Horizonte, MG', -43.9352, -19.9167, 'Manaus, AM',          -60.0212, -3.1190,  3950.0,   42000.0, 26.0),

    -- ─── PARA (PA) ─────────────────────────────────────────────────────
    (27, 'Belém, PA',          -48.5024, -1.4558,  'Ananindeua, PA',      -48.3722, -1.3656,  20.0,     1000.0,  24.0),
    (28, 'Belém, PA',          -48.5024, -1.4558,  'Salvador, BA',        -38.5023, -12.9714, 1830.0,   21000.0, 24.0),

    -- ─── PARAIBA (PB) ──────────────────────────────────────────────────
    (29, 'João Pessoa, PB',    -34.8641, -7.1153,  'Campina Grande, PB',  -35.8810, -7.2308,  130.0,    2200.0,  22.0),
    (30, 'João Pessoa, PB',    -34.8641, -7.1153,  'São Paulo, SP',       -46.6388, -23.5505, 2700.0,   31000.0, 22.0),

    -- ─── PARANA (PR) ───────────────────────────────────────────────────
    (31, 'Curitiba, PR',       -49.2718, -25.4284, 'São José dos Pinhais, PR', -49.2070, -25.5343, 18.0, 950.0, 28.0),
    (32, 'Curitiba, PR',       -49.2718, -25.4284, 'Fortaleza, CE',       -38.5267, -3.7172,  3380.0,   37000.0, 28.0),

    -- ─── PERNAMBUCO (PE) ───────────────────────────────────────────────
    (33, 'Recife, PE',         -34.8770, -8.0476,  'Olinda, PE',          -34.8553, -8.0089,  10.0,     800.0,   24.0),
    (34, 'Recife, PE',         -34.8770, -8.0476,  'Porto Alegre, RS',    -51.2177, -30.0346, 3700.0,   40000.0, 24.0),

    -- ─── PIAUI (PI) ────────────────────────────────────────────────────
    (35, 'Teresina, PI',       -42.8019, -5.0892,  'Parnaíba, PI',        -41.7758, -2.9039,  340.0,    5500.0,  25.0),
    (36, 'Teresina, PI',       -42.8019, -5.0892,  'São Paulo, SP',       -46.6388, -23.5505, 2700.0,   30000.0, 25.0),

    -- ─── RIO DE JANEIRO (RJ) ───────────────────────────────────────────
    (37, 'Rio de Janeiro, RJ', -43.1729, -22.9068, 'Niterói, RJ',         -43.1037, -22.8845, 13.0,     900.0,   28.0),
    (38, 'Rio de Janeiro, RJ', -43.1729, -22.9068, 'Salvador, BA',        -38.5023, -12.9714, 1660.0,   19000.0, 28.0),

    -- ─── RIO GRANDE DO NORTE (RN) ──────────────────────────────────────
    (39, 'Natal, RN',          -35.2094, -5.7945,  'Mossoró, RN',         -37.3438, -5.1875,  280.0,    4000.0,  22.0),
    (40, 'Natal, RN',          -35.2094, -5.7945,  'Belo Horizonte, MG',  -43.9352, -19.9167, 2300.0,   26000.0, 22.0),

    -- ─── RIO GRANDE DO SUL (RS) ────────────────────────────────────────
    (41, 'Porto Alegre, RS',   -51.2177, -30.0346, 'Caxias do Sul, RS',   -51.1796, -29.1678, 130.0,    2200.0,  30.0),
    (42, 'Porto Alegre, RS',   -51.2177, -30.0346, 'Manaus, AM',          -60.0212, -3.1190,  4470.0,   48000.0, 30.0),

    -- ─── RONDONIA (RO) ─────────────────────────────────────────────────
    (43, 'Porto Velho, RO',    -63.9039, -8.7619,  'Ji-Paraná, RO',       -61.9504, -10.8851, 380.0,    6000.0,  26.0),
    (44, 'Porto Velho, RO',    -63.9039, -8.7619,  'São Paulo, SP',       -46.6388, -23.5505, 2890.0,   32000.0, 26.0),

    -- ─── RORAIMA (RR) ──────────────────────────────────────────────────
    (45, 'Boa Vista, RR',      -60.6753, 2.8198,   'Pacaraima, RR',       -61.1378, 4.4761,   200.0,    3500.0,  24.0),
    (46, 'Boa Vista, RR',      -60.6753, 2.8198,   'Belém, PA',           -48.5024, -1.4558,  1480.0,   18000.0, 24.0),

    -- ─── SANTA CATARINA (SC) ───────────────────────────────────────────
    (47, 'Florianópolis, SC',  -48.5495, -27.5954, 'Joinville, SC',       -48.8459, -26.3044, 180.0,    2800.0,  28.0),
    (48, 'Florianópolis, SC',  -48.5495, -27.5954, 'Recife, PE',          -34.8770, -8.0476,  3550.0,   38000.0, 28.0),

    -- ─── SAO PAULO (SP) ────────────────────────────────────────────────
    (49, 'São Paulo, SP',      -46.6388, -23.5505, 'Campinas, SP',        -47.0626, -22.9099, 100.0,    1900.0,  30.0),
    (50, 'São Paulo, SP',      -46.6388, -23.5505, 'Manaus, AM',          -60.0212, -3.1190,  3960.0,   42000.0, 30.0),

    -- ─── SERGIPE (SE) ──────────────────────────────────────────────────
    (51, 'Aracaju, SE',        -37.0731, -10.9472, 'Itabaiana, SE',       -37.4242, -10.6850, 80.0,     1700.0,  24.0),
    (52, 'Aracaju, SE',        -37.0731, -10.9472, 'Goiânia, GO',         -49.2532, -16.6864, 1850.0,   21000.0, 24.0),

    -- ─── TOCANTINS (TO) ────────────────────────────────────────────────
    (53, 'Palmas, TO',         -48.3603, -10.1689, 'Araguaína, TO',       -48.2076, -7.1911,  390.0,    6000.0,  26.0),
    (54, 'Palmas, TO',         -48.3603, -10.1689, 'Porto Alegre, RS',    -51.2177, -30.0346, 2540.0,   28000.0, 26.0)
) AS f(idx, origin, origin_lng, origin_lat, destination, dest_lng, dest_lat, distance_km, value, weight)
-- Pareia cada frete com um produto da lista de categorias ativas,
-- rotacionando ciclicamente. Mod e calculado sobre `idx` para que a
-- distribuicao seja deterministica e variada.
CROSS JOIN LATERAL (
  SELECT slug, name
  FROM produtos
  ORDER BY slug
  OFFSET ((f.idx - 1) % (SELECT COUNT(*) FROM produtos))
  LIMIT 1
) AS p;

COMMIT;

-- ============================================================================
-- VERIFY (rodar em select separado depois):
-- ============================================================================
-- SELECT count(*) AS total_fretes FROM fretes WHERE status = 'ativo';
--   -> deve retornar 54
--
-- SELECT product, count(*) FROM fretes GROUP BY product ORDER BY count(*) DESC;
--   -> distribuicao por produto
--
-- SELECT origin, destination, distance_km FROM fretes
--  WHERE origin LIKE 'Goiânia%'
--  ORDER BY distance_km;
--   -> 2 fretes saindo de Goiania, um curto e um longo
-- ============================================================================
