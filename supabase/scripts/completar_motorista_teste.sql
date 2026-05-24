-- ============================================================================
-- Script: Completar perfil de motorista de teste
-- ============================================================================
-- Marca a conta `(32) 5 4253-4234` como:
--   - email_verified = true
--   - perfil de motorista preenchido (km/L, eixos, capacidade, etc.)
--   - 6 documentos obrigatórios já APROVADOS
--   - tipo de RNTRC marcado (Pessoa Física)
--
-- Use no SQL Editor do Supabase Studio. Idempotente: rodar de novo
-- não duplica documentos. Não usa storage real — coloca paths fake
-- com status 'aprovado' apenas pra desbloquear `profileComplete = true`
-- na UI e permitir testar contratar/curtir fretes.
--
-- ⚠ Conta de TESTE — não usar em produção.
-- ============================================================================

DO $script$
DECLARE
  v_phone   TEXT := '32542534234';   -- (32) 5 4253-4234 sanitizado
  v_user_id UUID;
  v_doc_types TEXT[] := ARRAY[
    'cpf',
    'cnh',
    'antt',
    'vehicle_registration',
    'vehicle_insurance',
    'profile_photo'
  ];
  v_type TEXT;
BEGIN
  -- 1. Localizar usuário pelo telefone
  SELECT id INTO v_user_id
    FROM users
   WHERE replace(replace(replace(replace(phone, ' ', ''), '(', ''), ')', ''), '-', '') = v_phone
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário com telefone % não encontrado. Cadastre primeiro pelo app.', v_phone;
  END IF;

  -- 2. Marcar e-mail como verificado
  UPDATE users
     SET email_verified = true,
         updated_at     = NOW()
   WHERE id = v_user_id;

  -- 3. Garantir que existe linha em motoristas (caso o registro tenha falhado)
  INSERT INTO motoristas (id, vehicle_type)
  VALUES (v_user_id, 'truck')
  ON CONFLICT (id) DO NOTHING;

  -- 4. Preencher campos operacionais necessários pra calcular frete
  UPDATE motoristas
     SET vehicle_type             = COALESCE(NULLIF(vehicle_type, ''), 'truck'),
         vehicle_plate            = COALESCE(NULLIF(vehicle_plate, ''), 'TST1A23'),
         vehicle_model            = COALESCE(NULLIF(vehicle_model, ''), 'Volvo FH'),
         vehicle_year_manufacture = COALESCE(vehicle_year_manufacture, 2020),
         vehicle_year_model       = COALESCE(vehicle_year_model, 2021),
         km_per_liter             = COALESCE(km_per_liter, 2.5),
         trailer_axles            = COALESCE(trailer_axles, 6),
         cargo_capacity_ton       = COALESCE(cargo_capacity_ton, 30),
         diesel_price             = COALESCE(diesel_price, 6.20),
         is_owner                 = COALESCE(is_owner, true),
         rntrc_type               = COALESCE(rntrc_type, 'fisica'),
         updated_at               = NOW()
   WHERE id = v_user_id;

  -- 5. Inserir documentos APROVADOS para os 6 tipos obrigatórios
  --    Skip se já existe (mesmo motorista + mesmo tipo).
  FOREACH v_type IN ARRAY v_doc_types LOOP
    IF NOT EXISTS (
      SELECT 1 FROM documents
       WHERE user_id = v_user_id AND document_type = v_type
    ) THEN
      INSERT INTO documents (
        user_id, document_type,
        file_name, file_path, file_size, mime_type,
        status, created_at
      ) VALUES (
        v_user_id, v_type,
        'teste_' || v_type || '.pdf',
        'test-fake/' || v_user_id || '/' || v_type || '.pdf',
        1024,
        'application/pdf',
        'aprovado',
        NOW()
      );
    ELSE
      -- Já existe: força status para aprovado pra liberar a UI
      UPDATE documents
         SET status = 'aprovado',
             rejection_reason = NULL
       WHERE user_id = v_user_id AND document_type = v_type;
    END IF;
  END LOOP;

  RAISE NOTICE '✅ Motorista % preparado: e-mail verificado, perfil preenchido, 6 docs aprovados.', v_user_id;
END
$script$;

-- ============================================================================
-- CONFERÊNCIA
-- ============================================================================
SELECT
  u.id,
  u.name,
  u.phone,
  u.email,
  u.email_verified,
  u.user_type,
  m.vehicle_type,
  m.vehicle_plate,
  m.vehicle_model,
  m.km_per_liter,
  m.trailer_axles,
  m.cargo_capacity_ton,
  m.diesel_price,
  m.rntrc_type
  FROM users u
  LEFT JOIN motoristas m ON m.id = u.id
 WHERE replace(replace(replace(replace(u.phone, ' ', ''), '(', ''), ')', ''), '-', '') = '32542534234';

SELECT document_type, status, file_name, created_at
  FROM documents
 WHERE user_id = (
   SELECT id FROM users
    WHERE replace(replace(replace(replace(phone, ' ', ''), '(', ''), ')', ''), '-', '') = '32542534234'
 )
 ORDER BY document_type;
