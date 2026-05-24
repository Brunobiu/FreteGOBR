-- =====================================================
-- Bootstrap admin master (apos criar via Dashboard)
--
-- Pre-requisito: usuario ja foi criado em Authentication > Users
-- com email 'nexus_vortex99@admin.fretego.local'
--
-- Este script apenas:
--  - Cria/normaliza linha em public.users
--  - Concede SUPER_ADMIN
-- =====================================================

DO $bootstrap$
DECLARE
  v_username TEXT := 'Nexus_Vortex99';
  v_email    TEXT := 'nexus_vortex99@admin.fretego.local';
  v_name     TEXT := 'Bruno Henrique';
  v_phone    TEXT := 'admin:nexus_vortex99';
  v_user_id  UUID;
BEGIN
  -- Pega o id do usuario criado no Dashboard
  SELECT id INTO v_user_id
    FROM auth.users
   WHERE email = v_email
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario % nao existe em auth.users. Crie pelo Dashboard primeiro.', v_email;
  END IF;

  -- Insere/normaliza public.users
  INSERT INTO public.users (
    id, phone, password_hash, user_type, name, email,
    is_active, is_superuser, admin_username
  ) VALUES (
    v_user_id, v_phone, 'managed_by_supabase_auth', 'admin', v_name, v_email,
    true, true, v_username
  )
  ON CONFLICT (id) DO UPDATE SET
    is_superuser   = true,
    is_active      = true,
    admin_username = v_username,
    name           = v_name;

  -- Garante papel SUPER_ADMIN
  INSERT INTO public.admin_roles(user_id, role, granted_by, revoked_at)
  VALUES (v_user_id, 'SUPER_ADMIN', v_user_id, NULL)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Admin master pronto: id=%', v_user_id;
END;
$bootstrap$;

-- Confirma estado final
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
