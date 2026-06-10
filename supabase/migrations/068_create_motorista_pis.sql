-- =====================================================
-- Migration 068: cria a tabela motorista_pis
--
-- O app já consome esta tabela (getUserData/loadAll e o upsert de PIS no
-- MotoristaPerfilPage). A ausência causava 404 (Not Found) repetidos no
-- painel do motorista e podia quebrar carregamentos.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.motorista_pis (
  user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  pis_number varchar(20) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.motorista_pis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motorista_pis_select_own ON public.motorista_pis;
CREATE POLICY motorista_pis_select_own ON public.motorista_pis
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS motorista_pis_insert_own ON public.motorista_pis;
CREATE POLICY motorista_pis_insert_own ON public.motorista_pis
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS motorista_pis_update_own ON public.motorista_pis;
CREATE POLICY motorista_pis_update_own ON public.motorista_pis
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMIT;
