-- =====================================================
-- Migration 070: tickets órfãos viram "de convidado" ao excluir usuário
--
-- A tabela support_tickets tem user_id ON DELETE SET NULL, mas a constraint
-- chk_user_xor_guest exige (user_id) XOR (guest_name+guest_email). Ao excluir
-- um usuário, o user_id virava NULL e a linha ficava inválida (sem user E sem
-- guest), abortando a exclusão inteira.
--
-- Este trigger BEFORE UPDATE preenche guest_name/guest_email a partir do
-- usuário removido, convertendo o ticket em "de convidado" e preservando o
-- histórico, sem quebrar a exclusão.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION support_tickets_orphan_to_guest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_name  text;
  v_email text;
BEGIN
  IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
     AND (NEW.guest_name IS NULL OR NEW.guest_email IS NULL) THEN

    SELECT name, email INTO v_name, v_email FROM users WHERE id = OLD.user_id;

    v_name := COALESCE(NULLIF(btrim(COALESCE(v_name, '')), ''), 'Usuário removido');
    IF char_length(v_name) < 2 THEN v_name := 'Usuário removido'; END IF;
    IF char_length(v_name) > 80 THEN v_name := left(v_name, 80); END IF;

    IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_email := 'removido+' || OLD.user_id::text || '@fretego.local';
    END IF;

    NEW.guest_name  := v_name;
    NEW.guest_email := v_email;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS support_tickets_orphan_to_guest ON public.support_tickets;
CREATE TRIGGER support_tickets_orphan_to_guest
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_tickets_orphan_to_guest();

COMMIT;
