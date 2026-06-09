-- =====================================================
-- ROLLBACK da Migration 061: Frete Comunidade
--
-- Documentação — NÃO auto-aplicado. Reverte os objetos da 061.
--
-- ATENÇÃO: este rollback assume que NÃO há fretes com source='comunidade'
-- publicados. Se houver, eles deixarão embarcador_id NULL órfão ao reverter
-- o NOT NULL; remova/migre esses fretes antes (DELETE FROM fretes WHERE
-- source='comunidade';) e só então rode o ALTER ... SET NOT NULL.
-- =====================================================

BEGIN;

-- Bucket (remove só se vazio; objetos precisam ser apagados antes).
-- DELETE FROM storage.objects WHERE bucket_id='community_profile';
DELETE FROM storage.buckets WHERE id='community_profile';

-- Tabela singleton.
DROP POLICY IF EXISTS community_profile_no_dml ON community_profile;
DROP POLICY IF EXISTS community_profile_public_read ON community_profile;
DROP TABLE IF EXISTS community_profile;

-- Índices.
DROP INDEX IF EXISTS uq_fretes_dedup_active;
DROP INDEX IF EXISTS idx_fretes_source_comunidade;

-- Constraints.
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS fretes_community_coherence;
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS fretes_community_phone_check;
ALTER TABLE fretes DROP CONSTRAINT IF EXISTS fretes_source_check;

-- Colunas.
ALTER TABLE fretes DROP COLUMN IF EXISTS community_contact_phone;
ALTER TABLE fretes DROP COLUMN IF EXISTS community_carrier_name;
ALTER TABLE fretes DROP COLUMN IF EXISTS source;

-- Restaura NOT NULL de embarcador_id (só se não houver linhas NULL).
-- ALTER TABLE fretes ALTER COLUMN embarcador_id SET NOT NULL;

COMMIT;
