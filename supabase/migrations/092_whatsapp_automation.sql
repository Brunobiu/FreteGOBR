-- ============================================================================
-- Migration 092: whatsapp-automation
-- ============================================================================
-- Spec: .kiro/specs/whatsapp-automation
--
-- Substitui o placeholder de /admin/whatsapp por uma central de automacao de
-- WhatsApp multi-instancia, ilimitada e data-driven, integrada a Evolution API.
-- Toda entidade do modulo e chaveada por `instance_id`; nenhuma camada codifica
-- a quantidade de instancias de forma fixa. Max_Instances = COUNT de linhas
-- habilitadas em `whatsapp_instances` (valor inicial 5 via seed idempotente).
--
-- Esta migration e construida em fatias (tasks 1.1..1.9 da spec), todas no
-- MESMO arquivo, em secoes claramente comentadas:
--   SECAO 1  Validacoes defensivas (DO $check$)            -- task 1.1
--   SECAO 2  Dominios/CHECKs de status                     -- task 1.1
--   SECAO 3  whatsapp_instances + seed idempotente         -- task 1.1
--   SECAO 4  Funcao de touch updated_at (compartilhada)    -- task 1.2
--   SECAO 5  Contatos e conteudos                          -- task 1.2
--   SECAO 6  Jobs e destinatarios de disparo               -- task 1.3
--   SECAO 7  Grupos, agendados, cache e extracao           -- task 1.4
--   SECAO 8  Sessao, IA, conversas e mensagens             -- task 1.5
--   SECAO 9  RLS por instance_id                           -- task 1.6
--   SECAO 10 Bucket de storage whatsapp-media              -- task 1.7
--   SECAO 11 Agendamento do worker via pg_cron             -- task 1.8
--   SECAO 12 Bloco -- VERIFY (smoke test manual)           -- task 1.8
--
-- Numeracao: 044 era a proxima livre quando a spec foi escrita, mas 044 ja
-- estava em uso (044_trial_e_bloqueio). 092 e a proxima livre real
-- (ultima aplicada: 091). O par rollback fica em
-- `092_whatsapp_automation_rollback.sql` (task 1.9), documentado e NAO
-- auto-aplicado.
--
-- Dependencias:
--   - 030 admin-foundation (is_admin_with_permission, admin_audit_logs)
--
-- Idempotente: DO-guards para dominios, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING no seed.
-- _Requirements: 18.2, 29.1, 29.3, 29.4, 29.5, 29.7_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- SECAO 1. Validacoes defensivas (task 1.1)
-- ----------------------------------------------------------------------------
-- O modulo herda o RBAC do painel admin (migration 030). Aborta cedo se a
-- fundacao nao estiver aplicada, evitando objetos orfaos sem gating.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
     WHERE routine_schema = 'public'
       AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: is_admin_with_permission ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'admin_audit_logs'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao aplicada: admin_audit_logs ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- SECAO 2. Dominios/CHECKs de status (task 1.1)
-- ----------------------------------------------------------------------------
-- Dominios fechados reutilizados por todas as tabelas whatsapp_* (secoes 5-8).
-- Modelados como DOMAIN text + CHECK (VALUE IN (...)) para validacao no banco.
-- A nulabilidade fica a cargo de cada coluna (ex.: distribution_mode e NULL
-- para disparos de grupo), portanto os dominios NAO impoem NOT NULL.
-- CREATE DOMAIN nao suporta IF NOT EXISTS; cada criacao e guardada por DO-block
-- para manter a migration idempotente.
DO $domains$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'session_status' AND n.nspname = 'public') THEN
    CREATE DOMAIN session_status AS text
      CHECK (VALUE IN ('DISCONNECTED','CONNECTING','QR_PENDING','CONNECTED','EXPIRED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'dispatch_status' AND n.nspname = 'public') THEN
    CREATE DOMAIN dispatch_status AS text
      CHECK (VALUE IN ('DRAFT','QUEUED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'recipient_status' AND n.nspname = 'public') THEN
    CREATE DOMAIN recipient_status AS text
      CHECK (VALUE IN ('PENDING','SENDING','SENT','FAILED','SKIPPED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'distribution_mode' AND n.nspname = 'public') THEN
    CREATE DOMAIN distribution_mode AS text
      CHECK (VALUE IN ('BLOCK','INTERLEAVED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'dispatch_kind' AND n.nspname = 'public') THEN
    CREATE DOMAIN dispatch_kind AS text
      CHECK (VALUE IN ('BULK','GROUP'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'media_type' AND n.nspname = 'public') THEN
    CREATE DOMAIN media_type AS text
      CHECK (VALUE IN ('IMAGE','VIDEO','AUDIO','DOCUMENT'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'conversation_mode' AND n.nspname = 'public') THEN
    CREATE DOMAIN conversation_mode AS text
      CHECK (VALUE IN ('AI_MODE','HUMAN_MODE','AI_PAUSED','RETURNED_TO_AI'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'msg_direction' AND n.nspname = 'public') THEN
    CREATE DOMAIN msg_direction AS text
      CHECK (VALUE IN ('INBOUND','OUTBOUND'));
  END IF;
END
$domains$;

-- ----------------------------------------------------------------------------
-- SECAO 3. whatsapp_instances + seed idempotente (task 1.1)
-- ----------------------------------------------------------------------------
-- Fonte de verdade do modelo data-driven. Cada WhatsApp_Instance e um ambiente
-- isolado; todas as demais tabelas referenciam whatsapp_instances(id).
-- Max_Instances NAO e uma constante: e derivado como
--   SELECT COUNT(*) FROM whatsapp_instances WHERE enabled = true;
-- Aumentar o numero de instancias = inserir linhas, sem DDL (Req 29.3).
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label                   text NOT NULL,            -- "WhatsApp 1", "WhatsApp 2", ...
  display_order           int NOT NULL,             -- ordenacao no painel (NAO e limite)
  enabled                 boolean NOT NULL DEFAULT true,
  evolution_instance_name text NOT NULL,            -- derivado do id (frego_wa_<id>)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_instances_evolution_name UNIQUE (evolution_instance_name),
  CONSTRAINT uq_whatsapp_instances_display_order  UNIQUE (display_order)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_enabled
  ON whatsapp_instances (display_order) WHERE enabled = true;

-- Seed inicial: 5 linhas habilitadas (valor inicial de Max_Instances, Req 29.1).
-- O "5" aqui e apenas a quantidade-semente; nenhuma LOGICA depende dele — a
-- contagem de instancias e sempre lida do COUNT de linhas habilitadas.
-- evolution_instance_name e derivado do id gerado (frego_wa_<id>), conforme o
-- design (a sessao na Evolution e nomeada deterministicamente pelo instance_id).
-- Idempotente: ON CONFLICT (display_order) DO NOTHING — reaplicar nao duplica.
WITH seed AS (
  SELECT gen_random_uuid() AS id, g AS display_order
    FROM generate_series(1, 5) AS g
)
INSERT INTO whatsapp_instances (id, label, display_order, enabled, evolution_instance_name)
SELECT id,
       'WhatsApp ' || display_order::text,
       display_order,
       true,
       'frego_wa_' || id::text
  FROM seed
ON CONFLICT (display_order) DO NOTHING;

-- ----------------------------------------------------------------------------
-- SECOES 4-12 (tasks 1.2..1.8) sao ANEXADAS ABAIXO, antes do COMMIT.
-- Manter cada secao claramente comentada e idempotente.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- SECAO 4. Funcao de touch updated_at compartilhada (task 1.2)
-- ----------------------------------------------------------------------------
-- Funcao de trigger unica reutilizada por TODAS as tabelas whatsapp_* que tem
-- coluna updated_at (secoes 5-8). Criada apenas uma vez aqui; secoes posteriores
-- apenas anexam triggers BEFORE UPDATE apontando para ela. CREATE OR REPLACE
-- mantem a operacao idempotente. SET search_path = public evita search-path
-- attacks (mesma postura das RPCs SECURITY DEFINER do painel).
CREATE OR REPLACE FUNCTION whatsapp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $touch$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$touch$;

-- ----------------------------------------------------------------------------
-- SECAO 5. Contatos e conteudos (task 1.2)
-- ----------------------------------------------------------------------------
-- Listas de contatos, contatos, conteudos e midias. Todas chaveadas por
-- instance_id (NOT NULL + FK ON DELETE CASCADE) para isolamento multi-instancia
-- (Req 2.5). created_at/updated_at em todas, com trigger de touch compartilhado
-- (SECAO 4). Indices (instance_id, ...) para leitura escopada por instancia.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS; triggers guardados por
-- DROP TRIGGER IF EXISTS antes de CREATE TRIGGER.

-- 5.1 Listas de contatos (Req 5.3, 25.3)
CREATE TABLE IF NOT EXISTS whatsapp_contact_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contact_lists_instance
  ON whatsapp_contact_lists (instance_id);

DROP TRIGGER IF EXISTS trg_whatsapp_contact_lists_touch ON whatsapp_contact_lists;
CREATE TRIGGER trg_whatsapp_contact_lists_touch
  BEFORE UPDATE ON whatsapp_contact_lists
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 5.2 Contatos (Req 5.3 dedup por lista, 25.3 recipient_data do CSV)
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id    uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  list_id        uuid NOT NULL REFERENCES whatsapp_contact_lists(id) ON DELETE CASCADE,
  phone          text NOT NULL,                       -- E.164 normalizado
  recipient_data jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {nome,empresa,...} do CSV
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_contacts_list_phone UNIQUE (list_id, phone)  -- dedup por lista
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_instance
  ON whatsapp_contacts (instance_id, list_id);

DROP TRIGGER IF EXISTS trg_whatsapp_contacts_touch ON whatsapp_contacts;
CREATE TRIGGER trg_whatsapp_contacts_touch
  BEFORE UPDATE ON whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 5.3 Conteudos (Req 6.5 texto OU >=1 midia; 7.3 ordem por position; 25.7 template)
-- dispatch_job_id e uma coluna nullable aqui; a FK para whatsapp_dispatch_jobs e
-- adicionada na SECAO 6 (task 1.3), pois aquela tabela ainda nao existe neste ponto.
CREATE TABLE IF NOT EXISTS whatsapp_contents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  dispatch_job_id uuid,                             -- FK adicionada na SECAO 6 (task 1.3)
  body            text,                             -- template com Message_Variables
  position        int NOT NULL,                     -- ordem para INTERLEAVED/BLOCK
  is_valid        boolean NOT NULL DEFAULT true,    -- texto OU >=1 midia
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contents_instance
  ON whatsapp_contents (instance_id, dispatch_job_id, position);

DROP TRIGGER IF EXISTS trg_whatsapp_contents_touch ON whatsapp_contents;
CREATE TRIGGER trg_whatsapp_contents_touch
  BEFORE UPDATE ON whatsapp_contents
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 5.4 Midias de conteudo (Req 6.3 MIME validado; 6.4 bucket whatsapp-media)
CREATE TABLE IF NOT EXISTS whatsapp_content_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  content_id   uuid NOT NULL REFERENCES whatsapp_contents(id) ON DELETE CASCADE,
  media_type   media_type NOT NULL,                 -- dominio (SECAO 2)
  storage_path text NOT NULL,                        -- bucket whatsapp-media
  mime_type    text NOT NULL,                        -- validado, INVALID_FILE_TYPE
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_content_media_instance
  ON whatsapp_content_media (instance_id, content_id);

DROP TRIGGER IF EXISTS trg_whatsapp_content_media_touch ON whatsapp_content_media;
CREATE TRIGGER trg_whatsapp_content_media_touch
  BEFORE UPDATE ON whatsapp_content_media
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- ----------------------------------------------------------------------------
-- SECAO 6. Jobs e destinatarios de disparo (task 1.3)
-- ----------------------------------------------------------------------------
-- Fila duravel do motor de disparo (massa/grupo). O banco e a unica fonte de
-- verdade: o Job_Worker (Edge Function via pg_cron) drena `whatsapp_dispatch_jobs`
-- e processa cada `whatsapp_dispatch_recipient` como unidade idempotente de
-- trabalho (sem envio duplicado mesmo apos restart). Ambas chaveadas por
-- instance_id (NOT NULL + FK ON DELETE CASCADE) para isolamento multi-instancia
-- (Req 2.5). created_at/updated_at com trigger de touch compartilhado (SECAO 4).
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS; triggers guardados por
-- DROP TRIGGER IF EXISTS; FK retroativa em whatsapp_contents guardada por DO-block.

-- 6.1 Jobs de disparo (Req 7.6 distribuicao, 8.5 quota/pacing, 10.1/10.3 durabilidade,
--     20.10 Execution_Duration via started_at/completed_at, 23.1 failure tracking)
CREATE TABLE IF NOT EXISTS whatsapp_dispatch_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  kind              dispatch_kind NOT NULL,                 -- BULK | GROUP (dominio SECAO 2)
  status            dispatch_status NOT NULL DEFAULT 'DRAFT', -- dominio (SECAO 2)
  distribution_mode distribution_mode,                      -- NULL para GROUP (dominio SECAO 2)
  block_size        int,                                    -- para BLOCK (Req 7.2)
  send_interval_sec int NOT NULL CHECK (send_interval_sec > 0),  -- Req 8.2
  execution_quota   int CHECK (execution_quota >= 1),       -- Req 8.4
  total_count       int NOT NULL DEFAULT 0,
  sent_count        int NOT NULL DEFAULT 0,
  failed_count      int NOT NULL DEFAULT 0,
  skipped_count     int NOT NULL DEFAULT 0,
  exec_sent_count   int NOT NULL DEFAULT 0,                 -- enviados na execucao corrente (quota, Req 8.5)
  source_job_id     uuid,                                   -- duplicar/reenviar/failed-resend (Req 20,23)
  started_at        timestamptz,                            -- Execution_Duration (Req 20.10)
  completed_at      timestamptz,
  last_send_at      timestamptz,                            -- pacing sem dormir (Req 8.6)
  failure_code      text,                                   -- JOB_FAILED (Req 10.8)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_dispatch_jobs_instance_status
  ON whatsapp_dispatch_jobs (instance_id, status);

DROP TRIGGER IF EXISTS trg_whatsapp_dispatch_jobs_touch ON whatsapp_dispatch_jobs;
CREATE TRIGGER trg_whatsapp_dispatch_jobs_touch
  BEFORE UPDATE ON whatsapp_dispatch_jobs
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 6.2 Destinatarios do disparo (Req 7.4 exatamente 1 content; 10.4 claim do proximo
--     PENDING por seq; 23.1/23.8 failure_reason pt-BR sem segredos; 25.2 snapshot p/ render)
CREATE TABLE IF NOT EXISTS whatsapp_dispatch_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id         uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  dispatch_job_id     uuid NOT NULL REFERENCES whatsapp_dispatch_jobs(id) ON DELETE CASCADE,
  target_kind         text NOT NULL,                          -- 'CONTACT' | 'GROUP'
  phone               text,                                   -- para CONTACT
  group_jid           text,                                   -- para GROUP
  recipient_data      jsonb NOT NULL DEFAULT '{}'::jsonb,      -- snapshot p/ render (Req 25.2)
  assigned_content_id uuid REFERENCES whatsapp_contents(id),   -- exatamente 1 (Req 7.4)
  seq                 int NOT NULL,                            -- ordem deterministica de processamento
  status              recipient_status NOT NULL DEFAULT 'PENDING', -- dominio (SECAO 2)
  sent_at             timestamptz,
  failure_reason      text,                                    -- pt-BR, sem segredos
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_dispatch_recipients_job_seq UNIQUE (dispatch_job_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_dispatch_recipients_job_status
  ON whatsapp_dispatch_recipients (dispatch_job_id, status);  -- claim do proximo PENDING (Req 10.4)

DROP TRIGGER IF EXISTS trg_whatsapp_dispatch_recipients_touch ON whatsapp_dispatch_recipients;
CREATE TRIGGER trg_whatsapp_dispatch_recipients_touch
  BEFORE UPDATE ON whatsapp_dispatch_recipients
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 6.3 FK retroativa em whatsapp_contents.dispatch_job_id (criada nullable na SECAO 5,
--     task 1.2, SEM FK porque whatsapp_dispatch_jobs ainda nao existia). Agora que a
--     tabela existe, adiciona a FK. Guardado por DO-block para idempotencia: so cria
--     a constraint se ela ainda nao existir (reaplicar a migration nao falha).
DO $contents_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_whatsapp_contents_dispatch_job'
       AND conrelid = 'public.whatsapp_contents'::regclass
  ) THEN
    ALTER TABLE whatsapp_contents
      ADD CONSTRAINT fk_whatsapp_contents_dispatch_job
      FOREIGN KEY (dispatch_job_id) REFERENCES whatsapp_dispatch_jobs(id) ON DELETE SET NULL;
  END IF;
END
$contents_fk$;

-- ----------------------------------------------------------------------------
-- SECAO 7. Grupos, agendados, cache e extracao (task 1.4)
-- ----------------------------------------------------------------------------
-- Disparo em grupo, disparos programados, cache de grupos da Evolution API e
-- contatos extraidos. Todas chaveadas por instance_id (NOT NULL + FK
-- ON DELETE CASCADE) para isolamento multi-instancia (Req 2.5). created_at em
-- todas; updated_at + trigger de touch compartilhado (SECAO 4) onde aplicavel.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS; triggers guardados por
-- DROP TRIGGER IF EXISTS antes de CREATE TRIGGER.

-- 7.1 Disparo em grupo (Req 12.2: 1+ grupos por disparo). Compartilha o motor
--     duravel (whatsapp_dispatch_jobs/recipients); guarda apenas a lista de JIDs
--     de grupo alvo do job. group_jids NOT NULL (>= 1 grupo validado no backend).
CREATE TABLE IF NOT EXISTS whatsapp_group_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  dispatch_job_id uuid NOT NULL REFERENCES whatsapp_dispatch_jobs(id) ON DELETE CASCADE,
  group_jids      text[] NOT NULL,                  -- 1+ grupos (Req 12.2)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_dispatches_instance
  ON whatsapp_group_dispatches (instance_id, dispatch_job_id);

DROP TRIGGER IF EXISTS trg_whatsapp_group_dispatches_touch ON whatsapp_group_dispatches;
CREATE TRIGGER trg_whatsapp_group_dispatches_touch
  BEFORE UPDATE ON whatsapp_group_dispatches
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 7.2 Disparos programados (Req 13.1 destinatarios+conteudos; 13.2 data/hora futura).
--     scheduled_at = quando executar; executed_at NULL = pendente. No tick, o worker
--     faz QUEUED qualquer scheduled com scheduled_at <= now AND executed_at IS NULL.
--     Indice PARCIAL em (instance_id, scheduled_at) WHERE executed_at IS NULL torna
--     a varredura de pendentes vencidos barata (Req 13.3, 27.4).
CREATE TABLE IF NOT EXISTS whatsapp_scheduled_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  dispatch_job_id uuid NOT NULL REFERENCES whatsapp_dispatch_jobs(id) ON DELETE CASCADE,
  scheduled_at    timestamptz NOT NULL,             -- futuro (Req 13.2)
  executed_at     timestamptz,                      -- NULL = pendente
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_scheduled_dispatches_pending
  ON whatsapp_scheduled_dispatches (instance_id, scheduled_at)
  WHERE executed_at IS NULL;                        -- varredura de vencidos pendentes

DROP TRIGGER IF EXISTS trg_whatsapp_scheduled_dispatches_touch ON whatsapp_scheduled_dispatches;
CREATE TRIGGER trg_whatsapp_scheduled_dispatches_touch
  BEFORE UPDATE ON whatsapp_scheduled_dispatches
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 7.3 Cache de grupos da Evolution API (Req 12.1 selecao de grupos; 17.1 extracao).
--     Alimentado pelo proxy Evolution. UNIQUE(instance_id, group_jid) garante 1 linha
--     de cache por grupo/instancia (upsert no refresh). fetched_at = ultima atualizacao.
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  group_jid         text NOT NULL,
  name              text,
  participant_count int,
  fetched_at        timestamptz,                    -- ultima sincronizacao com a Evolution
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_groups_instance_jid UNIQUE (instance_id, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_instance
  ON whatsapp_groups (instance_id);

DROP TRIGGER IF EXISTS trg_whatsapp_groups_touch ON whatsapp_groups;
CREATE TRIGGER trg_whatsapp_groups_touch
  BEFORE UPDATE ON whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 7.4 Contatos extraidos (Req 17.1 extracao de participantes de grupos; 17.8 validacao).
--     extraction_id agrupa os contatos de uma mesma operacao de extracao. source_group_jid
--     indica o grupo de origem. is_valid marca numeros que passaram na validacao E.164.
--     INDEX(instance_id, extraction_id) para leitura escopada por operacao de extracao.
CREATE TABLE IF NOT EXISTS whatsapp_extracted_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id      uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  extraction_id    uuid NOT NULL,                   -- agrupa contatos de uma extracao
  source_group_jid text,                            -- grupo de origem
  phone            text NOT NULL,
  is_valid         boolean NOT NULL DEFAULT true,   -- passou na validacao E.164
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_extracted_contacts_extraction
  ON whatsapp_extracted_contacts (instance_id, extraction_id);

DROP TRIGGER IF EXISTS trg_whatsapp_extracted_contacts_touch ON whatsapp_extracted_contacts;
CREATE TRIGGER trg_whatsapp_extracted_contacts_touch
  BEFORE UPDATE ON whatsapp_extracted_contacts
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- ----------------------------------------------------------------------------
-- SECAO 8. Sessao, IA, conversas e mensagens (task 1.5)
-- ----------------------------------------------------------------------------
-- Sessao unica por instancia, configuracao de IA, conversas (inbox hibrido
-- IA<->humano) e mensagens. Todas chaveadas por instance_id (NOT NULL + FK
-- ON DELETE CASCADE) para isolamento multi-instancia (Req 2.5). Tabelas mutaveis
-- (sessions, ai_configs, conversations) tem created_at/updated_at + trigger de
-- touch compartilhado (SECAO 4); tabelas append-only (messages, ai_replies) tem
-- apenas created_at (registros imutaveis, sem updated_at/trigger).
-- Segredos sensiveis (Evolution_Api_Key, AI_Api_Key) NAO ficam aqui — vao no
-- Vault escopados por instance_id (Req 3.7, 14.1, 18.7); estas tabelas expoem
-- somente o indicador booleano has_api_key.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS; triggers guardados por
-- DROP TRIGGER IF EXISTS antes de CREATE TRIGGER.

-- 8.1 Sessao unica por instancia (Req 3, 4). UNIQUE(instance_id) garante no
--     maximo UMA sessao por instancia (Req 4.2), reutilizada por todos os modulos.
--     qr_code e transitorio (limpo ao conectar). Evolution_Api_Key NAO fica aqui.
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  status            session_status NOT NULL DEFAULT 'DISCONNECTED',  -- dominio (SECAO 2)
  qr_code           text,                              -- transitorio; limpo ao conectar
  last_connected_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_sessions_instance UNIQUE (instance_id)  -- <= 1 sessao/instancia (Req 4.2)
);

DROP TRIGGER IF EXISTS trg_whatsapp_sessions_touch ON whatsapp_sessions;
CREATE TRIGGER trg_whatsapp_sessions_touch
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 8.2 Config de IA por instancia (Req 14, 15, 26). UNIQUE(instance_id) = 1 config
--     por instancia. has_api_key e apenas indicador; a AI_Api_Key fica no Vault
--     (Req 14.2). ai_prompt = persona (Req 26); knowledge_base = base de conhecimento
--     (Req 15.2); handoff_message = AI_Handoff_Message (Req 31.4).
CREATE TABLE IF NOT EXISTS whatsapp_ai_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  ai_prompt       text,                                -- persona (Req 26)
  knowledge_base  text,                                -- grande volume (Req 15.2)
  has_api_key     boolean NOT NULL DEFAULT false,      -- indicador; chave no Vault (Req 14.2)
  handoff_message text,                                -- AI_Handoff_Message (Req 31.4)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_ai_configs_instance UNIQUE (instance_id)
);

DROP TRIGGER IF EXISTS trg_whatsapp_ai_configs_touch ON whatsapp_ai_configs;
CREATE TRIGGER trg_whatsapp_ai_configs_touch
  BEFORE UPDATE ON whatsapp_ai_configs
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 8.3 Conversas (Req 30, 31). UNIQUE(instance_id, contact_phone) = 1 conversa por
--     contato/instancia. mode = Conversation_Mode (Req 31.3), default 'AI_MODE'.
--     responder_lock ('AI' | 'HUMAN') = lock do responsavel unico. INDEX em
--     (instance_id, last_message_at DESC) para listagem do inbox por instancia.
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id          uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  contact_phone        text NOT NULL,
  mode                 conversation_mode NOT NULL DEFAULT 'AI_MODE',  -- dominio (SECAO 2), Req 31.3
  responder_lock       text,                           -- 'AI' | 'HUMAN' — responsavel unico
  last_message_preview text,
  last_message_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_conversations_instance_phone UNIQUE (instance_id, contact_phone)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_instance_last_msg
  ON whatsapp_conversations (instance_id, last_message_at DESC);

DROP TRIGGER IF EXISTS trg_whatsapp_conversations_touch ON whatsapp_conversations;
CREATE TRIGGER trg_whatsapp_conversations_touch
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- 8.4 Mensagens (Req 30, 31). Append-only: somente created_at (sem updated_at/trigger).
--     provider_event_id + UNIQUE(instance_id, provider_event_id) = dedup de eventos
--     inbound do webhook (idempotencia, Req 16.6, 31.12). INDEX(conversation_id,
--     created_at) para leitura cronologica do historico.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  direction         msg_direction NOT NULL,            -- dominio (SECAO 2)
  body              text,
  provider_event_id text,                              -- idempotencia webhook (Req 16.6, 31.12)
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_messages_instance_event UNIQUE (instance_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created
  ON whatsapp_messages (conversation_id, created_at);

-- 8.5 Idempotencia de auto-reply (Req 16.6, 31.12). Append-only: somente created_at.
--     UNIQUE(instance_id, provider_event_id) garante <= 1 resposta por evento inbound
--     (claim_ai_reply). status: 'SENT' | 'BLOCKED' | 'AI_PROVIDER_ERROR'.
CREATE TABLE IF NOT EXISTS whatsapp_ai_replies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  conversation_id   uuid REFERENCES whatsapp_conversations(id),
  status            text NOT NULL,                     -- 'SENT' | 'BLOCKED' | 'AI_PROVIDER_ERROR'
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_ai_replies_instance_event UNIQUE (instance_id, provider_event_id)
);

-- ----------------------------------------------------------------------------
-- SECAO 9. RLS por instance_id (task 1.6)
-- ----------------------------------------------------------------------------
-- Camada 1 do isolamento multi-instancia de tres camadas (design "Isolamento
-- multi-instancia"): RLS habilitada em TODAS as tabelas whatsapp_* com politicas
-- USING/WITH CHECK que (a) herdam a postura RBAC do painel (is_admin_with_permission)
-- e (b) restringem cada linha a um instance_id valido. As RPCs SECURITY DEFINER
-- (camada 2) ainda parametrizam por p_instance_id; a anti-enumeracao (camada 3)
-- fica no servico. Esta secao garante que QUALQUER acesso direto via PostgREST
-- tambem seja gated.
--
-- Postura uniforme por tabela:
--   SELECT                 -> is_admin_with_permission('SETTINGS_VIEW')
--   INSERT/UPDATE/DELETE    -> is_admin_with_permission('SETTINGS_EDIT')
-- e SEMPRE restrito a um instance_id valido (linha pertence a uma instancia
-- existente em whatsapp_instances). Entidades-filho que carregam FK para um pai
-- intermediario sao validadas contra o instance_id do pai (ex.: um recipient so
-- e visivel/mutavel se seu dispatch_job pertence ao mesmo instance_id) — espelha
-- a regra "filhos validados contra o instance_id do pai" das RPCs.
--
-- Data-driven (Req 29): NENHUMA politica codifica a quantidade de instancias. A
-- validade de instance_id e verificada por EXISTS em whatsapp_instances — vale
-- para qualquer numero de instancias (5 hoje, N amanha, sem alterar DDL).
--
-- Idempotente: ENABLE ROW LEVEL SECURITY e no-op se ja habilitada; cada politica
-- e precedida de DROP POLICY IF EXISTS antes de CREATE POLICY (reaplicar a
-- migration nao falha nem duplica).
--
-- Observacao sobre qualificacao de colunas: dentro dos EXISTS que cruzam tabelas,
-- as colunas da linha corrente sao SEMPRE qualificadas com o nome da tabela
-- (ex.: whatsapp_contacts.instance_id) para evitar ambiguidade com colunas
-- homonimas das tabelas-pai referenciadas na subconsulta.

-- 9.1 whatsapp_instances (fonte de verdade). A "instancia" e a propria linha (id);
--     nao ha instance_id a validar contra um pai. Gating apenas por permissao.
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_instances_select ON whatsapp_instances;
CREATE POLICY whatsapp_instances_select ON whatsapp_instances
  FOR SELECT USING (is_admin_with_permission('SETTINGS_VIEW'));

DROP POLICY IF EXISTS whatsapp_instances_insert ON whatsapp_instances;
CREATE POLICY whatsapp_instances_insert ON whatsapp_instances
  FOR INSERT WITH CHECK (is_admin_with_permission('SETTINGS_EDIT'));

DROP POLICY IF EXISTS whatsapp_instances_update ON whatsapp_instances;
CREATE POLICY whatsapp_instances_update ON whatsapp_instances
  FOR UPDATE USING (is_admin_with_permission('SETTINGS_EDIT'))
  WITH CHECK (is_admin_with_permission('SETTINGS_EDIT'));

DROP POLICY IF EXISTS whatsapp_instances_delete ON whatsapp_instances;
CREATE POLICY whatsapp_instances_delete ON whatsapp_instances
  FOR DELETE USING (is_admin_with_permission('SETTINGS_EDIT'));

-- 9.2 whatsapp_contact_lists (filho direto da instancia).
ALTER TABLE whatsapp_contact_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_contact_lists_select ON whatsapp_contact_lists;
CREATE POLICY whatsapp_contact_lists_select ON whatsapp_contact_lists
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contact_lists.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_contact_lists_insert ON whatsapp_contact_lists;
CREATE POLICY whatsapp_contact_lists_insert ON whatsapp_contact_lists
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contact_lists.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_contact_lists_update ON whatsapp_contact_lists;
CREATE POLICY whatsapp_contact_lists_update ON whatsapp_contact_lists
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contact_lists.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contact_lists.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_contact_lists_delete ON whatsapp_contact_lists;
CREATE POLICY whatsapp_contact_lists_delete ON whatsapp_contact_lists
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contact_lists.instance_id)
  );

-- 9.3 whatsapp_contacts (filho de contact_lists). instance_id valido E coerente
--     com o instance_id da lista-pai (list_id).
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_contacts_select ON whatsapp_contacts;
CREATE POLICY whatsapp_contacts_select ON whatsapp_contacts
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contacts.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contact_lists cl
                 WHERE cl.id = whatsapp_contacts.list_id
                   AND cl.instance_id = whatsapp_contacts.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_contacts_insert ON whatsapp_contacts;
CREATE POLICY whatsapp_contacts_insert ON whatsapp_contacts
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contacts.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contact_lists cl
                 WHERE cl.id = whatsapp_contacts.list_id
                   AND cl.instance_id = whatsapp_contacts.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_contacts_update ON whatsapp_contacts;
CREATE POLICY whatsapp_contacts_update ON whatsapp_contacts
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contacts.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contact_lists cl
                 WHERE cl.id = whatsapp_contacts.list_id
                   AND cl.instance_id = whatsapp_contacts.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contacts.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contact_lists cl
                 WHERE cl.id = whatsapp_contacts.list_id
                   AND cl.instance_id = whatsapp_contacts.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_contacts_delete ON whatsapp_contacts;
CREATE POLICY whatsapp_contacts_delete ON whatsapp_contacts
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contacts.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contact_lists cl
                 WHERE cl.id = whatsapp_contacts.list_id
                   AND cl.instance_id = whatsapp_contacts.instance_id)
  );

-- 9.4 whatsapp_contents (filho direto da instancia; dispatch_job_id e nullable —
--     quando presente, deve apontar para job da MESMA instancia).
ALTER TABLE whatsapp_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_contents_select ON whatsapp_contents;
CREATE POLICY whatsapp_contents_select ON whatsapp_contents
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contents.instance_id)
    AND (whatsapp_contents.dispatch_job_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                     WHERE j.id = whatsapp_contents.dispatch_job_id
                       AND j.instance_id = whatsapp_contents.instance_id))
  );

DROP POLICY IF EXISTS whatsapp_contents_insert ON whatsapp_contents;
CREATE POLICY whatsapp_contents_insert ON whatsapp_contents
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contents.instance_id)
    AND (whatsapp_contents.dispatch_job_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                     WHERE j.id = whatsapp_contents.dispatch_job_id
                       AND j.instance_id = whatsapp_contents.instance_id))
  );

DROP POLICY IF EXISTS whatsapp_contents_update ON whatsapp_contents;
CREATE POLICY whatsapp_contents_update ON whatsapp_contents
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contents.instance_id)
    AND (whatsapp_contents.dispatch_job_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                     WHERE j.id = whatsapp_contents.dispatch_job_id
                       AND j.instance_id = whatsapp_contents.instance_id))
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contents.instance_id)
    AND (whatsapp_contents.dispatch_job_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                     WHERE j.id = whatsapp_contents.dispatch_job_id
                       AND j.instance_id = whatsapp_contents.instance_id))
  );

DROP POLICY IF EXISTS whatsapp_contents_delete ON whatsapp_contents;
CREATE POLICY whatsapp_contents_delete ON whatsapp_contents
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_contents.instance_id)
    AND (whatsapp_contents.dispatch_job_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                     WHERE j.id = whatsapp_contents.dispatch_job_id
                       AND j.instance_id = whatsapp_contents.instance_id))
  );

-- 9.5 whatsapp_content_media (filho de contents). instance_id coerente com o
--     content-pai (content_id).
ALTER TABLE whatsapp_content_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_content_media_select ON whatsapp_content_media;
CREATE POLICY whatsapp_content_media_select ON whatsapp_content_media
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_content_media.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contents c
                 WHERE c.id = whatsapp_content_media.content_id
                   AND c.instance_id = whatsapp_content_media.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_content_media_insert ON whatsapp_content_media;
CREATE POLICY whatsapp_content_media_insert ON whatsapp_content_media
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_content_media.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contents c
                 WHERE c.id = whatsapp_content_media.content_id
                   AND c.instance_id = whatsapp_content_media.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_content_media_update ON whatsapp_content_media;
CREATE POLICY whatsapp_content_media_update ON whatsapp_content_media
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_content_media.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contents c
                 WHERE c.id = whatsapp_content_media.content_id
                   AND c.instance_id = whatsapp_content_media.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_content_media.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contents c
                 WHERE c.id = whatsapp_content_media.content_id
                   AND c.instance_id = whatsapp_content_media.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_content_media_delete ON whatsapp_content_media;
CREATE POLICY whatsapp_content_media_delete ON whatsapp_content_media
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_content_media.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_contents c
                 WHERE c.id = whatsapp_content_media.content_id
                   AND c.instance_id = whatsapp_content_media.instance_id)
  );

-- 9.6 whatsapp_dispatch_jobs (filho direto da instancia).
ALTER TABLE whatsapp_dispatch_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_dispatch_jobs_select ON whatsapp_dispatch_jobs;
CREATE POLICY whatsapp_dispatch_jobs_select ON whatsapp_dispatch_jobs
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_jobs.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_dispatch_jobs_insert ON whatsapp_dispatch_jobs;
CREATE POLICY whatsapp_dispatch_jobs_insert ON whatsapp_dispatch_jobs
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_jobs.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_dispatch_jobs_update ON whatsapp_dispatch_jobs;
CREATE POLICY whatsapp_dispatch_jobs_update ON whatsapp_dispatch_jobs
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_jobs.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_jobs.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_dispatch_jobs_delete ON whatsapp_dispatch_jobs;
CREATE POLICY whatsapp_dispatch_jobs_delete ON whatsapp_dispatch_jobs
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_jobs.instance_id)
  );

-- 9.7 whatsapp_dispatch_recipients (filho de dispatch_jobs). instance_id coerente
--     com o job-pai (dispatch_job_id).
ALTER TABLE whatsapp_dispatch_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_dispatch_recipients_select ON whatsapp_dispatch_recipients;
CREATE POLICY whatsapp_dispatch_recipients_select ON whatsapp_dispatch_recipients
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_recipients.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_dispatch_recipients.dispatch_job_id
                   AND j.instance_id = whatsapp_dispatch_recipients.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_dispatch_recipients_insert ON whatsapp_dispatch_recipients;
CREATE POLICY whatsapp_dispatch_recipients_insert ON whatsapp_dispatch_recipients
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_recipients.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_dispatch_recipients.dispatch_job_id
                   AND j.instance_id = whatsapp_dispatch_recipients.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_dispatch_recipients_update ON whatsapp_dispatch_recipients;
CREATE POLICY whatsapp_dispatch_recipients_update ON whatsapp_dispatch_recipients
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_recipients.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_dispatch_recipients.dispatch_job_id
                   AND j.instance_id = whatsapp_dispatch_recipients.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_recipients.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_dispatch_recipients.dispatch_job_id
                   AND j.instance_id = whatsapp_dispatch_recipients.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_dispatch_recipients_delete ON whatsapp_dispatch_recipients;
CREATE POLICY whatsapp_dispatch_recipients_delete ON whatsapp_dispatch_recipients
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_dispatch_recipients.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_dispatch_recipients.dispatch_job_id
                   AND j.instance_id = whatsapp_dispatch_recipients.instance_id)
  );

-- 9.8 whatsapp_group_dispatches (filho de dispatch_jobs).
ALTER TABLE whatsapp_group_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_group_dispatches_select ON whatsapp_group_dispatches;
CREATE POLICY whatsapp_group_dispatches_select ON whatsapp_group_dispatches
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_group_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_group_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_group_dispatches.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_group_dispatches_insert ON whatsapp_group_dispatches;
CREATE POLICY whatsapp_group_dispatches_insert ON whatsapp_group_dispatches
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_group_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_group_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_group_dispatches.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_group_dispatches_update ON whatsapp_group_dispatches;
CREATE POLICY whatsapp_group_dispatches_update ON whatsapp_group_dispatches
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_group_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_group_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_group_dispatches.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_group_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_group_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_group_dispatches.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_group_dispatches_delete ON whatsapp_group_dispatches;
CREATE POLICY whatsapp_group_dispatches_delete ON whatsapp_group_dispatches
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_group_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_group_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_group_dispatches.instance_id)
  );

-- 9.9 whatsapp_scheduled_dispatches (filho de dispatch_jobs).
ALTER TABLE whatsapp_scheduled_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_scheduled_dispatches_select ON whatsapp_scheduled_dispatches;
CREATE POLICY whatsapp_scheduled_dispatches_select ON whatsapp_scheduled_dispatches
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_scheduled_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_scheduled_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_scheduled_dispatches.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_scheduled_dispatches_insert ON whatsapp_scheduled_dispatches;
CREATE POLICY whatsapp_scheduled_dispatches_insert ON whatsapp_scheduled_dispatches
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_scheduled_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_scheduled_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_scheduled_dispatches.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_scheduled_dispatches_update ON whatsapp_scheduled_dispatches;
CREATE POLICY whatsapp_scheduled_dispatches_update ON whatsapp_scheduled_dispatches
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_scheduled_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_scheduled_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_scheduled_dispatches.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_scheduled_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_scheduled_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_scheduled_dispatches.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_scheduled_dispatches_delete ON whatsapp_scheduled_dispatches;
CREATE POLICY whatsapp_scheduled_dispatches_delete ON whatsapp_scheduled_dispatches
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_scheduled_dispatches.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_dispatch_jobs j
                 WHERE j.id = whatsapp_scheduled_dispatches.dispatch_job_id
                   AND j.instance_id = whatsapp_scheduled_dispatches.instance_id)
  );

-- 9.10 whatsapp_groups (filho direto da instancia; cache de grupos da Evolution).
ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_groups_select ON whatsapp_groups;
CREATE POLICY whatsapp_groups_select ON whatsapp_groups
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_groups.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_groups_insert ON whatsapp_groups;
CREATE POLICY whatsapp_groups_insert ON whatsapp_groups
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_groups.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_groups_update ON whatsapp_groups;
CREATE POLICY whatsapp_groups_update ON whatsapp_groups
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_groups.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_groups.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_groups_delete ON whatsapp_groups;
CREATE POLICY whatsapp_groups_delete ON whatsapp_groups
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_groups.instance_id)
  );

-- 9.11 whatsapp_extracted_contacts (filho direto da instancia).
ALTER TABLE whatsapp_extracted_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_extracted_contacts_select ON whatsapp_extracted_contacts;
CREATE POLICY whatsapp_extracted_contacts_select ON whatsapp_extracted_contacts
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_extracted_contacts.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_extracted_contacts_insert ON whatsapp_extracted_contacts;
CREATE POLICY whatsapp_extracted_contacts_insert ON whatsapp_extracted_contacts
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_extracted_contacts.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_extracted_contacts_update ON whatsapp_extracted_contacts;
CREATE POLICY whatsapp_extracted_contacts_update ON whatsapp_extracted_contacts
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_extracted_contacts.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_extracted_contacts.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_extracted_contacts_delete ON whatsapp_extracted_contacts;
CREATE POLICY whatsapp_extracted_contacts_delete ON whatsapp_extracted_contacts
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_extracted_contacts.instance_id)
  );

-- 9.12 whatsapp_sessions (filho direto da instancia; <= 1 por instancia).
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sessions_select ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_select ON whatsapp_sessions
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_sessions.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_sessions_insert ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_insert ON whatsapp_sessions
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_sessions.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_sessions_update ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_update ON whatsapp_sessions
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_sessions.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_sessions.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_sessions_delete ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_delete ON whatsapp_sessions
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_sessions.instance_id)
  );

-- 9.13 whatsapp_ai_configs (filho direto da instancia; <= 1 por instancia).
ALTER TABLE whatsapp_ai_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_ai_configs_select ON whatsapp_ai_configs;
CREATE POLICY whatsapp_ai_configs_select ON whatsapp_ai_configs
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_configs.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_ai_configs_insert ON whatsapp_ai_configs;
CREATE POLICY whatsapp_ai_configs_insert ON whatsapp_ai_configs
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_configs.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_ai_configs_update ON whatsapp_ai_configs;
CREATE POLICY whatsapp_ai_configs_update ON whatsapp_ai_configs
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_configs.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_configs.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_ai_configs_delete ON whatsapp_ai_configs;
CREATE POLICY whatsapp_ai_configs_delete ON whatsapp_ai_configs
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_configs.instance_id)
  );

-- 9.14 whatsapp_conversations (filho direto da instancia).
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_conversations_select ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select ON whatsapp_conversations
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_conversations.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_conversations_insert ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_insert ON whatsapp_conversations
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_conversations.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_conversations_update ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_update ON whatsapp_conversations
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_conversations.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_conversations.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_conversations_delete ON whatsapp_conversations;
CREATE POLICY whatsapp_conversations_delete ON whatsapp_conversations
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_conversations.instance_id)
  );

-- 9.15 whatsapp_messages (filho de conversations; append-only no app, mas RLS cobre
--      todos os comandos). instance_id coerente com a conversa-pai (conversation_id).
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_messages_select ON whatsapp_messages;
CREATE POLICY whatsapp_messages_select ON whatsapp_messages
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_messages.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_conversations cv
                 WHERE cv.id = whatsapp_messages.conversation_id
                   AND cv.instance_id = whatsapp_messages.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_messages_insert ON whatsapp_messages;
CREATE POLICY whatsapp_messages_insert ON whatsapp_messages
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_messages.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_conversations cv
                 WHERE cv.id = whatsapp_messages.conversation_id
                   AND cv.instance_id = whatsapp_messages.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_messages_update ON whatsapp_messages;
CREATE POLICY whatsapp_messages_update ON whatsapp_messages
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_messages.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_conversations cv
                 WHERE cv.id = whatsapp_messages.conversation_id
                   AND cv.instance_id = whatsapp_messages.instance_id)
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_messages.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_conversations cv
                 WHERE cv.id = whatsapp_messages.conversation_id
                   AND cv.instance_id = whatsapp_messages.instance_id)
  );

DROP POLICY IF EXISTS whatsapp_messages_delete ON whatsapp_messages;
CREATE POLICY whatsapp_messages_delete ON whatsapp_messages
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_messages.instance_id)
    AND EXISTS (SELECT 1 FROM whatsapp_conversations cv
                 WHERE cv.id = whatsapp_messages.conversation_id
                   AND cv.instance_id = whatsapp_messages.instance_id)
  );

-- 9.16 whatsapp_ai_replies (filho da instancia; conversation_id e NULLABLE — quando
--      presente, deve apontar para conversa da MESMA instancia).
ALTER TABLE whatsapp_ai_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_ai_replies_select ON whatsapp_ai_replies;
CREATE POLICY whatsapp_ai_replies_select ON whatsapp_ai_replies
  FOR SELECT USING (
    is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_replies.instance_id)
    AND (whatsapp_ai_replies.conversation_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_conversations cv
                     WHERE cv.id = whatsapp_ai_replies.conversation_id
                       AND cv.instance_id = whatsapp_ai_replies.instance_id))
  );

DROP POLICY IF EXISTS whatsapp_ai_replies_insert ON whatsapp_ai_replies;
CREATE POLICY whatsapp_ai_replies_insert ON whatsapp_ai_replies
  FOR INSERT WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_replies.instance_id)
    AND (whatsapp_ai_replies.conversation_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_conversations cv
                     WHERE cv.id = whatsapp_ai_replies.conversation_id
                       AND cv.instance_id = whatsapp_ai_replies.instance_id))
  );

DROP POLICY IF EXISTS whatsapp_ai_replies_update ON whatsapp_ai_replies;
CREATE POLICY whatsapp_ai_replies_update ON whatsapp_ai_replies
  FOR UPDATE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_replies.instance_id)
    AND (whatsapp_ai_replies.conversation_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_conversations cv
                     WHERE cv.id = whatsapp_ai_replies.conversation_id
                       AND cv.instance_id = whatsapp_ai_replies.instance_id))
  ) WITH CHECK (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_replies.instance_id)
    AND (whatsapp_ai_replies.conversation_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_conversations cv
                     WHERE cv.id = whatsapp_ai_replies.conversation_id
                       AND cv.instance_id = whatsapp_ai_replies.instance_id))
  );

DROP POLICY IF EXISTS whatsapp_ai_replies_delete ON whatsapp_ai_replies;
CREATE POLICY whatsapp_ai_replies_delete ON whatsapp_ai_replies
  FOR DELETE USING (
    is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.id = whatsapp_ai_replies.instance_id)
    AND (whatsapp_ai_replies.conversation_id IS NULL
         OR EXISTS (SELECT 1 FROM whatsapp_conversations cv
                     WHERE cv.id = whatsapp_ai_replies.conversation_id
                       AND cv.instance_id = whatsapp_ai_replies.instance_id))
  );

-- ============================================================================
-- SECTION 10: Storage bucket privado `whatsapp-media` + RLS de storage.objects
-- ----------------------------------------------------------------------------
-- Task 1.7. Bucket PRIVADO (public=false): acesso a midia apenas via signed URL
-- (Req 6.4, 18.3). Convencao de path: <instance_id>/<content_id>/<filename> — o
-- primeiro segmento do path (`name`) e o instance_id. Isolamento multi-instancia
-- por path: leitura exige SETTINGS_VIEW, escrita exige SETTINGS_EDIT, sempre
-- restritas a um instance_id valido (EXISTS em whatsapp_instances).
--
-- Nota de robustez: comparamos `wi.id::text = split_part(name,'/',1)` (texto vs
-- texto) em vez de castar o segmento para uuid. Assim um `name` malformado nao
-- gera excecao de cast dentro da policy — apenas nao casa nenhuma instancia e o
-- acesso e negado. Equivale ao `(storage.foldername(name))[1]` como primeiro
-- segmento, sem risco de cast.
-- ============================================================================

-- 10.1 Bucket privado (idempotente). public=false ⇒ sem leitura publica;
--      somente signed URL emitida server-side concede acesso.
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

-- 10.2 RLS de leitura (SELECT) — gate SETTINGS_VIEW + instance_id valido no path.
DROP POLICY IF EXISTS whatsapp_media_select ON storage.objects;
CREATE POLICY whatsapp_media_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'whatsapp-media'
    AND is_admin_with_permission('SETTINGS_VIEW')
    AND EXISTS (
      SELECT 1 FROM whatsapp_instances wi
       WHERE wi.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- 10.3 RLS de escrita (INSERT) — gate SETTINGS_EDIT + instance_id valido no path.
DROP POLICY IF EXISTS whatsapp_media_insert ON storage.objects;
CREATE POLICY whatsapp_media_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (
      SELECT 1 FROM whatsapp_instances wi
       WHERE wi.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- 10.4 RLS de atualizacao (UPDATE) — gate SETTINGS_EDIT em USING e WITH CHECK.
DROP POLICY IF EXISTS whatsapp_media_update ON storage.objects;
CREATE POLICY whatsapp_media_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'whatsapp-media'
    AND is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (
      SELECT 1 FROM whatsapp_instances wi
       WHERE wi.id::text = split_part(storage.objects.name, '/', 1)
    )
  ) WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (
      SELECT 1 FROM whatsapp_instances wi
       WHERE wi.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- 10.5 RLS de remocao (DELETE) — gate SETTINGS_EDIT + instance_id valido no path.
DROP POLICY IF EXISTS whatsapp_media_delete ON storage.objects;
CREATE POLICY whatsapp_media_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'whatsapp-media'
    AND is_admin_with_permission('SETTINGS_EDIT')
    AND EXISTS (
      SELECT 1 FROM whatsapp_instances wi
       WHERE wi.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- ============================================================================
-- SECTION 11: Agendamento do Job_Worker duravel via pg_cron + pg_net
-- ----------------------------------------------------------------------------
-- Task 1.8 (Req 10.2, 13.3, 27.1). Decisao central do design: a durabilidade do
-- processamento (sobrevive a fechar o browser E a reinicio do servidor) vem de
-- uma fila em Postgres drenada por uma Edge Function (`whatsapp-job-worker`)
-- acionada a cada minuto pelo `pg_cron`. Cada tick e stateless: le o estado
-- duravel, faz uma fatia de trabalho respeitando Send_Interval/quota e persiste
-- o progresso. O proprio tick e o Recovery_Process (Req 27).
--
-- Seguranca: a Edge Function roda com `verify_jwt = false` (acionada por cron),
-- portanto valida um segredo de invocacao proprio no header `x-worker-secret`
-- que SOMENTE o pg_cron conhece. O segredo vive no Vault em
-- `whatsapp_worker_secret` (ver tabela de segredos no design) e nunca trafega
-- ao browser nem aparece em colunas/respostas.
--
-- Resolucao da URL da Edge Function (ambiente-especifico): lida do Vault em
-- `whatsapp_worker_url`. O valor esperado e a URL completa da function, no
-- formato `https://<project-ref>.supabase.co/functions/v1/whatsapp-job-worker`.
-- Ambos os segredos (`whatsapp_worker_secret` e `whatsapp_worker_url`) sao
-- provisionados fora desta migration (painel/admin/infra), pois dependem do
-- ambiente. A leitura ocorre APENAS no momento do tick (dentro do comando do
-- cron), nao durante o apply da migration — logo, a ausencia do Vault em
-- local/test nao quebra esta migration.
--
-- Idempotencia/seguranca de re-run: tudo dentro de um DO defensivo que
-- (a) confirma que `pg_cron` e `pg_net` estao instalados — caso contrario apenas
-- emite NOTICE e retorna (nao falha em ambientes locais/test sem superuser);
-- (b) faz `cron.unschedule` de qualquer job homonimo, protegido contra erro se
-- ele ainda nao existir; (c) recria o agendamento com `cron.schedule`.
-- ============================================================================

DO $cron$
DECLARE
  v_has_cron boolean;
  v_has_net  boolean;
  v_job_name text := 'whatsapp-job-worker-tick';
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')  INTO v_has_net;

  IF NOT v_has_cron OR NOT v_has_net THEN
    RAISE NOTICE '[whatsapp-automation] pg_cron disponivel=% / pg_net disponivel=%: agendamento do worker IGNORADO neste ambiente (provavelmente local/test sem as extensoes/superuser). Em producao hospedada as extensoes existem e o job sera criado no apply.', v_has_cron, v_has_net;
    RETURN;
  END IF;

  -- (b) Remove agendamento anterior de mesmo nome (idempotente). cron.unschedule
  --     lanca excecao se o job nao existir; capturamos para nao falhar no 1o run.
  BEGIN
    PERFORM cron.unschedule(v_job_name);
    RAISE NOTICE '[whatsapp-automation] job pg_cron "%" anterior removido antes do reschedule.', v_job_name;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[whatsapp-automation] nenhum job pg_cron "%" pre-existente para remover (ok).', v_job_name;
  END;

  -- (c) Agenda o tick a cada minuto. O comando le URL e segredo do Vault em
  --     tempo de execucao e invoca a Edge Function via net.http_post (pg_net),
  --     passando o segredo de invocacao no header `x-worker-secret`.
  PERFORM cron.schedule(
    v_job_name,
    '* * * * *',
    $worker$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
               WHERE name = 'whatsapp_worker_url' LIMIT 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                             WHERE name = 'whatsapp_worker_secret' LIMIT 1)
      ),
      body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now())
    );
    $worker$
  );

  RAISE NOTICE '[whatsapp-automation] job pg_cron "%" agendado em "* * * * *" (tick por minuto).', v_job_name;
END
$cron$;

-- ============================================================================
-- SECTION 12: VERIFY (smoke-test manual — bloco comentado, NAO executa no apply)
-- ----------------------------------------------------------------------------
-- Conforme admin-patterns #9: bloco -- VERIFY comentado ao final para conferencia
-- manual pos-deploy. Descomente e rode no SQL editor do ambiente hospedado.
-- ============================================================================
/*
-- 12.1 Extensoes necessarias instaladas?
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net') ORDER BY extname;

-- 12.2 O job foi criado, esta ativo e com o schedule correto?
SELECT jobid, jobname, schedule, active, command
  FROM cron.job
 WHERE jobname = 'whatsapp-job-worker-tick';

-- 12.3 Os segredos de invocacao estao provisionados no Vault?
--      (espera-se 2 linhas: whatsapp_worker_secret e whatsapp_worker_url)
SELECT name FROM vault.secrets
 WHERE name IN ('whatsapp_worker_secret', 'whatsapp_worker_url')
 ORDER BY name;

-- 12.4 Ultimas execucoes do tick (status/retorno) para diagnostico.
SELECT runid, status, return_message, start_time, end_time
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'whatsapp-job-worker-tick')
 ORDER BY start_time DESC
 LIMIT 5;
*/

-- ============================================================================
-- SECTION 13: Helpers de gating RBAC para as RPCs whatsapp_* (task 5.1)
-- ----------------------------------------------------------------------------
-- Funcoes auxiliares reutilizaveis que centralizam a "Security Posture" do
-- modulo (design.md > Security Posture; admin-patterns #2 e #10). As RPCs das
-- tasks 6.x/8.x/15.x etc. NAO reimplementam o boilerplate de gating: chamam
-- `whatsapp_require_permission('SETTINGS_VIEW'|'SETTINGS_EDIT')` no inicio do
-- corpo, recebendo o uuid do caller ja autorizado.
--
-- Postura aplicada (identica a admin-patterns #10):
--   1. SECURITY DEFINER + SET search_path = public (anti search-path attack).
--   2. auth.uid() IS NULL  => RAISE 'permission_denied' (ERRCODE 42501).
--   3. is_admin_with_permission(p)  => se falso, grava log negativo
--      WHATSAPP_VIEW_DENIED (before_data=NULL, after_data={user_id,reason})
--      e RAISE 'permission_denied' (ERRCODE 42501).
--   4. REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated.
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- _Requirements: 1.4, 1.5, 1.6, 18.4_
-- ============================================================================

-- 13.1 Guard de autenticacao: garante caller logado, retorna o uuid do caller.
--      Bloco base reutilizado por whatsapp_require_permission e por qualquer
--      RPC que precise apenas exigir login (sem permissao especifica).
CREATE OR REPLACE FUNCTION whatsapp_require_auth()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;
  RETURN v_caller;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_require_auth() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_require_auth() TO authenticated;

-- 13.2 Gate combinado: auth guard + checagem de permissao + log negativo.
--      Retorna o uuid do caller em caso de sucesso (a ser usado como admin_id
--      nos audit logs das mutacoes). Em falha de permissao, grava o registro
--      WHATSAPP_VIEW_DENIED ANTES de lancar, materializando o caminho negativo
--      de leitura/gating (admin-patterns #1).
--
--      O modulo so usa as permissoes SETTINGS_VIEW (leitura) e SETTINGS_EDIT
--      (escrita); um valor fora desse dominio indica erro de programacao numa
--      RPC chamadora e aborta cedo com mensagem clara (nao e um permission
--      check legitimo).
CREATE OR REPLACE FUNCTION whatsapp_require_permission(p_permission text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller uuid;
BEGIN
  -- (a) Dominio fechado de permissoes aceitas pelo modulo whatsapp_*.
  IF p_permission IS NULL OR p_permission NOT IN ('SETTINGS_VIEW', 'SETTINGS_EDIT') THEN
    RAISE EXCEPTION
      'whatsapp_require_permission: permissao invalida "%": esperado SETTINGS_VIEW|SETTINGS_EDIT',
      p_permission
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- (b) Guard de autenticacao (reusa 13.1): auth.uid() NULL => permission_denied.
  v_caller := whatsapp_require_auth();

  -- (c) Checagem de permissao server-side (camada 2 do RBAC).
  IF NOT is_admin_with_permission(p_permission) THEN
    -- Log negativo de acesso sem permissao (admin-patterns #1).
    INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, before_data, after_data)
    VALUES (
      v_caller,
      'WHATSAPP_VIEW_DENIED',
      NULL,
      NULL,
      NULL,
      jsonb_build_object('user_id', v_caller, 'reason', 'permission_denied')
    );
    RAISE EXCEPTION 'permission_denied: % required', p_permission USING ERRCODE = '42501';
  END IF;

  RETURN v_caller;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_require_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_require_permission(text) TO authenticated;

-- ============================================================================
-- SECTION 14: Guarda de acesso por instancia (anti-enumeracao) + helpers Vault
--             de segredos por instancia (task 5.2)
-- ----------------------------------------------------------------------------
-- Implementa a 3a camada de isolamento descrita em design.md > "Isolamento
-- multi-instancia" e "Security Posture":
--   * whatsapp_assert_instance(p_instance_id) — guarda server-side de
--     anti-enumeracao (Req 2.8, 30.8). Instancia inexistente OU desabilitada
--     produz SEMPRE o MESMO erro (marker WHATSAPP_NOT_FOUND, ERRCODE P0001),
--     sem revelar se a linha existe. A camada TS (guards.ts) mapeia esse
--     marker para a Canonical_Message `Nao foi possivel concluir a operacao.`.
--   * whatsapp_set_instance_secret / whatsapp_instance_secret_is_set —
--     helpers de Vault escopados por instancia (Req 18.5, 18.7). Os segredos
--     vivem no Supabase Vault sob os nomes `whatsapp_evolution_key_<id>` e
--     `whatsapp_ai_key_<id>` e NUNCA sao retornados em texto puro: o setter
--     retorna void e o checker apenas um booleano de presenca.
--
-- Postura (admin-patterns #10, identica a SECTION 13): SECURITY DEFINER +
-- SET search_path = public + REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
-- authenticated. Gating via whatsapp_require_permission (SECTION 13):
-- SETTINGS_EDIT no setter, SETTINGS_VIEW no checker.
--
-- Idempotente: CREATE OR REPLACE FUNCTION. A escrita no Vault e um overwrite
-- idempotente (update se o nome ja existe, senao create).
-- _Requirements: 2.8, 18.5, 18.7, 30.8_
-- ============================================================================

-- 14.1 Guarda de acesso/anti-enumeracao por instancia.
--      Verifica que a instancia existe E esta habilitada. Caso contrario,
--      lanca o marker canonico WHATSAPP_NOT_FOUND (ERRCODE P0001) — resposta
--      indistinguivel entre "nao existe" e "sem acesso/desabilitada", impedindo
--      enumeracao de instance_ids (Req 2.8, 30.8). Exige caller autenticado
--      (reusa whatsapp_require_auth da SECTION 13); o gating de permissao fica
--      a cargo da RPC chamadora, que ja chamou whatsapp_require_permission.
CREATE OR REPLACE FUNCTION whatsapp_assert_instance(p_instance_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_exists boolean;
BEGIN
  -- Exige caller logado (anon nunca enumera instancias).
  PERFORM whatsapp_require_auth();

  SELECT EXISTS (
    SELECT 1
      FROM whatsapp_instances
     WHERE id = p_instance_id
       AND enabled = true
  ) INTO v_exists;

  IF NOT v_exists THEN
    -- Marker canonico de anti-enumeracao. A camada TS mapeia para a
    -- Canonical_Message `Nao foi possivel concluir a operacao.`.
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  RETURN p_instance_id;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_assert_instance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_assert_instance(uuid) TO authenticated;

-- 14.2 Helper interno: nome canonico do segredo no Vault para uma instancia.
--      p_kind ∈ {EVOLUTION, AI}. IMMUTABLE/puro — nao toca o Vault.
CREATE OR REPLACE FUNCTION whatsapp_instance_secret_name(p_instance_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $func$
BEGIN
  IF p_kind = 'EVOLUTION' THEN
    RETURN 'whatsapp_evolution_key_' || p_instance_id::text;
  ELSIF p_kind = 'AI' THEN
    RETURN 'whatsapp_ai_key_' || p_instance_id::text;
  ELSE
    RAISE EXCEPTION
      'whatsapp_instance_secret_name: kind invalido "%": esperado EVOLUTION|AI', p_kind
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_instance_secret_name(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_instance_secret_name(uuid, text) TO authenticated;

-- 14.3 Setter de segredo por instancia (overwrite idempotente no Vault).
--      Gating SETTINGS_EDIT. NUNCA retorna o valor do segredo (RETURNS void).
--      Se o nome ja existe no Vault, atualiza; senao, cria.
CREATE OR REPLACE FUNCTION whatsapp_set_instance_secret(
  p_instance_id uuid,
  p_kind        text,
  p_secret      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_name      text;
  v_secret_id uuid;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao do conteudo do segredo (nao vazio).
  IF p_secret IS NULL OR length(btrim(p_secret)) = 0 THEN
    RAISE EXCEPTION
      'whatsapp_set_instance_secret: segredo vazio' USING ERRCODE = '22023';
  END IF;

  -- (d) Nome canonico (valida p_kind ∈ {EVOLUTION, AI}).
  v_name := whatsapp_instance_secret_name(p_instance_id, p_kind);

  -- (e) Overwrite idempotente no Vault.
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_secret, v_name, 'WhatsApp module secret');
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secret, v_name, 'WhatsApp module secret');
  END IF;

  -- Sem RETURN de valor: o segredo nunca trafega de volta ao chamador.
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_set_instance_secret(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_set_instance_secret(uuid, text, text) TO authenticated;

-- 14.4 Checker de presenca de segredo por instancia.
--      Gating SETTINGS_VIEW. Retorna apenas booleano (indicador) — NUNCA o
--      valor em texto puro (Req 14.2, 14.5, 18.7).
CREATE OR REPLACE FUNCTION whatsapp_instance_secret_is_set(
  p_instance_id uuid,
  p_kind        text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_name text;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Nome canonico (valida p_kind ∈ {EVOLUTION, AI}).
  v_name := whatsapp_instance_secret_name(p_instance_id, p_kind);

  RETURN EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_name);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_instance_secret_is_set(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_instance_secret_is_set(uuid, text) TO authenticated;

-- >>> APPEND-POINT: proximas fatias da migration entram aqui <<<

COMMIT;
