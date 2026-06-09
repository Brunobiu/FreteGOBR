-- =====================================================
-- Migration 061: Frete Comunidade — colunas, perfil singleton, dedup, expiração
--
-- Spec: .kiro/specs/frete-comunidade (Fase 1, task 6)
--
-- Entrega (idempotente, aditiva — não quebra o fluxo atual de embarcador):
--   - fretes: + source ('embarcador' | 'comunidade'), community_carrier_name,
--     community_contact_phone; CHECK condicional de coerência comunidade;
--     embarcador_id passa a NULLABLE (Frete_Comunidade grava NULL).
--   - índice parcial idx_fretes_source_comunidade (listagem admin).
--   - índice único funcional uq_fretes_dedup_active (rede de segurança dedup,
--     só status='ativo'); espelha computeDedupKey (TS) e a normalização SQL.
--   - tabela community_profile (singleton: foto/nome/nome secundário/enabled)
--     com RLS leitura pública + bloqueio total de DML por policy (escrita só
--     via RPC SECURITY DEFINER nas fases seguintes).
--   - bucket público community_profile (foto da marca).
--
-- NOTA: o reset de updated_at em UPDATE (Req 11.4) já é garantido pelo trigger
-- existente update_fretes_updated_at (update_updated_at_column). Não recriamos.
--
-- Padrões: admin-patterns §9 (DO $check$ defensivo), §10 (security posture).
-- Par: 061_frete_comunidade_rollback.sql (documentação, não auto-aplicado).
-- =====================================================

BEGIN;

-- ── Validações defensivas ────────────────────────────────────────────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='fretes') THEN
    RAISE EXCEPTION 'Tabela fretes ausente.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='is_admin_with_permission') THEN
    RAISE EXCEPTION 'is_admin_with_permission ausente (admin-foundation 030).';
  END IF;
END
$check$;

-- ── 1) Colunas novas em fretes ───────────────────────────────────────────
ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'embarcador';

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS community_carrier_name text NULL;

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS community_contact_phone text NULL;

-- CHECK do domínio fechado de source.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fretes_source_check') THEN
    ALTER TABLE fretes ADD CONSTRAINT fretes_source_check
      CHECK (source IN ('embarcador','comunidade'));
  END IF;
END
$c$;

-- CHECK de formato do telefone (só dígitos, 10/11) quando presente.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fretes_community_phone_check') THEN
    ALTER TABLE fretes ADD CONSTRAINT fretes_community_phone_check
      CHECK (community_contact_phone IS NULL OR community_contact_phone ~ '^[0-9]{10,11}$');
  END IF;
END
$c$;

-- CHECK condicional de coerência: comunidade exige carrier_name 1..120.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fretes_community_coherence') THEN
    ALTER TABLE fretes ADD CONSTRAINT fretes_community_coherence CHECK (
      source = 'embarcador'
      OR (
        source = 'comunidade'
        AND community_carrier_name IS NOT NULL
        AND char_length(btrim(community_carrier_name)) BETWEEN 1 AND 120
      )
    );
  END IF;
END
$c$;

-- ── 2) embarcador_id nullable (Frete_Comunidade grava NULL) ──────────────
ALTER TABLE fretes ALTER COLUMN embarcador_id DROP NOT NULL;

-- ── 3) Índice parcial para listagem admin de comunidade ──────────────────
CREATE INDEX IF NOT EXISTS idx_fretes_source_comunidade
  ON fretes (created_at DESC) WHERE source = 'comunidade';

-- ── 4) Índice único funcional de dedup (rede de segurança, só ativos) ────
-- Espelha computeDedupKey (src/utils/communityDedup.ts): normalização textual
-- = lower(regexp_replace(btrim(x), '\s+', ' ', 'g')); valor = round(value,2);
-- telefone = só dígitos. NÃO remove acento (paridade sem extensão unaccent).
DO $check$
DECLARE
  v_collisions int;
BEGIN
  SELECT COUNT(*) - COUNT(DISTINCT (
      lower(regexp_replace(btrim(origin), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(btrim(destination), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(btrim(coalesce(origin_detail,'')), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(btrim(coalesce(destination_detail,'')), '\s+', ' ', 'g')) || '|' ||
      round(value, 2)::text || '|' ||
      lower(regexp_replace(btrim(coalesce(product,'')), '\s+', ' ', 'g')) || '|' ||
      lower(regexp_replace(btrim(coalesce(community_carrier_name,'')), '\s+', ' ', 'g')) || '|' ||
      regexp_replace(coalesce(community_contact_phone,''), '\D', '', 'g')
    ))
    INTO v_collisions
    FROM fretes WHERE status = 'ativo';

  IF v_collisions > 0 THEN
    RAISE EXCEPTION 'Dedup index abortado: % colisões pré-existentes entre fretes ativos. Resolva antes de aplicar.', v_collisions;
  END IF;
END
$check$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fretes_dedup_active
ON fretes (
  lower(regexp_replace(btrim(origin), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(destination), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(coalesce(origin_detail,'')), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(coalesce(destination_detail,'')), '\s+', ' ', 'g')),
  round(value, 2),
  lower(regexp_replace(btrim(coalesce(product,'')), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(coalesce(community_carrier_name,'')), '\s+', ' ', 'g')),
  regexp_replace(coalesce(community_contact_phone,''), '\D', '', 'g')
)
WHERE status = 'ativo';

-- ── 5) Tabela community_profile (singleton) ──────────────────────────────
CREATE TABLE IF NOT EXISTS community_profile (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton      boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton = true),
  photo_path     text NULL CHECK (photo_path IS NULL OR char_length(photo_path) <= 500),
  name           text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120),
  secondary_name text NOT NULL DEFAULT '' CHECK (char_length(secondary_name) <= 160),
  enabled        boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO community_profile (singleton, name, secondary_name, enabled)
VALUES (true, '', '', true) ON CONFLICT DO NOTHING;

ALTER TABLE community_profile ENABLE ROW LEVEL SECURITY;

-- Leitura pública (marca, sem PII): card/modal do motorista lê foto+nome.
DROP POLICY IF EXISTS community_profile_public_read ON community_profile;
CREATE POLICY community_profile_public_read ON community_profile
  FOR SELECT TO anon, authenticated USING (true);

-- Bloqueio total de DML direto: escrita só via RPC SECURITY DEFINER.
DROP POLICY IF EXISTS community_profile_no_dml ON community_profile;
CREATE POLICY community_profile_no_dml ON community_profile
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── 6) Bucket público da foto da marca ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('community_profile', 'community_profile', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =====================================================
-- VERIFY (smoke manual)
-- =====================================================
/*
SELECT column_name, is_nullable, data_type FROM information_schema.columns
 WHERE table_name='fretes' AND column_name IN ('source','community_carrier_name','community_contact_phone','embarcador_id');
SELECT conname FROM pg_constraint WHERE conname IN
 ('fretes_source_check','fretes_community_phone_check','fretes_community_coherence');
SELECT indexname FROM pg_indexes WHERE tablename='fretes' AND indexname IN
 ('idx_fretes_source_comunidade','uq_fretes_dedup_active');
SELECT polname FROM pg_policy WHERE polrelid='public.community_profile'::regclass;
SELECT id, public FROM storage.buckets WHERE id='community_profile';
SELECT * FROM community_profile;
*/
