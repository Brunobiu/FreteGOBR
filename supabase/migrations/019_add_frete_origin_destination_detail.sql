-- ============================================================================
-- Migration 019: Detalhes de origem e destino do frete
-- ============================================================================
-- Idempotente. Apenas ADD COLUMN IF NOT EXISTS. NÃO altera nenhuma RLS,
-- nenhuma constraint, nenhuma outra tabela.
--
-- Permite ao embarcador informar texto livre adicional sobre o ponto exato
-- de carregamento (fazenda, armazém, depósito, etc) e o ponto exato de
-- entrega no destino. Esses campos são exibidos APENAS no modal de
-- detalhes do frete (não no card resumido).
-- ============================================================================

BEGIN;

ALTER TABLE fretes ADD COLUMN IF NOT EXISTS origin_detail      TEXT;
ALTER TABLE fretes ADD COLUMN IF NOT EXISTS destination_detail TEXT;

COMMIT;
