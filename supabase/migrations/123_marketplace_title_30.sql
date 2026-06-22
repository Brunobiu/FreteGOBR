-- 123_marketplace_title_30.sql
-- ---------------------------------------------------------------------------
-- Marketplace — limita o título do anúncio a no máximo 30 caracteres (regra de
-- produto). Complementa a 122 (que mantém o teto de segurança 1..120 no schema
-- base). Idempotente: só adiciona a constraint se ainda não existir.
-- ---------------------------------------------------------------------------

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'marketplace_posts') THEN
    RAISE EXCEPTION 'marketplace_posts ausente: aplicar 122_marketplace antes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marketplace_posts_title_max30'
      AND conrelid = 'public.marketplace_posts'::regclass
  ) THEN
    ALTER TABLE marketplace_posts
      ADD CONSTRAINT marketplace_posts_title_max30
      CHECK (char_length(btrim(title)) BETWEEN 1 AND 30);
  END IF;
END
$check$;

COMMIT;

/*
-- VERIFY
SELECT conname FROM pg_constraint
  WHERE conname = 'marketplace_posts_title_max30'
    AND conrelid = 'public.marketplace_posts'::regclass;
*/
