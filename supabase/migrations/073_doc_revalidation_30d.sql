-- =====================================================
-- Migration 073: revalidação periódica de documentos do motorista (30 dias)
--
-- Regra (confirmada com o usuário):
--   Cada GRUPO de documentos do motorista — Tração, Carroceria, Complemento,
--   Referências e Contrato — vale por 30 dias corridos a partir da data de
--   confirmação. Cada grupo conta sozinho. Ao vencer, o motorista é avisado
--   (notificação do sistema + modal central) e deve confirmar que continua
--   com os mesmos documentos. UM botão confirma TUDO de uma vez (+30 dias);
--   não é preciso reenviar documento.
--
--   Vale para TODOS os cadastros já existentes — o relógio começa agora
--   (backfill com confirmed_at = NOW()).
--
--   Enquanto houver grupo vencido o motorista NÃO interage com fretes
--   (motorista_can_interact retorna false) e o feed fica bloqueado na UI.
--
-- Conteúdo:
--   1) Tabela motorista_doc_revalidation (1 linha por motorista).
--   2) Backfill de todos os motoristas existentes (relógio começa agora).
--   3) Trigger: novo motorista ganha linha com NOW() nos 5 grupos.
--   4) has_expired_doc_revalidation(uuid) — predicado de vencimento.
--   5) motorista_can_interact estendido para negar quando há grupo vencido.
--   6) get_my_doc_revalidation() — estado por grupo + cria notificação
--      idempotente quando detecta vencimento.
--   7) confirm_my_doc_revalidation() — reseta os 5 grupos para NOW().
-- =====================================================

BEGIN;

-- Validação defensiva: depende de admin-foundation (migration 030).
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema = 'public' AND routine_name = 'motorista_can_interact') THEN
    RAISE EXCEPTION 'Migration 071 (documents_blocked_gate) nao aplicada — motorista_can_interact ausente';
  END IF;
END
$check$;

-- 1) Tabela de revalidação ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.motorista_doc_revalidation (
  user_id                uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  tracao_confirmed_at    timestamptz NOT NULL DEFAULT now(),
  carroceria_confirmed_at timestamptz NOT NULL DEFAULT now(),
  complemento_confirmed_at timestamptz NOT NULL DEFAULT now(),
  referencias_confirmed_at timestamptz NOT NULL DEFAULT now(),
  contrato_confirmed_at  timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.motorista_doc_revalidation IS
  'Datas de confirmacao por grupo de documentos do motorista. Cada grupo vale 30 dias corridos a partir da confirmacao. (073)';

ALTER TABLE public.motorista_doc_revalidation ENABLE ROW LEVEL SECURITY;

-- O motorista só lê a própria linha; escrita é só via RPC SECURITY DEFINER.
DROP POLICY IF EXISTS doc_reval_select_own ON public.motorista_doc_revalidation;
CREATE POLICY doc_reval_select_own ON public.motorista_doc_revalidation
  FOR SELECT USING (user_id = auth.uid());

-- 2) Backfill: todos os motoristas existentes começam o relógio AGORA -----
INSERT INTO public.motorista_doc_revalidation (user_id)
SELECT u.id FROM public.users u
WHERE u.user_type = 'motorista'
ON CONFLICT (user_id) DO NOTHING;

-- 3) Trigger: novo motorista ganha linha automaticamente ------------------
CREATE OR REPLACE FUNCTION public.ensure_doc_revalidation_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
BEGIN
  IF NEW.user_type = 'motorista' THEN
    INSERT INTO public.motorista_doc_revalidation (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_ensure_doc_revalidation ON public.users;
CREATE TRIGGER users_ensure_doc_revalidation
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.ensure_doc_revalidation_row();

-- 4) Predicado de vencimento ----------------------------------------------
CREATE OR REPLACE FUNCTION public.has_expired_doc_revalidation(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_row record;
  v_cut timestamptz := now() - interval '30 days';
BEGIN
  SELECT * INTO v_row FROM motorista_doc_revalidation WHERE user_id = p_user_id;
  -- Sem linha = nunca confirmado; trata como vencido (motorista existente
  -- sempre tem linha via backfill/trigger, mas defendemos o caso ausente).
  IF NOT FOUND THEN RETURN true; END IF;
  RETURN (
    v_row.tracao_confirmed_at      < v_cut OR
    v_row.carroceria_confirmed_at  < v_cut OR
    v_row.complemento_confirmed_at < v_cut OR
    v_row.referencias_confirmed_at < v_cut OR
    v_row.contrato_confirmed_at    < v_cut
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.has_expired_doc_revalidation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_expired_doc_revalidation(uuid) TO authenticated;

-- 5) motorista_can_interact estendido -------------------------------------
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
  -- Documento recusado pelo admin pausa a interação (071).
  IF v_docs_blocked THEN RETURN false; END IF;
  -- Revalidação periódica vencida pausa a interação até confirmar (073).
  IF has_expired_doc_revalidation(p_user_id) THEN RETURN false; END IF;
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

-- 6) Estado por grupo + notificação idempotente ---------------------------
CREATE OR REPLACE FUNCTION public.get_my_doc_revalidation()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_type   text;
  v_name   text;
  v_row    record;
  v_cut    timestamptz := now() - interval '30 days';
  v_expired text[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT u.user_type, u.name INTO v_type, v_name FROM users u WHERE u.id = v_caller;
  IF v_type IS DISTINCT FROM 'motorista' THEN
    RETURN jsonb_build_object('applicable', false);
  END IF;

  -- Garante a existência da linha (motorista antigo sem backfill, defensivo).
  INSERT INTO motorista_doc_revalidation (user_id) VALUES (v_caller)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM motorista_doc_revalidation WHERE user_id = v_caller;

  v_expired := ARRAY(
    SELECT g FROM (
      VALUES
        ('tracao',      v_row.tracao_confirmed_at),
        ('carroceria',  v_row.carroceria_confirmed_at),
        ('complemento', v_row.complemento_confirmed_at),
        ('referencias', v_row.referencias_confirmed_at),
        ('contrato',    v_row.contrato_confirmed_at)
    ) AS t(g, confirmed_at)
    WHERE t.confirmed_at < v_cut
  );

  -- Notificação idempotente: só cria se há grupo vencido e não há uma
  -- notificação de revalidação ainda não lida para este motorista.
  IF array_length(v_expired, 1) IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = v_caller
        AND n.type = 'document_revalidation'
        AND n.read_at IS NULL
    ) THEN
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (
        v_caller,
        'document_revalidation',
        'Confirme seus documentos',
        coalesce(v_name, 'Motorista') ||
          ', confirme que você continua com os mesmos documentos e veículo para voltar a ver os fretes.',
        '/motorista/menu'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'applicable', true,
    'tracao_confirmed_at',      v_row.tracao_confirmed_at,
    'carroceria_confirmed_at',  v_row.carroceria_confirmed_at,
    'complemento_confirmed_at', v_row.complemento_confirmed_at,
    'referencias_confirmed_at', v_row.referencias_confirmed_at,
    'contrato_confirmed_at',    v_row.contrato_confirmed_at,
    'expired_groups',           to_jsonb(v_expired)
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.get_my_doc_revalidation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_doc_revalidation() TO authenticated;

-- 7) Confirmar tudo de uma vez --------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_my_doc_revalidation()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_caller uuid := auth.uid();
  v_type   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT u.user_type INTO v_type FROM users u WHERE u.id = v_caller;
  IF v_type IS DISTINCT FROM 'motorista' THEN
    RAISE EXCEPTION 'permission_denied: motorista required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO motorista_doc_revalidation (user_id) VALUES (v_caller)
  ON CONFLICT (user_id) DO UPDATE SET
    tracao_confirmed_at      = now(),
    carroceria_confirmed_at  = now(),
    complemento_confirmed_at = now(),
    referencias_confirmed_at = now(),
    contrato_confirmed_at    = now(),
    updated_at               = now();

  -- Marca como lidas as notificações de revalidação pendentes.
  UPDATE notifications
     SET read_at = now()
   WHERE user_id = v_caller
     AND type = 'document_revalidation'
     AND read_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'confirmed_at', now());
END;
$func$;
REVOKE ALL ON FUNCTION public.confirm_my_doc_revalidation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_my_doc_revalidation() TO authenticated;

COMMIT;

-- VERIFY (smoke manual)
/*
SELECT * FROM motorista_doc_revalidation LIMIT 5;
SELECT has_expired_doc_revalidation('d862e3af-663f-49a6-bd6a-d738af367f2a');
*/
