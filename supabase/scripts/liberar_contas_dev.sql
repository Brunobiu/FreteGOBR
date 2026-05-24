-- ============================================================================
-- Script: Liberar contas de desenvolvimento
-- ============================================================================
-- Marca as duas contas abaixo como "perfil completo" sem precisar enviar
-- documentos, foto de perfil ou verificar e-mail. Use APENAS no banco
-- de testes.
--
-- Embarcador: (62) 9 9475-7240
-- Motorista:  (56) 4 2345-6436
--
-- O que faz:
--   - users.email_verified = true
--   - users.profile_photo_url = placeholder (só pra UI não pedir)
--   - embarcadores.company_logo_url = placeholder
--   - motorista: preenche operacional (km/L, eixos, capacidade, diesel,
--     placa, modelo, RNTRC) + 6 documentos obrigatórios aprovados
-- ============================================================================

DO $script$
DECLARE
  v_emb_phone    TEXT := '62994757240';   -- (62) 9 9475-7240 sanitizado
  v_mot_phone    TEXT := '56423456436';   -- (56) 4 2345-6436 sanitizado
  v_emb_id       UUID;
  v_mot_id       UUID;
  v_doc_types    TEXT[] := ARRAY[
    'cpf', 'cnh', 'antt',
    'vehicle_registration', 'vehicle_insurance', 'profile_photo'
  ];
  v_type         TEXT;
  v_placeholder  TEXT := 'dev/placeholder.png';
BEGIN
  -- ──────────────────────────────────────────────────────────────────────────
  -- EMBARCADOR
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_emb_id FROM users
   WHERE replace(replace(replace(replace(phone,' ',''),'(',''),')',''),'-','') = v_emb_phone
   LIMIT 1;

  IF v_emb_id IS NULL THEN
    RAISE NOTICE '⚠ Embarcador % não encontrado. Cadastre primeiro pelo app.', v_emb_phone;
  ELSE
    UPDATE users
       SET email_verified    = true,
           profile_photo_url = COALESCE(NULLIF(profile_photo_url,''), v_placeholder),
           updated_at        = NOW()
     WHERE id = v_emb_id;

    UPDATE embarcadores
       SET company_logo_url = COALESCE(NULLIF(company_logo_url,''), v_placeholder),
           updated_at       = NOW()
     WHERE id = v_emb_id;

    RAISE NOTICE '✅ Embarcador % liberado.', v_emb_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- MOTORISTA
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_mot_id FROM users
   WHERE replace(replace(replace(replace(phone,' ',''),'(',''),')',''),'-','') = v_mot_phone
   LIMIT 1;

  IF v_mot_id IS NULL THEN
    RAISE NOTICE '⚠ Motorista % não encontrado. Cadastre primeiro pelo app.', v_mot_phone;
  ELSE
    UPDATE users
       SET email_verified    = true,
           profile_photo_url = COALESCE(NULLIF(profile_photo_url,''), v_placeholder),
           updated_at        = NOW()
     WHERE id = v_mot_id;

    -- Garante linha em motoristas
    INSERT INTO motoristas (id, vehicle_type)
    VALUES (v_mot_id, 'truck')
    ON CONFLICT (id) DO NOTHING;

    -- Preenche operacional
    UPDATE motoristas
       SET vehicle_type             = COALESCE(NULLIF(vehicle_type,''), 'truck'),
           vehicle_plate            = COALESCE(NULLIF(vehicle_plate,''), 'DEV1A23'),
           vehicle_model            = COALESCE(NULLIF(vehicle_model,''), 'Volvo FH'),
           vehicle_year_manufacture = COALESCE(vehicle_year_manufacture, 2020),
           vehicle_year_model       = COALESCE(vehicle_year_model, 2021),
           km_per_liter             = COALESCE(km_per_liter, 2.5),
           trailer_axles            = COALESCE(trailer_axles, 6),
           cargo_capacity_ton       = COALESCE(cargo_capacity_ton, 30),
           diesel_price             = COALESCE(diesel_price, 6.20),
           is_owner                 = COALESCE(is_owner, true),
           rntrc_type               = COALESCE(rntrc_type, 'fisica'),
           updated_at               = NOW()
     WHERE id = v_mot_id;

    -- Documentos aprovados (placeholders)
    FOREACH v_type IN ARRAY v_doc_types LOOP
      IF NOT EXISTS (
        SELECT 1 FROM documents
         WHERE user_id = v_mot_id AND document_type = v_type
      ) THEN
        INSERT INTO documents (
          user_id, document_type,
          file_name, file_path, file_size, mime_type,
          status, created_at
        ) VALUES (
          v_mot_id, v_type,
          'dev_' || v_type || '.pdf',
          'dev/' || v_mot_id || '/' || v_type || '.pdf',
          1024, 'application/pdf',
          'aprovado', NOW()
        );
      ELSE
        UPDATE documents
           SET status = 'aprovado', rejection_reason = NULL
         WHERE user_id = v_mot_id AND document_type = v_type;
      END IF;
    END LOOP;

    RAISE NOTICE '✅ Motorista % liberado.', v_mot_id;
  END IF;
END
$script$;

-- ============================================================================
-- CONFERÊNCIA
-- ============================================================================
SELECT
  u.id, u.user_type, u.name, u.phone, u.email_verified,
  CASE WHEN u.profile_photo_url IS NOT NULL THEN '✓' ELSE '–' END AS foto,
  CASE WHEN e.company_logo_url IS NOT NULL THEN '✓' ELSE '–' END AS logo,
  m.vehicle_plate, m.km_per_liter, m.cargo_capacity_ton, m.rntrc_type
  FROM users u
  LEFT JOIN embarcadores e ON e.id = u.id
  LEFT JOIN motoristas   m ON m.id = u.id
 WHERE replace(replace(replace(replace(u.phone,' ',''),'(',''),')',''),'-','') IN
       ('62994757240', '56423456436');
