-- =====================================================
-- Migration 081: reseta email_verified ao trocar email pelo cliente (R6)
--
-- O guard 077 impede o cliente de setar email_verified diretamente, mas não
-- impede trocar `email` mantendo email_verified=true (herdado do email antigo).
-- Isso permitiria "verificar" um email novo sem confirmar. O email é usado em
-- reset de senha/login, então o estado verificado precisa refletir o endereço
-- atual.
--
-- Correção: estende o trigger BEFORE UPDATE users_guard_sensitive_columns —
-- quando a chamada vem do cliente (authenticated/anon) e o email muda, força
-- email_verified=false. A reverificação real é feita pelo fluxo de
-- signup_email_verifications (RPC SECURITY DEFINER), que roda como postgres e
-- não é afetado por este reset.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.users_guard_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $func$
DECLARE
  v_is_admin boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Troca de email pelo cliente invalida a verificação anterior.
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email_verified := false;
  END IF;

  -- 1) Colunas SOMENTE-SISTEMA (email_verified continua protegido: o cliente
  --    não pode SUBIR para true; só o reset automático acima pode zerar).
  IF (NEW.user_type           IS DISTINCT FROM OLD.user_type)
  OR (NEW.trial_ends_at       IS DISTINCT FROM OLD.trial_ends_at)
  OR (NEW.subscription_status IS DISTINCT FROM OLD.subscription_status)
  OR (NEW.is_subscribed       IS DISTINCT FROM OLD.is_subscribed)
  OR (NEW.documents_blocked   IS DISTINCT FROM OLD.documents_blocked)
  OR (NEW.email_verified      IS DISTINCT FROM OLD.email_verified
        AND NEW.email_verified = true)  -- bloqueia subir p/ true; reset p/ false é permitido
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

  RETURN NEW;
END;
$func$;

COMMIT;
