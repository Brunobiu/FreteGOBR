-- =====================================================
-- ROLLBACK da Migration 073: revalidação periódica de documentos (30 dias)
-- Documentação — NÃO é auto-aplicada.
--
-- Restaura motorista_can_interact à versão da migration 071 (sem o gate de
-- revalidação) e remove os objetos criados em 073.
-- =====================================================

BEGIN;

DROP FUNCTION IF EXISTS public.confirm_my_doc_revalidation();
DROP FUNCTION IF EXISTS public.get_my_doc_revalidation();
DROP FUNCTION IF EXISTS public.has_expired_doc_revalidation(uuid);

-- Restaura motorista_can_interact SEM o gate de revalidação (estado da 071).
CREATE OR REPLACE FUNCTION motorista_can_interact(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_user_type text; v_status text; v_subscribed boolean; v_trial_ends timestamptz;
  v_grace_ends timestamptz; v_docs_blocked boolean;
BEGIN
  SELECT u.user_type, u.subscription_status, u.is_subscribed, u.trial_ends_at, u.documents_blocked
    INTO v_user_type, v_status, v_subscribed, v_trial_ends, v_docs_blocked
    FROM users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_user_type <> 'motorista' THEN RETURN true; END IF;
  IF v_docs_blocked THEN RETURN false; END IF;
  IF v_status IN ('canceled','blocked') THEN RETURN false; END IF;
  IF v_status = 'active' OR v_subscribed THEN RETURN true; END IF;
  IF v_status = 'past_due' THEN
    SELECT s.grace_ends_at INTO v_grace_ends FROM subscriptions s WHERE s.user_id = p_user_id;
    RETURN (v_grace_ends IS NULL OR v_grace_ends >= NOW());
  END IF;
  RETURN (v_trial_ends IS NOT NULL AND v_trial_ends > NOW());
END;
$func$;
REVOKE ALL ON FUNCTION motorista_can_interact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION motorista_can_interact(uuid) TO authenticated;

DROP TRIGGER IF EXISTS users_ensure_doc_revalidation ON public.users;
DROP FUNCTION IF EXISTS public.ensure_doc_revalidation_row();

DROP TABLE IF EXISTS public.motorista_doc_revalidation;

COMMIT;
