-- ============================================================================
-- Migration 029: Garante que `fretes` esteja na publicação supabase_realtime
-- ============================================================================
-- Idempotente. Sem isso, o canal `postgres_changes` na HomePage nunca
-- recebe INSERTs/UPDATEs e os motoristas precisam refresh pra ver
-- novos fretes publicados.
-- ============================================================================

DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE fretes;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$pub$;

-- REPLICA IDENTITY FULL pra que UPDATEs (status: ativo→encerrado) também
-- venham completos no payload.
ALTER TABLE fretes REPLICA IDENTITY FULL;
