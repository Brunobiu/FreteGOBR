-- =====================================================
-- ROLLBACK Migration 079 — documentação, NÃO recomendado.
-- Reabre as RPCs financeiras ao cliente (volta o bypass de pagamento).
-- Use só se algo legítimo depender da execução por authenticated (não é o caso).
-- O guard interno (current_user) continuaria barrando mesmo com o GRANT, então
-- um rollback real exigiria também recriar as funções sem o IF — ver 057.
-- =====================================================

BEGIN;

GRANT EXECUTE ON FUNCTION subscription_mark_paid(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION subscription_mark_past_due(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION subscription_suspend(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION subscription_reactivate(uuid, text)  TO authenticated;

COMMIT;
