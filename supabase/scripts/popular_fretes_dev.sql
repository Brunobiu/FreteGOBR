-- ============================================================================
-- Script: Popular 10 fretes de teste (dev)
-- ============================================================================
-- Cria 10 fretes diversificados (curta, média e longa distância) atribuídos
-- ao embarcador "Bruno Henrique" passado como parâmetro abaixo.
--
-- Edite a constante v_emb_phone abaixo se quiser usar outro embarcador.
--
-- Idempotente: cada execução cria 10 NOVOS fretes (não deduplica). Se quiser
-- limpar antes, rode `DELETE FROM fretes WHERE embarcador_id = ...;`.
-- ============================================================================

DO $script$
DECLARE
  v_emb_phone TEXT := '62994757240';   -- (62) 9 9475-7240 = embarcador Bruno Henrique
  v_emb_id    UUID;
BEGIN
  SELECT id INTO v_emb_id FROM users
   WHERE replace(replace(replace(replace(phone,' ',''),'(',''),')',''),'-','') = v_emb_phone
     AND user_type = 'embarcador'
   LIMIT 1;

  IF v_emb_id IS NULL THEN
    RAISE EXCEPTION 'Embarcador % não encontrado. Cadastre primeiro pelo app.', v_emb_phone;
  END IF;

  INSERT INTO fretes (
    embarcador_id, origin, origin_location, destination, destination_location,
    cargo_type, cargo_species, product, vehicle_type, body_types,
    weight, weight_unit, value, deadline, loading_time, unloading_time,
    specifications, freight_type, payment_methods, price_calculation,
    advance_percentage, value_known, requires_lona, requires_tracker,
    requires_insurance, distance_km, status,
    origin_detail, destination_detail
  ) VALUES
  -- 1. Curta — Goiânia → Anápolis (50km)
  (v_emb_id,
   'Goiânia, GO', ST_GeogFromText('SRID=4326;POINT(-49.2643 -16.6864)'),
   'Anápolis, GO', ST_GeogFromText('SRID=4326;POINT(-48.9531 -16.3267)'),
   'Carga Geral', 'Caixas', 'Eletrodomésticos',
   'truck', 'Baú',
   8, 'toneladas', 1500.00, NOW() + INTERVAL '3 days', 0, 0,
   'Carga frágil, manusear com cuidado.', 'completa', 'Pix/Ted', 'total',
   30, true, false, false, false, 50, 'ativo',
   'Galpão central', 'Distribuidor zona norte'),

  -- 2. Curta — Brasília → Luziânia (60km)
  (v_emb_id,
   'Brasília, DF', ST_GeogFromText('SRID=4326;POINT(-47.9292 -15.7801)'),
   'Luziânia, GO', ST_GeogFromText('SRID=4326;POINT(-47.9505 -16.2528)'),
   'Granel sólido', 'Sacos', 'Cimento',
   'bitruck', 'Graneleiro',
   18, 'toneladas', 4500.00, NOW() + INTERVAL '5 days', 0, 0,
   'Descarga pode ser feita em qualquer horário.', 'completa', 'Pix/Ted, Depósito em conta', 'total',
   40, true, true, false, false, 60, 'ativo',
   'Centro de distribuição BRA-2', 'Obra Aldeia do Sol'),

  -- 3. Média — Goiânia → Uberlândia (430km)
  (v_emb_id,
   'Goiânia, GO', ST_GeogFromText('SRID=4326;POINT(-49.2643 -16.6864)'),
   'Uberlândia, MG', ST_GeogFromText('SRID=4326;POINT(-48.2772 -18.9186)'),
   'Frigorificada ou Aquecida', 'Caixas', 'Carne bovina resfriada',
   'carreta', 'Baú Frigorífico',
   25, 'toneladas', 12000.00, NOW() + INTERVAL '2 days', 0, 0,
   'Manter temperatura entre 0°C e 4°C durante todo o trajeto.', 'completa',
   'Pix/Ted, E-frete', 'toneladas',
   50, true, false, true, true, 430, 'ativo',
   'Frigorífico Boi Bom', 'Atacadão Uberlândia'),

  -- 4. Média — Cuiabá → Rondonópolis (215km)
  (v_emb_id,
   'Cuiabá, MT', ST_GeogFromText('SRID=4326;POINT(-56.0974 -15.6014)'),
   'Rondonópolis, MT', ST_GeogFromText('SRID=4326;POINT(-54.6356 -16.4673)'),
   'Granel sólido', 'Big Bag', 'Soja em grão',
   'rodotrem', 'Graneleiro',
   45, 'toneladas', 8500.00, NOW() + INTERVAL '4 days', 0, 0,
   'Carga e descarga com bombona pneumática.', 'completa', 'Pix, Depósito em conta', 'toneladas',
   60, true, true, true, false, 215, 'ativo',
   'Fazenda Boa Vista', 'Terminal Rondonópolis'),

  -- 5. Longa — São Paulo → Recife (2660km)
  (v_emb_id,
   'São Paulo, SP', ST_GeogFromText('SRID=4326;POINT(-46.6333 -23.5505)'),
   'Recife, PE', ST_GeogFromText('SRID=4326;POINT(-34.8770 -8.0476)'),
   'Carga Geral', 'Paletes', 'Material de construção',
   'carreta_4_eixo', 'Sider',
   28, 'toneladas', 22000.00, NOW() + INTERVAL '7 days', 0, 0,
   'Rastreador obrigatório, escolta noturna.', 'completa',
   'Pix/Ted, E-frete', 'toneladas',
   30, true, true, true, true, 2660, 'ativo',
   'Galpão Tatuapé', 'Centro de Distribuição Recife'),

  -- 6. Longa — Manaus → Belém (5400km, Transamazônica)
  (v_emb_id,
   'Manaus, AM', ST_GeogFromText('SRID=4326;POINT(-60.0212 -3.1190)'),
   'Belém, PA', ST_GeogFromText('SRID=4326;POINT(-48.5024 -1.4554)'),
   'Conteinerizada', 'Container', 'Produtos eletrônicos',
   'carreta', 'Plataforma',
   24, 'toneladas', 35000.00, NOW() + INTERVAL '15 days', 0, 0,
   'Frete dedicado. Necessário licenciamento ANTT atualizado.', 'completa',
   'Depósito em conta, E-frete', 'total',
   25, true, false, true, true, 5400, 'ativo',
   'Porto de Manaus', 'Terminal Belém'),

  -- 7. Média — Curitiba → Florianópolis (300km)
  (v_emb_id,
   'Curitiba, PR', ST_GeogFromText('SRID=4326;POINT(-49.2671 -25.4284)'),
   'Florianópolis, SC', ST_GeogFromText('SRID=4326;POINT(-48.5482 -27.5969)'),
   'Carga Geral', 'Diversos', 'Bebidas',
   'truck', 'Baú',
   12, 'toneladas', 3800.00, NOW() + INTERVAL '3 days', 0, 0,
   'Entrega fracionada em 3 pontos da grande Florianópolis.', 'complemento',
   'Pix/Ted', 'total',
   20, true, true, false, false, 300, 'ativo',
   'Distribuidora CWB', 'Vários pontos Florianópolis'),

  -- 8. Curta — Belo Horizonte → Contagem (25km)
  (v_emb_id,
   'Belo Horizonte, MG', ST_GeogFromText('SRID=4326;POINT(-43.9378 -19.9167)'),
   'Contagem, MG', ST_GeogFromText('SRID=4326;POINT(-44.0539 -19.9317)'),
   'Carga Geral', 'Mudança', 'Mudança residencial',
   'tres_quartos', 'Baú',
   3, 'toneladas', 800.00, NOW() + INTERVAL '1 day', 0, 0,
   'Mudança em apartamento 4º andar com elevador.', 'caixote_cheio',
   'Pix, Crédito em cartão', 'total',
   50, true, false, false, false, 25, 'ativo',
   'Apartamento Savassi', 'Casa Bairro Eldorado'),

  -- 9. Longa — Porto Alegre → Salvador (3300km)
  (v_emb_id,
   'Porto Alegre, RS', ST_GeogFromText('SRID=4326;POINT(-51.2177 -30.0346)'),
   'Salvador, BA', ST_GeogFromText('SRID=4326;POINT(-38.5014 -12.9714)'),
   'Granel líquido', 'Tambor', 'Óleo de soja',
   'carreta_ls', 'Tanque',
   30, 'toneladas', 28000.00, NOW() + INTERVAL '10 days', 0, 0,
   'Tanque inox, lacre obrigatório.', 'completa',
   'Pix/Ted, Depósito em conta', 'toneladas',
   40, true, false, true, true, 3300, 'ativo',
   'Refinaria POA', 'Distribuidor Salvador'),

  -- 10. Média — Vitória → Rio de Janeiro (520km)
  (v_emb_id,
   'Vitória, ES', ST_GeogFromText('SRID=4326;POINT(-40.3128 -20.3155)'),
   'Rio de Janeiro, RJ', ST_GeogFromText('SRID=4326;POINT(-43.1729 -22.9068)'),
   'Perigosa', 'Tambor', 'Combustível diesel',
   'carreta', 'Tanque',
   32, 'toneladas', 18500.00, NOW() + INTERVAL '5 days', 0, 0,
   'Carga perigosa - ONU 1202. MOPP obrigatório.', 'peso_balanca',
   'E-frete', 'toneladas',
   30, true, false, true, true, 520, 'ativo',
   'Terminal Tubarão', 'Distribuidor Duque de Caxias');

  RAISE NOTICE '✅ 10 fretes criados para o embarcador %', v_emb_id;
END
$script$;

-- Adiciona ONU number ao último (perigosa)
UPDATE fretes
   SET onu_number = '1202'
 WHERE cargo_type = 'Perigosa'
   AND onu_number IS NULL;

-- Adiciona temperatura ao 3º (frigorificada)
UPDATE fretes
   SET temperature = 2.0
 WHERE cargo_type = 'Frigorificada ou Aquecida'
   AND temperature IS NULL;

-- ============================================================================
-- CONFERÊNCIA
-- ============================================================================
SELECT id, origin, '→' AS arrow, destination, value, vehicle_type, distance_km, status
  FROM fretes
 WHERE embarcador_id = (
   SELECT id FROM users
    WHERE replace(replace(replace(replace(phone,' ',''),'(',''),')',''),'-','') = '62994757240'
    LIMIT 1
 )
 ORDER BY created_at DESC;
