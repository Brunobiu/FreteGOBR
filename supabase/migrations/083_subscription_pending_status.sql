-- =====================================================
-- Migration 083: estado 'pending' de assinatura (R10)
--
-- Problema (cosmético, não-segurança): asaas-create-subscription gravava
-- subscriptions.status='active' assim que o checkout era criado, antes do
-- pagamento PIX/boleto ser confirmado. O acesso real NÃO é afetado
-- (motorista_can_interact lê users.subscription_status, que só o webhook muda),
-- mas a tabela/relatórios mostravam um checkout pendente como "ativo".
--
-- Correção: adiciona 'pending' ao CHECK de subscriptions.status. A edge passa a
-- gravar 'pending'; o webhook (subscription_mark_paid) promove para 'active' na
-- confirmação real do pagamento.
-- =====================================================

BEGIN;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'past_due'::text, 'suspended'::text, 'canceled'::text]));

COMMENT ON COLUMN public.subscriptions.status IS
  'pending=checkout criado aguardando pagamento; active=pago; past_due=vencido(grace); suspended; canceled. (083)';

COMMIT;
