-- =====================================================
-- Bootstrap admin master: Bruno Henrique
--
-- Cria automaticamente o primeiro Super_Admin do FreteGO.
-- Idempotente: rodar varias vezes nao duplica nem sobrescreve.
--
-- Como rodar:
--   psql ou Supabase SQL Editor com role postgres / service_role
--
-- Pre-requisitos:
--   - Migration 030_admin_foundation.sql aplicada
--   - Extensao pgcrypto habilitada (ja vem em 001)
--
-- Apos rodar:
--   - Acessar /admin/login
--   - Usuario: Nexus_Vortex99
--   - Senha:   K9#v!2Wx@m$7Q&zL1%tR_B
--   - Configurar MFA no primeiro acesso (TOTP + backup codes)
--
-- IMPORTANTE: troque a senha apos o primeiro login se necessario
-- via fluxo de "esqueci senha" do Supabase Auth ou via SQL com pgcrypto.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $bootstrap$
DECLARE
  v_username     TEXT := 'Nexus_Vortex99';
  v_email        TEXT := 'nexus_vortex99@admin.fretego.local';
  v_password     TEXT := 'K9#v!2Wx@m$7Q&zL1%tR_B';
  v_name         TEXT := 'Bruno Henrique';
  v_phone        TEXT := 'admin:nexus_vortex99';   -- sintetico, satisfaz NOT NULL/UNIQUE
  v_user_id      UUID;
  v_existing     UUID;
BEGIN
  -- 1) Verifica se ja existe na public.users por admin_username
  SELECT id INTO v_existing
    FROM public.users
   WHERE admin_username = v_username
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Garante flags consistentes mesmo em re-run
    UPDATE public.users
       SET is_superuser = true,
           is_active    = true,
           name         = v_name
     WHERE id = v_existing;

    -- Garante papel SUPER_ADMIN ativo
    INSERT INTO public.admin_roles(user_id, role, granted_by, revoked_at)
    VALUES (v_existing, 'SUPER_ADMIN', v_existing, NULL)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Admin master ja existe (id=%). Estado normalizado.', v_existing;
    RETURN;
  END IF;

  -- 2) Verifica em auth.users por email sintetico
  SELECT id INTO v_user_id
    FROM auth.users
   WHERE email = v_email
   LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Cria em auth.users
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      aud,
      role
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(v_password, gen_salt('bf')),
      NOW(),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
      jsonb_build_object('admin_username', v_username, 'name', v_name),
      NOW(),
      NOW(),
      'authenticated',
      'authenticated'
    );

    -- Identidade email padrao do supabase auth
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email',
      v_user_id::text,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3) Insere em public.users
  INSERT INTO public.users (
    id, phone, password_hash, user_type, name, email,
    is_active, is_superuser, admin_username
  )
  VALUES (
    v_user_id,
    v_phone,
    'managed_by_supabase_auth',
    'admin',
    v_name,
    v_email,
    true,
    true,
    v_username
  )
  ON CONFLICT (id) DO UPDATE SET
    is_superuser   = true,
    is_active      = true,
    admin_username = v_username,
    name           = v_name;

  -- 4) Garante papel SUPER_ADMIN ativo
  INSERT INTO public.admin_roles(user_id, role, granted_by, revoked_at)
  VALUES (v_user_id, 'SUPER_ADMIN', v_user_id, NULL)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Admin master criado: id=%, username=%, email=%', v_user_id, v_username, v_email;
END;
$bootstrap$;

-- Verificacao final
SELECT
  u.id,
  u.name,
  u.admin_username,
  u.is_superuser,
  u.is_active,
  array_agg(ar.role) FILTER (WHERE ar.revoked_at IS NULL) AS active_roles
FROM public.users u
LEFT JOIN public.admin_roles ar ON ar.user_id = u.id
WHERE u.admin_username = 'Nexus_Vortex99'
GROUP BY u.id, u.name, u.admin_username, u.is_superuser, u.is_active;
