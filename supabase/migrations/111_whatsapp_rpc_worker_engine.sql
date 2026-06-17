-- ============================================================================
-- Migration 111 — RPCs do motor de disparo durável (tasks 12.2, 12.3, 12.4, 12.5)
-- ----------------------------------------------------------------------------
-- Complementa a 103 (claim atômico) com as RPCs de RESULTADO/FINALIZAÇÃO,
-- VARREDURA de agendados e RECUPERAÇÃO que fecham o ciclo do Job_Worker durável
-- (design.md > "Modelo de execução do Job_Worker (tick)"). São invocadas
-- SERVER-TO-SERVER pela Edge Function `whatsapp-job-worker` (verify_jwt=false,
-- acionada pelo pg_cron — SECTION 11 da 092), usando a chave service_role. NÃO
-- há Admin_User logado: como na 102/103, o gating destas RPCs é exclusivamente
-- por GRANT (service_role), sem auth.uid()/is_admin_with_permission.
--
--   whatsapp_worker_mark_sent(p_recipient_id, p_provider_message_id, p_now)
--     Marca um Dispatch_Recipient `SENDING` como `SENT` (Req 10.3). Idempotente
--     por destinatário (Req 10.5): só age se o recipient está `SENDING`; um já
--     `SENT`/`FAILED`/`SKIPPED` é no-op (não há contagem dupla). Incrementa
--     `sent_count` e `exec_sent_count` (quota — Req 8.5) e grava `last_send_at`
--     (pacing — Req 8.6). Retorna o snapshot do job (status/contadores/quota).
--
--   whatsapp_worker_mark_failed(p_recipient_id, p_failure_reason)
--     Marca um Dispatch_Recipient `SENDING` como `FAILED` com `failure_reason`
--     (pt-BR, sem segredos — Req 10.6, 23.8). Idempotente: só age se `SENDING`.
--     Incrementa `failed_count`. A falha NÃO conta para a quota (apenas `SENT`).
--
--   whatsapp_worker_release_recipient(p_recipient_id)
--     Devolve um recipient `SENDING` para `PENDING` (SENDING -> PENDING). Usado
--     pelo worker quando o pacing ainda não venceu no tick (Req 8.6): o
--     recipient reivindicado não é enviado agora e volta à fila para o próximo
--     tick. Idempotente: só age se `SENDING`.
--
--   whatsapp_worker_finalize_job(p_job_id)
--     Decide o estado terminal/parcial do job ao fim de uma fatia (Req 10.7,
--     8.7). Só atua em job `RUNNING`:
--       - sem `PENDING` E sem `SENDING`  -> `COMPLETED` (completed_at=now)
--       - quota atingida (exec_sent_count >= execution_quota) com `PENDING`
--         restante                       -> `PAUSED` (aguarda RESUME)
--       - caso contrário                 -> permanece `RUNNING` (próximo tick)
--     COMPLETED tem precedência sobre PAUSED.
--
--   whatsapp_worker_sweep_scheduled(p_limit)  [task 12.4]
--     Promove Scheduled_Dispatches vencidos (scheduled_at <= now AND
--     executed_at IS NULL) cujo Dispatch_Job está em `DRAFT` para `QUEUED`,
--     e marca `executed_at=now` (Req 13.3, 27.4). Executa na primeira varredura
--     disponível após indisponibilidade (Req 13.6). `FOR UPDATE SKIP LOCKED`
--     para ticks concorrentes não duplicarem a promoção.
--
--   whatsapp_worker_recover(p_stale_seconds, p_limit)  [task 12.5]
--     Recuperação (Req 27), idempotente por construção:
--       (1) Reivindica recipients `SENDING` órfãos (presos por um tick que
--           morreu): SENDING cujo `updated_at` é mais antigo que p_stale_seconds
--           -> `PENDING`, para reprocessamento (Req 27.2). A idempotência por
--           destinatário garante que um já `SENT` jamais é tocado.
--       (2) Marca jobs INCONSISTENTES (`QUEUED`/`RUNNING` sem NENHUM
--           Dispatch_Recipient — não podem concluir) como `FAILED` +
--           `failure_code='JOB_FAILED'`, prosseguindo com os demais sem abortar
--           (Req 27.6, 10.8).
--
-- Isolamento multi-instância (Req 10.9, 27.7): toda RPC opera sobre o
-- `instance_id` do PRÓPRIO registro (recipient -> seu job -> sua instância);
-- nenhuma mistura dados entre WhatsApp_Instances. As RPCs por-recipient/por-job
-- são chaveadas pelo id da entidade, cujo `instance_id` é imutável; as RPCs de
-- varredura/recuperação atuam linha-a-linha preservando o `instance_id` de cada
-- registro.
--
-- Esta migration é SEPARADA da 092/103 para evitar conflitos de edição. Depende
-- dos objetos criados na 092:
--   - tabela public.whatsapp_dispatch_jobs            (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients      (SECTION 6 da 092)
--   - tabela public.whatsapp_scheduled_dispatches     (SECTION 7 da 092)
--   - domínios public.dispatch_status / recipient_status (SECTION 2 da 092)
--   - triggers de touch de updated_at                 (SECTION 6 da 092)
--
-- Postura de segurança (admin-patterns #10, idêntica à 103): SECURITY DEFINER +
-- SET search_path = public; REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
-- service_role APENAS (nunca authenticated/anon — não há caller humano).
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pré-requisitos da 092.
-- _Requirements: 8.5, 8.6, 8.7, 10.3, 10.5, 10.6, 10.7, 10.8, 13.3, 13.6, 27.2, 27.4, 27.6
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validações defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
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
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_scheduled_dispatches'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_scheduled_dispatches ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- Helper interno: snapshot jsonb do job (status, contadores, quota). Reutilizado
-- pelas RPCs de marcação para o worker decidir continuidade/finalização sem um
-- SELECT extra. Puro/STABLE — não muta nada.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_worker_job_snapshot(p_job_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT jsonb_build_object(
    'job_id',          j.id,
    'instance_id',     j.instance_id,
    'status',          j.status,
    'total_count',     j.total_count,
    'sent_count',      j.sent_count,
    'failed_count',    j.failed_count,
    'skipped_count',   j.skipped_count,
    'exec_sent_count', j.exec_sent_count,
    'execution_quota', j.execution_quota,
    'send_interval_sec', j.send_interval_sec,
    'last_send_at',    j.last_send_at
  )
  FROM whatsapp_dispatch_jobs j
  WHERE j.id = p_job_id;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_job_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_job_snapshot(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_worker_mark_sent(p_recipient_id, p_provider_message_id, p_now)
-- ----------------------------------------------------------------------------
-- Marca um recipient SENDING como SENT (idempotência por destinatário, Req
-- 10.3/10.5). Bloqueia a linha (FOR UPDATE) e só age se status='SENDING':
-- recipient já SENT/FAILED/SKIPPED => no-op SEM contagem dupla. Incrementa
-- sent_count + exec_sent_count e grava last_send_at no job (pacing/quota).
CREATE OR REPLACE FUNCTION whatsapp_worker_mark_sent(
  p_recipient_id        uuid,
  p_provider_message_id text DEFAULT NULL,
  p_now                 timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_job_id     uuid;
  v_rec_status text;
BEGIN
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_worker_mark_sent: recipient_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT dispatch_job_id, status::text
    INTO v_job_id, v_rec_status
    FROM whatsapp_dispatch_recipients
   WHERE id = p_recipient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RECIPIENT_NOT_FOUND');
  END IF;

  -- Idempotência (Req 10.5): só transiciona a partir de SENDING. Qualquer outro
  -- estado (PENDING/SENT/FAILED/SKIPPED) é no-op — devolve o snapshot atual.
  IF v_rec_status <> 'SENDING' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'recipient_status', v_rec_status)
        || whatsapp_worker_job_snapshot(v_job_id);
  END IF;

  UPDATE whatsapp_dispatch_recipients
     SET status              = 'SENT',
         sent_at             = COALESCE(p_now, now()),
         provider_message_id = p_provider_message_id
   WHERE id = p_recipient_id;

  UPDATE whatsapp_dispatch_jobs
     SET sent_count      = sent_count + 1,
         exec_sent_count = exec_sent_count + 1,
         last_send_at    = COALESCE(p_now, now())
   WHERE id = v_job_id;

  RETURN jsonb_build_object('ok', true, 'noop', false)
      || whatsapp_worker_job_snapshot(v_job_id);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_mark_sent(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_mark_sent(uuid, text, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_worker_mark_failed(p_recipient_id, p_failure_reason)
-- ----------------------------------------------------------------------------
-- Marca um recipient SENDING como FAILED com motivo (pt-BR, sem segredos, Req
-- 10.6/23.8). Idempotente: só age se SENDING. Incrementa failed_count; a falha
-- NÃO conta para a quota (exec_sent_count inalterado — só SENT consome quota).
CREATE OR REPLACE FUNCTION whatsapp_worker_mark_failed(
  p_recipient_id   uuid,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_job_id     uuid;
  v_rec_status text;
BEGIN
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_worker_mark_failed: recipient_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT dispatch_job_id, status::text
    INTO v_job_id, v_rec_status
    FROM whatsapp_dispatch_recipients
   WHERE id = p_recipient_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RECIPIENT_NOT_FOUND');
  END IF;

  IF v_rec_status <> 'SENDING' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'recipient_status', v_rec_status)
        || whatsapp_worker_job_snapshot(v_job_id);
  END IF;

  UPDATE whatsapp_dispatch_recipients
     SET status         = 'FAILED',
         failure_reason = p_failure_reason
   WHERE id = p_recipient_id;

  UPDATE whatsapp_dispatch_jobs
     SET failed_count = failed_count + 1
   WHERE id = v_job_id;

  RETURN jsonb_build_object('ok', true, 'noop', false)
      || whatsapp_worker_job_snapshot(v_job_id);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_mark_failed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_mark_failed(uuid, text) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_worker_release_recipient(p_recipient_id)
-- ----------------------------------------------------------------------------
-- Devolve um recipient SENDING para PENDING (pacing não venceu no tick, Req
-- 8.6). Idempotente: só age se SENDING. Sem efeito sobre contadores.
CREATE OR REPLACE FUNCTION whatsapp_worker_release_recipient(p_recipient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_rows int;
BEGIN
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_worker_release_recipient: recipient_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  UPDATE whatsapp_dispatch_recipients
     SET status = 'PENDING'
   WHERE id = p_recipient_id
     AND status = 'SENDING';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'released', v_rows > 0);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_release_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_release_recipient(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_worker_finalize_job(p_job_id)
-- ----------------------------------------------------------------------------
-- Decide o estado do job ao fim de uma fatia (Req 10.7, 8.7). Só atua em job
-- RUNNING (não sobrescreve PAUSED/CANCELLED/etc. definidos por admin). COMPLETED
-- tem precedência sobre PAUSED.
CREATE OR REPLACE FUNCTION whatsapp_worker_finalize_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_status   text;
  v_exec     int;
  v_quota    int;
  v_pending  int;
  v_sending  int;
  v_new      text;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_worker_finalize_job: job_id obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT status::text, exec_sent_count, execution_quota
    INTO v_status, v_exec, v_quota
    FROM whatsapp_dispatch_jobs
   WHERE id = p_job_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'JOB_NOT_FOUND');
  END IF;

  -- Só finaliza jobs RUNNING. Demais estados são devolvidos sem mutação.
  IF v_status <> 'RUNNING' THEN
    RETURN jsonb_build_object('ok', true, 'status', v_status, 'changed', false);
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'PENDING'),
    count(*) FILTER (WHERE status = 'SENDING')
    INTO v_pending, v_sending
    FROM whatsapp_dispatch_recipients
   WHERE dispatch_job_id = p_job_id;

  IF v_pending = 0 AND v_sending = 0 THEN
    -- Todos processados (SENT/FAILED/SKIPPED) => COMPLETED (Req 10.7).
    UPDATE whatsapp_dispatch_jobs
       SET status = 'COMPLETED', completed_at = now()
     WHERE id = p_job_id;
    v_new := 'COMPLETED';
  ELSIF v_quota IS NOT NULL AND v_exec >= v_quota AND v_pending > 0 THEN
    -- Quota da execução atingida com pendentes => PAUSED (Req 8.7).
    UPDATE whatsapp_dispatch_jobs
       SET status = 'PAUSED'
     WHERE id = p_job_id;
    v_new := 'PAUSED';
  ELSE
    -- Ainda há trabalho dentro da quota => permanece RUNNING (próximo tick).
    v_new := 'RUNNING';
  END IF;

  RETURN jsonb_build_object(
    'ok',      true,
    'status',  v_new,
    'changed', v_new <> 'RUNNING',
    'pending', v_pending,
    'sending', v_sending
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_finalize_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_finalize_job(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_worker_sweep_scheduled(p_limit)  [task 12.4]
-- ----------------------------------------------------------------------------
-- Promove Scheduled_Dispatches vencidos cujo job está em DRAFT para QUEUED e
-- marca executed_at=now (Req 13.3, 13.6, 27.4). Jobs já fora de DRAFT (ex.:
-- CANCELLED antes do horário) apenas têm o agendamento marcado como executado
-- (não são ressuscitados). FOR UPDATE SKIP LOCKED evita promoção dupla por
-- ticks concorrentes.
CREATE OR REPLACE FUNCTION whatsapp_worker_sweep_scheduled(p_limit int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_limit    int := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_promoted int;
  v_swept    int;
BEGIN
  WITH due AS (
    SELECT s.id AS sched_id, s.dispatch_job_id AS job_id
      FROM whatsapp_scheduled_dispatches s
     WHERE s.executed_at IS NULL
       AND s.scheduled_at <= now()
     ORDER BY s.scheduled_at
     FOR UPDATE SKIP LOCKED
     LIMIT v_limit
  ),
  promote AS (
    UPDATE whatsapp_dispatch_jobs j
       SET status = 'QUEUED'
      FROM due
     WHERE j.id = due.job_id
       AND j.status = 'DRAFT'
    RETURNING j.id
  ),
  mark AS (
    UPDATE whatsapp_scheduled_dispatches s
       SET executed_at = now()
      FROM due
     WHERE s.id = due.sched_id
    RETURNING s.id
  )
  SELECT (SELECT count(*) FROM promote), (SELECT count(*) FROM mark)
    INTO v_promoted, v_swept;

  RETURN jsonb_build_object('ok', true, 'promoted', v_promoted, 'swept', v_swept);
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_sweep_scheduled(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_sweep_scheduled(int) TO service_role;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_worker_recover(p_stale_seconds, p_limit)  [task 12.5]
-- ----------------------------------------------------------------------------
-- Recuperação (Req 27), idempotente:
--   (1) recipients SENDING órfãos (updated_at < now - p_stale_seconds) -> PENDING
--       para reprocessamento. A idempotência por destinatário garante que um já
--       SENT jamais é tocado (Req 27.2).
--   (2) jobs INCONSISTENTES (QUEUED/RUNNING sem NENHUM recipient) -> FAILED +
--       failure_code='JOB_FAILED', prosseguindo com os demais (Req 27.6, 10.8).
-- p_stale_seconds padrão 300s (5 min): janela conservadora (visibility timeout)
-- para não reverter um envio em voo dentro de um tick normal.
CREATE OR REPLACE FUNCTION whatsapp_worker_recover(
  p_stale_seconds int DEFAULT 300,
  p_limit         int DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_stale    int := GREATEST(1, COALESCE(p_stale_seconds, 300));
  v_limit    int := GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000));
  v_orphans  int;
  v_failed   int;
BEGIN
  -- (1) Recupera recipients SENDING órfãos -> PENDING.
  WITH stale AS (
    SELECT id
      FROM whatsapp_dispatch_recipients
     WHERE status = 'SENDING'
       AND updated_at < now() - make_interval(secs => v_stale)
     ORDER BY updated_at
     FOR UPDATE SKIP LOCKED
     LIMIT v_limit
  ),
  reclaimed AS (
    UPDATE whatsapp_dispatch_recipients r
       SET status = 'PENDING'
      FROM stale
     WHERE r.id = stale.id
    RETURNING r.id
  )
  SELECT count(*) INTO v_orphans FROM reclaimed;

  -- (2) Marca jobs inconsistentes (sem recipients) como JOB_FAILED.
  WITH bad AS (
    SELECT j.id
      FROM whatsapp_dispatch_jobs j
     WHERE j.status IN ('QUEUED', 'RUNNING')
       AND NOT EXISTS (
             SELECT 1 FROM whatsapp_dispatch_recipients r
              WHERE r.dispatch_job_id = j.id
           )
     ORDER BY j.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT v_limit
  ),
  failed AS (
    UPDATE whatsapp_dispatch_jobs j
       SET status       = 'FAILED',
           failure_code = 'JOB_FAILED',
           completed_at = now()
      FROM bad
     WHERE j.id = bad.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_failed FROM failed;

  RETURN jsonb_build_object(
    'ok',                   true,
    'recovered_recipients', v_orphans,
    'failed_jobs',          v_failed
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_worker_recover(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_worker_recover(int, int) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; NÃO executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pré-requisitos: um job QUEUED com recipients PENDING (via create + START) e o
-- worker (103) tendo reivindicado o job (RUNNING) e um recipient (SENDING).

-- 1) Marca SENT: incrementa sent_count + exec_sent_count, grava last_send_at.
SELECT jsonb_pretty(whatsapp_worker_mark_sent('<recipient_sending>', 'EVT123', now()));
SELECT seq, status, provider_message_id FROM whatsapp_dispatch_recipients
 WHERE dispatch_job_id = '<job>' ORDER BY seq;

-- 2) Idempotência: marcar de novo o mesmo recipient (já SENT) => noop=true, sem
--    contagem dupla.
SELECT (whatsapp_worker_mark_sent('<recipient_ja_sent>', 'EVT123', now()))->>'noop';  -- true

-- 3) Marca FAILED outro recipient SENDING: incrementa failed_count.
SELECT jsonb_pretty(whatsapp_worker_mark_failed('<recipient_sending2>', 'Falha no envio.'));

-- 4) Finaliza o job: COMPLETED se drenado, PAUSED se quota atingida c/ pendentes.
SELECT jsonb_pretty(whatsapp_worker_finalize_job('<job>'));
SELECT status, completed_at FROM whatsapp_dispatch_jobs WHERE id = '<job>';

-- 5) Varredura de agendados vencidos (DRAFT -> QUEUED, marca executed_at).
SELECT jsonb_pretty(whatsapp_worker_sweep_scheduled(100));

-- 6) Recuperação: SENDING órfão (>5min) -> PENDING; job sem recipients -> JOB_FAILED.
SELECT jsonb_pretty(whatsapp_worker_recover(300, 500));

-- 7) Postura de segurança: as RPCs são executáveis SOMENTE por service_role.
SELECT proname, proacl FROM pg_proc
 WHERE proname LIKE 'whatsapp_worker_%' ORDER BY proname;
*/
