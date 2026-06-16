-- ============================================================================
-- Migration 103 — whatsapp_claim_due_jobs / whatsapp_claim_next_recipient (task 12.1)
-- ----------------------------------------------------------------------------
-- RPCs SECURITY DEFINER do CLAIM ATOMICO do Job_Worker durável (design.md >
-- "Modelo de execução do Job_Worker (tick)" e "Idempotência por destinatário").
-- Sao invocadas SERVER-TO-SERVER pela Edge Function `whatsapp-job-worker`
-- (verify_jwt=false, acionada pelo pg_cron via net.http_post — SECTION 11 da
-- 092), usando a chave service_role. NAO ha Admin_User logado: por isso o
-- gating destas RPCs e exclusivamente por GRANT (service_role), sem
-- auth.uid()/is_admin_with_permission (mesma postura da 102
-- whatsapp_claim_ai_reply, tambem so service_role).
--
--   whatsapp_claim_due_jobs(p_limit int) -> jsonb (array)
--     Reivindica os jobs ELEGIVEIS (status QUEUED|RUNNING) numa unica
--     transacao, usando `FOR UPDATE SKIP LOCKED` para que ticks concorrentes
--     nunca reivindiquem o mesmo job. Marca cada job RUNNING e grava
--     started_at se ainda nulo (Req 10.2). Retorna um array JSON dos jobs
--     reivindicados (campos relevantes ao tick: instance_id, kind, status,
--     send_interval_sec, execution_quota, exec_sent_count, last_send_at,
--     contadores e updated_at). Sem jobs => array vazio `[]`.
--
--     OBS de escopo (task 12.1): a varredura de Scheduled_Dispatches vencidos
--     (scheduled_at <= now AND executed_at IS NULL -> QUEUED) e da task 12.4;
--     aqui consideramos apenas jobs JA em QUEUED|RUNNING. Jobs RUNNING sao
--     re-elegiveis por construcao (recuperacao = comportamento normal do tick,
--     Req 27.2) — a retomada/recuperacao fina e da task 12.5.
--
--   whatsapp_claim_next_recipient(p_job_id uuid) -> jsonb (linha) | NULL
--     Reivindica ATOMICAMENTE o proximo Dispatch_Recipient PENDING do job,
--     por ordem de `seq`, transicionando-o PENDING -> SENDING e retornando a
--     linha (to_jsonb). So destinatarios PENDING sao elegiveis; um destinatario
--     ja SENT (ou FAILED/SKIPPED) NUNCA e reivindicado de novo, mesmo apos
--     restart ou re-tick (idempotencia por destinatario, Req 10.4, 10.5, 27.2).
--     `FOR UPDATE SKIP LOCKED` garante que ticks concorrentes peguem
--     destinatarios distintos. Sem PENDING => NULL.
--
--     OBS de escopo (task 12.1): destinatarios travados em SENDING por um tick
--     anterior que morreu NAO sao reivindicados aqui (a recuperacao de SENDING
--     orfao e da task 12.5). O envio/marcacao SENT|FAILED e o pacing/quota sao
--     das tasks 12.2/12.3.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs
-- (096..102) para evitar conflitos de edicao. Depende dos objetos criados na
-- 092:
--   - tabela public.whatsapp_dispatch_jobs        (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients  (SECTION 6 da 092)
--   - dominios public.dispatch_status / recipient_status (SECTION 2 da 092)
--   - trigger trg_whatsapp_dispatch_jobs_touch / _recipients_touch (SECTION 6)
--
-- Postura de seguranca (admin-patterns #10): SECURITY DEFINER +
-- SET search_path = public; REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
-- service_role APENAS (nunca authenticated/anon — nao ha caller humano).
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 10.2, 10.4, 10.5_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- Aborta cedo (sem criar objetos orfaos) se os pre-requisitos faltarem.
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_dispatch_jobs'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_dispatch_jobs ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_dispatch_recipients'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_dispatch_recipients ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'recipient_status' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: dominio recipient_status ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_claim_due_jobs(p_limit int)
-- ----------------------------------------------------------------------------
-- Claim atomico dos jobs elegiveis (QUEUED|RUNNING). Numa unica transacao:
--   (1) seleciona ate p_limit ids com FOR UPDATE SKIP LOCKED (ticks concorrentes
--       pulam os ja travados — nunca processam o mesmo job em paralelo);
--   (2) marca os selecionados RUNNING e grava started_at se nulo (Req 10.2);
--   (3) agrega os jobs reivindicados num array jsonb para o worker iterar.
-- p_limit e saturado em [1, 500] (teto defensivo). Sem jobs => '[]'.
CREATE OR REPLACE FUNCTION whatsapp_claim_due_jobs(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_limit  int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_result jsonb;
BEGIN
  WITH eligible AS (
    SELECT id
      FROM whatsapp_dispatch_jobs
     WHERE status IN ('QUEUED', 'RUNNING')
     ORDER BY created_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT v_limit
  ),
  claimed AS (
    UPDATE whatsapp_dispatch_jobs j
       SET status     = 'RUNNING',
           started_at = COALESCE(j.started_at, now())
      FROM eligible e
     WHERE j.id = e.id
    RETURNING
      j.id,
      j.instance_id,
      j.kind,
      j.status,
      j.distribution_mode,
      j.block_size,
      j.send_interval_sec,
      j.execution_quota,
      j.exec_sent_count,
      j.total_count,
      j.sent_count,
      j.failed_count,
      j.skipped_count,
      j.last_send_at,
      j.started_at,
      j.updated_at
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb)
    INTO v_result
    FROM claimed c;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_claim_due_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_claim_due_jobs(int) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_claim_next_recipient(p_job_id uuid)
-- ----------------------------------------------------------------------------
-- Claim atomico do proximo destinatario PENDING do job (idempotencia por
-- destinatario, Req 10.4/10.5). A subconsulta seleciona o menor `seq` PENDING
-- com FOR UPDATE SKIP LOCKED (LIMIT 1) e a UPDATE externa o transiciona
-- PENDING -> SENDING, retornando a linha. Garante:
--   * apenas PENDING e elegivel => um destinatario SENT/FAILED/SKIPPED nunca e
--     reivindicado de novo (sem reenvio, mesmo apos restart/re-tick);
--   * SKIP LOCKED => ticks concorrentes pegam destinatarios distintos;
--   * ordem deterministica por `seq`.
-- Sem PENDING disponivel => retorna NULL (o worker passa ao proximo job).
CREATE OR REPLACE FUNCTION whatsapp_claim_next_recipient(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_rec jsonb;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_claim_next_recipient: job_id obrigatorio'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  UPDATE whatsapp_dispatch_recipients r
     SET status = 'SENDING'
   WHERE r.id = (
           SELECT id
             FROM whatsapp_dispatch_recipients
            WHERE dispatch_job_id = p_job_id
              AND status = 'PENDING'
            ORDER BY seq
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
  RETURNING to_jsonb(r) INTO v_rec;

  -- v_rec e NULL quando nenhuma linha casou (sem PENDING disponivel).
  RETURN v_rec;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_claim_next_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_claim_next_recipient(uuid) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; NAO executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pre-requisitos: uma instancia habilitada + um job com recipients PENDING.
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT (whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,100,
--             '<list_id>',NULL,ARRAY['<content_a>']::uuid[]))->>'id' AS job_id;
--   -- Habilite o job (DRAFT -> QUEUED):
--   SELECT whatsapp_transition_dispatch('<inst>','<job>','START',
--            (SELECT updated_at FROM whatsapp_dispatch_jobs WHERE id='<job>'));

-- 1) Claim dos jobs elegiveis: marca RUNNING + started_at, retorna o array.
SELECT jsonb_pretty(whatsapp_claim_due_jobs(50));
SELECT id, status, started_at FROM whatsapp_dispatch_jobs WHERE id = '<job>';

-- 2) Claim atomico do proximo recipient (menor seq PENDING -> SENDING):
SELECT jsonb_pretty(whatsapp_claim_next_recipient('<job>'));  -- seq 0 -> SENDING
SELECT jsonb_pretty(whatsapp_claim_next_recipient('<job>'));  -- seq 1 -> SENDING
SELECT seq, status FROM whatsapp_dispatch_recipients
 WHERE dispatch_job_id = '<job>' ORDER BY seq;

-- 3) Idempotencia: marque o seq 0 como SENT e reivindique de novo — o seq 0
--    NUNCA reaparece (so PENDING e elegivel):
UPDATE whatsapp_dispatch_recipients SET status='SENT'
 WHERE dispatch_job_id='<job>' AND seq=0;
SELECT (whatsapp_claim_next_recipient('<job>')) ->> 'seq';  -- nunca 0

-- 4) Sem PENDING => NULL:
UPDATE whatsapp_dispatch_recipients SET status='SENT' WHERE dispatch_job_id='<job>';
SELECT whatsapp_claim_next_recipient('<job>') IS NULL AS sem_pendentes;  -- true

-- 5) Postura de seguranca: as RPCs sao executaveis SOMENTE por service_role.
SELECT proname, proacl FROM pg_proc
 WHERE proname IN ('whatsapp_claim_due_jobs', 'whatsapp_claim_next_recipient');
*/
