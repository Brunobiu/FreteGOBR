-- =====================================================
-- Migration 077: guard de colunas sensíveis em public.users (R1 — crítico)
--
-- Problema: a role `authenticated` tem UPDATE em nível de tabela em `users` e a
-- RLS de UPDATE é apenas `auth.uid() = id` (sem restrição de coluna). Um usuário
-- autenticado podia, via PATCH direto na API REST, alterar a PRÓPRIA linha
-- setando is_subscribed/subscription_status/trial_ends_at/documents_blocked/
-- user_type/email_verified — escalonamento de privilégio + bypass financeiro.
--
-- Correção: trigger BEFORE UPDATE que bloqueia mudanças em colunas sensíveis
-- quando a chamada vem do cliente (current_user IN authenticated/anon, i.e.
-- PostgREST). RPCs SECURITY DEFINER (owner postgres) e service_role passam,
-- pois durante a execução o current_user é postgres/service_role. Admins
-- (mesmo papel `authenticated`) podem alterar SOMENTE colunas de moderação.
-- =====================================================

BEGIN;

-- IMPORTANTE: SECURITY INVOKER. Se fosse DEFINER (owner postgres), current_user
-- dentro do trigger seria sempre 'postgres' e o guard nunca aplicaria. Como
-- INVOKER, current_user reflete o chamador real: 'authenticated' no PATCH
-- direto do cliente (PostgREST) e 'postgres' quando rodando dentro de uma RPC
-- SECURITY DEFINER (owner postgres) — exatamente a distinção que queremos.
CREATE OR REPLACE FUNCTION public.users_guard_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $func$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Só aplica quando a chamada vem diretamente do cliente via PostgREST.
  -- Em RPCs SECURITY DEFINER (owner postgres) ou backend (service_role),
  -- current_user não é authenticated/anon e o guard é ignorado.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- 1) Colunas SOMENTE-SISTEMA: nunca alteráveis pelo cliente direto.
  IF (NEW.user_type           IS DISTINCT FROM OLD.user_type)
  OR (NEW.trial_ends_at       IS DISTINCT FROM OLD.trial_ends_at)
  OR (NEW.subscription_status IS DISTINCT FROM OLD.subscription_status)
  OR (NEW.is_subscribed       IS DISTINCT FROM OLD.is_subscribed)
  OR (NEW.documents_blocked   IS DISTINCT FROM OLD.documents_blocked)
  OR (NEW.email_verified      IS DISTINCT FROM OLD.email_verified)
  OR (NEW.terms_accepted_at   IS DISTINCT FROM OLD.terms_accepted_at)
  OR (NEW.terms_version       IS DISTINCT FROM OLD.terms_version)
  OR (NEW.password_hash       IS DISTINCT FROM OLD.password_hash)
  OR (NEW.admin_username      IS DISTINCT FROM OLD.admin_username)
  OR (NEW.is_superuser        IS DISTINCT FROM OLD.is_superuser)
  THEN
    RAISE EXCEPTION 'permission_denied: campo protegido nao pode ser alterado pelo cliente'
      USING ERRCODE = '42501';
  END IF;

  -- 2) Colunas de MODERAÇÃO: apenas admin com permissão (ou backend/definer).
  IF (NEW.is_active  IS DISTINCT FROM OLD.is_active)
  OR (NEW.ban_reason IS DISTINCT FROM OLD.ban_reason)
  OR (NEW.banned_at  IS DISTINCT FROM OLD.banned_at)
  OR (NEW.banned_by  IS DISTINCT FROM OLD.banned_by)
  THEN
    v_is_admin := is_admin_with_permission('USER_TOGGLE_ACTIVE')
               OR is_admin_with_permission('USER_EDIT');
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'permission_denied: moderacao requer permissao de admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3) Demais colunas (nome, email, phone, cpf, foto, last_activity_at,
  --    session_version) seguem livres — a RLS auth.uid()=id já garante posse.
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_guard_sensitive_columns ON public.users;
CREATE TRIGGER users_guard_sensitive_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard_sensitive_columns();

COMMIT;

-- VERIFY (manual)
/*
-- Deve FALHAR como cliente:
SET LOCAL ROLE authenticated;
UPDATE users SET is_subscribed = true WHERE id = '<meu_id>';
RESET ROLE;
*/
