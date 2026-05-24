-- ============================================================================
-- Migration 026: REPLICA IDENTITY FULL em messages
-- ============================================================================
-- Por padrão, eventos de UPDATE no Postgres CDC enviam apenas a chave
-- primária no `old` e os campos modificados no `new`. Pra que a página de
-- mensagens consiga atualizar os tiquinhos de leitura (read_at) via
-- realtime, precisamos da linha completa nos eventos.
-- Idempotente: rodar de novo é no-op.
-- ============================================================================

ALTER TABLE messages REPLICA IDENTITY FULL;
