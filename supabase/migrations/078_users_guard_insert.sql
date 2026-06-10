-- =====================================================
-- Migration 078: guard de INSERT em public.users (R3 — crítico)
--
-- Problema: users_insert_policy = WITH CHECK (true) e nenhum trigger sanitiza
-- colunas sensíveis no INSERT. Um usuário no fluxo de cadastro (role
-- authenticated) podia inserir a própria linha JÁ com is_superuser=true
-- (acesso ao painel admin via admin/auth.ts), subscription_status='active' e
-- is_subscribed=true (assinatura grátis). Provado em transação (rollback).
--
-- Correção: trigger BEFORE INSERT (SECURITY INVOKER) que, quando a chamada vem
-- do cliente (current_user IN authenticated/anon), pina o id em auth.uid(),
-- valida user_type e força defaults seguros nas colunas sensíveis. INSERTs de
-- backend/RPC SECURITY DEFINER (current_user=postgres/service_role) passam.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.users_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $func$
BEGIN
  -- Só aplica ao cliente direto (PostgREST). Backend/definer passam.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- id deve ser o do próprio chamador autenticado (impede forjar/impersonar).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'permission_denied: cadastro requer sessao autenticada'
      USING ERRCODE = '42501';
  END IF;
  NEW.id := auth.uid();

  -- user_type restrito ao domínio público (nunca 'admin' por self-signup).
  IF NEW.user_type IS NULL OR NEW.user_type NOT IN ('motorista', 'embarcador') THEN
    RAISE EXCEPTION 'invalid_user_type: deve ser motorista ou embarcador'
      USING ERRCODE = '22023';
  END IF;

  -- Defaults seguros — ignora qualquer valor forjado pelo cliente.
  NEW.is_superuser        := false;
  NEW.admin_username      := NULL;
  NEW.is_subscribed       := false;
  NEW.subscription_status := 'trial';
  NEW.documents_blocked   := false;
  NEW.is_active           := true;
  NEW.ban_reason          := NULL;
  NEW.banned_at           := NULL;
  NEW.banned_by           := NULL;
  -- trial_ends_at recomputado por users_set_trial_defaults (motorista = +30d).
  NEW.trial_ends_at       := NULL;

  RETURN NEW;
END;
$func$;

-- Roda ANTES de users_set_trial_defaults (ordem alfabética: guard_insert <
-- set_trial_defaults), garantindo que o trial seja recomputado depois do reset.
DROP TRIGGER IF EXISTS users_guard_insert ON public.users;
CREATE TRIGGER users_guard_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard_insert();

COMMIT;

-- VERIFY (manual, rollback)
/*
BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"<uid>","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO users(id,phone,user_type,name,email,is_superuser,subscription_status)
VALUES ('<uid>','11999990000','motorista','X','x@e.com',true,'active');
SELECT is_superuser, subscription_status FROM users WHERE id='<uid>'; -- false, trial
ROLLBACK;
*/
