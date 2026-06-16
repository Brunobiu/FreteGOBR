-- ============================================================================
-- Rollback Migration 092: whatsapp-automation
-- ============================================================================
-- ATENCAO: rollback DOCUMENTAL. NAO eh aplicado automaticamente.
-- Par manual de `092_whatsapp_automation.sql`, mantido apenas como
-- documentacao de reversao (convencao _rollback.sql do projeto). Aplicar
-- MANUALMENTE no SQL editor do ambiente APENAS em situacoes de cleanup
-- planejado do modulo WhatsApp_Module.
--
-- Escopo: desfaz EXCLUSIVAMENTE os objetos criados pela 092 — todas as
-- entidades `whatsapp_*`, o bucket/policies `whatsapp-media` e o job pg_cron
-- `whatsapp-job-worker-tick`. Dados de OUTRAS migrations sao preservados:
-- nada fora do prefixo `whatsapp_*` / bucket `whatsapp-media` eh tocado.
-- A tabela compartilhada `storage.objects` NAO eh removida — apenas as
-- policies e os objetos do bucket `whatsapp-media`.
--
-- Reversao em ordem INVERSA de dependencia (espelha as SECOES da 092):
--   1.  Job pg_cron `whatsapp-job-worker-tick`           (SECTION 11)
--   2.  Helpers/RPCs de gating e Vault                   (SECTIONS 13-14)
--   3.  Policies de storage + bucket `whatsapp-media`    (SECTION 10)
--   4.  Policies RLS das tabelas whatsapp_*              (SECTION 9, via CASCADE)
--   5.  Tabelas whatsapp_* (DROP ... CASCADE, FK reversa) (SECTIONS 3,5-8)
--   6.  Funcao de touch `whatsapp_touch_updated_at`      (SECTION 4)
--   7.  Dominios de status                               (SECTION 2)
--
-- Observacao sobre as policies RLS das tabelas whatsapp_*: `DROP TABLE ...
-- CASCADE` (passo 5) remove automaticamente as policies, triggers, indices e
-- constraints daquelas tabelas. Por isso o passo 4 trata apenas das policies
-- que vivem em tabelas NAO removidas (storage.objects, passo 3). Mantemos o
-- comentario do passo 4 para deixar a intencao explicita.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Job pg_cron `whatsapp-job-worker-tick` (SECTION 11)
-- ----------------------------------------------------------------------------
-- Guardado: so tenta desagendar se pg_cron existir; cron.unschedule lanca
-- excecao se o job nao existir, entao capturamos para nao falhar o rollback
-- em ambientes onde o job nunca foi criado (local/test sem as extensoes).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('whatsapp-job-worker-tick');
      RAISE NOTICE '[whatsapp-automation rollback] job pg_cron "whatsapp-job-worker-tick" removido.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[whatsapp-automation rollback] nenhum job pg_cron "whatsapp-job-worker-tick" para remover (ok).';
    END;
  ELSE
    RAISE NOTICE '[whatsapp-automation rollback] pg_cron ausente: nada a desagendar.';
  END IF;
END
$cron$;

-- ----------------------------------------------------------------------------
-- 2. Helpers/RPCs de gating RBAC e Vault (SECTIONS 13-14)
-- ----------------------------------------------------------------------------
-- Ordem inversa de criacao. Assinaturas exatas para casar a sobrecarga certa.
DROP FUNCTION IF EXISTS whatsapp_instance_secret_is_set(uuid, text);
DROP FUNCTION IF EXISTS whatsapp_set_instance_secret(uuid, text, text);
DROP FUNCTION IF EXISTS whatsapp_instance_secret_name(uuid, text);
DROP FUNCTION IF EXISTS whatsapp_assert_instance(uuid);
DROP FUNCTION IF EXISTS whatsapp_require_permission(text);
DROP FUNCTION IF EXISTS whatsapp_require_auth();

-- ----------------------------------------------------------------------------
-- 3. Policies de storage + bucket `whatsapp-media` (SECTION 10)
-- ----------------------------------------------------------------------------
-- As policies vivem em storage.objects (tabela compartilhada que NAO removemos);
-- por isso precisam de DROP POLICY explicito. Em seguida, removemos os objetos
-- do bucket e o bucket. Apenas o bucket `whatsapp-media` eh tocado.
DROP POLICY IF EXISTS whatsapp_media_select ON storage.objects;
DROP POLICY IF EXISTS whatsapp_media_insert ON storage.objects;
DROP POLICY IF EXISTS whatsapp_media_update ON storage.objects;
DROP POLICY IF EXISTS whatsapp_media_delete ON storage.objects;

-- Remove os objetos do bucket antes do bucket (FK storage.objects -> buckets).
DELETE FROM storage.objects WHERE bucket_id = 'whatsapp-media';
DELETE FROM storage.buckets WHERE id = 'whatsapp-media';

-- ----------------------------------------------------------------------------
-- 4. Policies RLS das tabelas whatsapp_* (SECTION 9)
-- ----------------------------------------------------------------------------
-- Removidas automaticamente pelo DROP TABLE ... CASCADE do passo 5 (junto com
-- triggers, indices e constraints). Nenhum DROP POLICY explicito necessario
-- aqui — as policies das tabelas whatsapp_* desaparecem com as proprias tabelas.

-- ----------------------------------------------------------------------------
-- 5. Tabelas whatsapp_* (SECTIONS 3, 5-8) — DROP ... CASCADE em ordem reversa de FK
-- ----------------------------------------------------------------------------
-- Filhos primeiro, raiz (whatsapp_instances) por ultimo. CASCADE garante a
-- remocao de FKs retroativas (ex.: fk_whatsapp_contents_dispatch_job), triggers
-- de touch e policies RLS associadas.
DROP TABLE IF EXISTS whatsapp_ai_replies CASCADE;
DROP TABLE IF EXISTS whatsapp_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_conversations CASCADE;
DROP TABLE IF EXISTS whatsapp_ai_configs CASCADE;
DROP TABLE IF EXISTS whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS whatsapp_extracted_contacts CASCADE;
DROP TABLE IF EXISTS whatsapp_groups CASCADE;
DROP TABLE IF EXISTS whatsapp_scheduled_dispatches CASCADE;
DROP TABLE IF EXISTS whatsapp_group_dispatches CASCADE;
DROP TABLE IF EXISTS whatsapp_dispatch_recipients CASCADE;
DROP TABLE IF EXISTS whatsapp_content_media CASCADE;
DROP TABLE IF EXISTS whatsapp_contents CASCADE;
DROP TABLE IF EXISTS whatsapp_dispatch_jobs CASCADE;
DROP TABLE IF EXISTS whatsapp_contacts CASCADE;
DROP TABLE IF EXISTS whatsapp_contact_lists CASCADE;
DROP TABLE IF EXISTS whatsapp_instances CASCADE;

-- ----------------------------------------------------------------------------
-- 6. Funcao de touch compartilhada (SECTION 4)
-- ----------------------------------------------------------------------------
-- Os triggers que a usavam ja foram removidos com as tabelas (passo 5), entao
-- a funcao pode ser removida sem CASCADE.
DROP FUNCTION IF EXISTS whatsapp_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Dominios de status (SECTION 2)
-- ----------------------------------------------------------------------------
-- As colunas que usavam estes dominios ja foram removidas com as tabelas
-- (passo 5), entao os dominios podem ser removidos por ultimo.
DROP DOMAIN IF EXISTS msg_direction;
DROP DOMAIN IF EXISTS conversation_mode;
DROP DOMAIN IF EXISTS media_type;
DROP DOMAIN IF EXISTS dispatch_kind;
DROP DOMAIN IF EXISTS distribution_mode;
DROP DOMAIN IF EXISTS recipient_status;
DROP DOMAIN IF EXISTS dispatch_status;
DROP DOMAIN IF EXISTS session_status;

COMMIT;

-- ============================================================================
-- VERIFY (smoke-test manual pos-rollback — bloco comentado, NAO executa)
-- ----------------------------------------------------------------------------
-- Descomente e rode no SQL editor apos aplicar o rollback para confirmar a
-- remocao completa dos objetos do modulo.
-- ============================================================================
/*
-- Nenhuma tabela whatsapp_* deve restar:
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'whatsapp_%'
 ORDER BY table_name;

-- Nenhuma funcao do modulo deve restar:
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema = 'public' AND routine_name LIKE 'whatsapp_%'
 ORDER BY routine_name;

-- Nenhum dominio de status deve restar:
SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'public'
   AND t.typname IN ('session_status','dispatch_status','recipient_status',
                     'distribution_mode','dispatch_kind','media_type',
                     'conversation_mode','msg_direction')
 ORDER BY t.typname;

-- Bucket e policies de storage removidos:
SELECT id FROM storage.buckets WHERE id = 'whatsapp-media';
SELECT polname FROM pg_policy WHERE polname LIKE 'whatsapp_media_%';

-- Job pg_cron removido:
SELECT jobname FROM cron.job WHERE jobname = 'whatsapp-job-worker-tick';
*/
