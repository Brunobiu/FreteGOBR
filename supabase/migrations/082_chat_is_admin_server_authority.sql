-- =====================================================
-- Migration 082: is_admin do chat decidido pelo servidor (R11)
--
-- Problema: chat_messages.is_admin é enviado pelo cliente (sendMessage recebe
-- isAdmin e insere direto). A RLS de INSERT só valida sender_id=auth.uid(); não
-- valida o valor de is_admin. Um usuário comum numa conversa de suporte podia
-- inserir mensagem com is_admin=true e se passar por "Suporte FreteGO"
-- (impersonação/phishing).
--
-- Correção: trigger BEFORE INSERT que SOBRESCREVE is_admin com a verdade do
-- servidor — true somente se o remetente é admin de fato (users.is_superuser
-- ou possui papel admin ativo). Cliente não decide mais.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.chat_messages_set_is_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_is_admin boolean := false;
BEGIN
  -- Verdade do servidor: o remetente é superusuário/admin?
  SELECT (u.is_superuser = true OR (u.user_type)::text = 'admin')
    INTO v_is_admin
    FROM users u
   WHERE u.id = NEW.sender_id;

  NEW.is_admin := COALESCE(v_is_admin, false);
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS chat_messages_set_is_admin ON public.chat_messages;
CREATE TRIGGER chat_messages_set_is_admin
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_set_is_admin();

COMMIT;

-- VERIFY (rollback)
/*
-- Como usuário comum, inserir is_admin=true deve resultar em is_admin=false.
*/
