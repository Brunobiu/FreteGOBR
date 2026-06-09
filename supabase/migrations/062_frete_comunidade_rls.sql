-- =====================================================
-- Migration 062: Frete Comunidade — RLS de expiração no feed + flag de feature
--
-- Spec: .kiro/specs/frete-comunidade (Fase 2, task 8)
--
-- Reescreve fretes_select_policy PRESERVANDO toda a semântica atual
-- (dono vê o próprio; admin vê tudo) e adicionando, SOMENTE no ramo do feed
-- (status='ativo'):
--   (i)  Auto_Expiracao: now() < updated_at + INTERVAL '5 days' (Req 11.1/11.5);
--   (ii) ocultação de comunidade quando community_profile.enabled = false (Req 14.2).
--
-- Política anterior (migration base):
--   USING (status='ativo' OR embarcador_id=auth.uid()
--          OR EXISTS(users where id=auth.uid() and user_type='admin'))
--
-- Não-regressão: dono e admin continuam vendo seus fretes por ramos próprios
-- (não sofrem expiração). Só o feed público do motorista respeita os 5 dias.
--
-- Idempotente (DROP POLICY IF EXISTS + CREATE). Par: 062_..._rollback.sql.
-- =====================================================

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='fretes' AND column_name='source') THEN
    RAISE EXCEPTION 'Coluna fretes.source ausente -- aplique a 061 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='community_profile') THEN
    RAISE EXCEPTION 'Tabela community_profile ausente -- aplique a 061 antes.';
  END IF;
END
$check$;

DROP POLICY IF EXISTS fretes_select_policy ON fretes;
CREATE POLICY fretes_select_policy ON fretes
FOR SELECT USING (
  embarcador_id = auth.uid()
  OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.user_type::text = 'admin')
  OR (
    status::text = 'ativo'
    AND now() < updated_at + INTERVAL '5 days'
    AND (
      source <> 'comunidade'
      OR EXISTS (SELECT 1 FROM community_profile cp WHERE cp.enabled)
    )
  )
);

COMMIT;

-- =====================================================
-- VERIFY
-- =====================================================
/*
SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
 WHERE polrelid='public.fretes'::regclass AND polname='fretes_select_policy';
*/
