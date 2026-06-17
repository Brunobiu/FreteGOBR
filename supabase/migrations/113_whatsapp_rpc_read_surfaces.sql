-- ============================================================================
-- Migration 113 — RPCs de leitura: Dashboard, Execution_Queue, Error_Log (task 19)
-- ----------------------------------------------------------------------------
-- Superfícies de LEITURA do WhatsApp_Module, todas escopadas por `instance_id`
-- da Active_Instance e revalidando `SETTINGS_VIEW` no servidor (Req 19.9, 22.6,
-- nunca cruzam dados de outra instância). NÃO mutam ⇒ não auditam.
--
--   whatsapp_get_dashboard(p_instance_id) -> jsonb  (Req 19)
--     Indicadores operacionais do dia (fuso America/Sao_Paulo): status de
--     conexão, enviadas hoje, em andamento, agendadas, concluídos hoje, com
--     erro, total na fila, respostas recebidas e atendimentos ativos. Um único
--     round-trip atômico: todos os contadores compartilham a MESMA fonte (o
--     banco) e o MESMO gate de permissão — uma leitura atômica é mais eficiente,
--     evita leitura "rasgada" entre blocos e mantém a precedência de
--     permission_denied num único ponto. A degradação por bloco (admin-patterns
--     #6) fica na UI (cada KPI re-busca em falha da leitura inteira).
--
--   whatsapp_get_execution_queue(p_instance_id) -> jsonb (array)  (Req 22)
--     Dispatch_Jobs da instância em estados de fila (QUEUED/RUNNING/PAUSED/
--     COMPLETED/CANCELLED/FAILED) + Scheduled_Dispatches pendentes como grupo
--     `SCHEDULED`. Cada item traz `queue_group`, progresso (contadores) e as
--     datas relevantes (início/agendamento/conclusão). O mapa de rótulos PT
--     (Req 22.8) fica na camada de serviço.
--
--   whatsapp_get_error_log(p_instance_id, p_job_id) -> jsonb (array)  (Req 23.2)
--     Dispatch_Recipients FAILED de um job, com Contact_Number (phone/group_jid)
--     e `failure_reason` (pt-BR, sem segredos — Req 23.8). Job inexistente/
--     cruzado => WHATSAPP_NOT_FOUND.
--
-- Depende de objetos da 092:
--   - whatsapp_require_permission(text) / whatsapp_assert_instance(uuid)
--   - tabelas whatsapp_dispatch_jobs / _recipients / _scheduled_dispatches /
--     _sessions / _conversations / _messages
--
-- Postura (admin-patterns #2, #10): SECURITY DEFINER + SET search_path = public;
-- gating server-side (log negativo WHATSAPP_VIEW_DENIED); anti-enum;
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta a anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco DO $check$.
-- _Requirements: 19.1-19.13, 22.1-22.8, 23.2, 23.8
-- ============================================================================

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'whatsapp_require_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 092 nao aplicada: whatsapp_require_permission ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'whatsapp_assert_instance'
  ) THEN
    RAISE EXCEPTION 'Migration 092 nao aplicada: whatsapp_assert_instance ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
  ) THEN
    RAISE EXCEPTION 'Migration 092 nao aplicada: whatsapp_conversations ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_dashboard(p_instance_id) — contadores do dia (Req 19)
-- ----------------------------------------------------------------------------
-- "Hoje" = dia corrente no fuso America/Sao_Paulo (produto pt-BR). Todos os
-- contadores são filtrados por instance_id (Req 19.8).
CREATE OR REPLACE FUNCTION whatsapp_get_dashboard(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_tz                 text := 'America/Sao_Paulo';
  v_today_start        timestamptz;
  v_today_end          timestamptz;
  v_connection_status  text;
  v_sent_today         bigint;
  v_in_progress        bigint;
  v_scheduled          bigint;
  v_completed_today    bigint;
  v_errored            bigint;
  v_queue_current      bigint;
  v_replies_received   bigint;
  v_active_convs       bigint;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) — log negativo em falha.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeração de instância (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Limites do dia corrente no fuso do produto (meia-noite local -> UTC).
  v_today_start := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_today_end   := v_today_start + interval '1 day';

  -- (d) Conexão: status persistido da Session única da instância (Req 19.1).
  SELECT COALESCE(s.status::text, 'DISCONNECTED')
    INTO v_connection_status
    FROM whatsapp_instances i
    LEFT JOIN whatsapp_sessions s ON s.instance_id = i.id
   WHERE i.id = p_instance_id;
  v_connection_status := COALESCE(v_connection_status, 'DISCONNECTED');

  -- (e) Enviadas hoje: recipients SENT com sent_at no dia corrente (Req 19.2).
  SELECT count(*) INTO v_sent_today
    FROM whatsapp_dispatch_recipients r
   WHERE r.instance_id = p_instance_id
     AND r.status = 'SENT'
     AND r.sent_at >= v_today_start
     AND r.sent_at <  v_today_end;

  -- (f) Em andamento: jobs RUNNING (Req 19.10).
  SELECT count(*) INTO v_in_progress
    FROM whatsapp_dispatch_jobs j
   WHERE j.instance_id = p_instance_id
     AND j.status = 'RUNNING';

  -- (g) Agendadas: Scheduled_Dispatches pendentes com data futura (Req 19.5).
  SELECT count(*) INTO v_scheduled
    FROM whatsapp_scheduled_dispatches sd
   WHERE sd.instance_id = p_instance_id
     AND sd.executed_at IS NULL
     AND sd.scheduled_at > now();

  -- (h) Concluídos hoje: jobs COMPLETED com completed_at no dia corrente (Req 19.11).
  SELECT count(*) INTO v_completed_today
    FROM whatsapp_dispatch_jobs j
   WHERE j.instance_id = p_instance_id
     AND j.status = 'COMPLETED'
     AND j.completed_at >= v_today_start
     AND j.completed_at <  v_today_end;

  -- (i) Com erro: recipients FAILED (Req 19.3).
  SELECT count(*) INTO v_errored
    FROM whatsapp_dispatch_recipients r
   WHERE r.instance_id = p_instance_id
     AND r.status = 'FAILED';

  -- (j) Fila atual: jobs QUEUED + RUNNING (Req 19.4).
  SELECT count(*) INTO v_queue_current
    FROM whatsapp_dispatch_jobs j
   WHERE j.instance_id = p_instance_id
     AND j.status IN ('QUEUED', 'RUNNING');

  -- (k) Respostas recebidas hoje: mensagens INBOUND no dia corrente (Req 19.12).
  SELECT count(*) INTO v_replies_received
    FROM whatsapp_messages m
   WHERE m.instance_id = p_instance_id
     AND m.direction = 'INBOUND'
     AND m.created_at >= v_today_start
     AND m.created_at <  v_today_end;

  -- (l) Atendimentos ativos: conversas em qualquer modo ativo (Req 19.13).
  SELECT count(*) INTO v_active_convs
    FROM whatsapp_conversations c
   WHERE c.instance_id = p_instance_id
     AND c.mode IN ('AI_MODE', 'HUMAN_MODE', 'AI_PAUSED', 'RETURNED_TO_AI');

  RETURN jsonb_build_object(
    'connection_status',   v_connection_status,
    'sent_today',          v_sent_today,
    'in_progress',         v_in_progress,
    'scheduled',           v_scheduled,
    'completed_today',     v_completed_today,
    'errored',             v_errored,
    'queue_current',       v_queue_current,
    'replies_received',    v_replies_received,
    'active_conversations',v_active_convs
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_dashboard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_dashboard(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_execution_queue(p_instance_id) -> jsonb (array)  (Req 22)
-- ----------------------------------------------------------------------------
-- Une jobs em estados de fila + agendados pendentes (grupo SCHEDULED). Cada item
-- traz queue_group, progresso (contadores) e datas relevantes. O DRAFT puro
-- (rascunho não agendado) NÃO entra aqui (vai na lista de Drafts).
CREATE OR REPLACE FUNCTION whatsapp_get_execution_queue(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');
  PERFORM whatsapp_assert_instance(p_instance_id);

  SELECT COALESCE(jsonb_agg(item ORDER BY item_order, relevant_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
    FROM (
      -- Jobs em estados de fila (exclui DRAFT — rascunhos não entram na fila).
      SELECT
        jsonb_build_object(
          'job_id',         j.id,
          'scheduled_id',   NULL,
          'queue_group',    j.status,
          'kind',           j.kind,
          'total_count',    j.total_count,
          'sent_count',     j.sent_count,
          'failed_count',   j.failed_count,
          'skipped_count',  j.skipped_count,
          'send_interval_sec', j.send_interval_sec,
          'relevant_at',    COALESCE(j.completed_at, j.started_at, j.created_at),
          'updated_at',     j.updated_at
        ) AS item,
        CASE j.status
          WHEN 'RUNNING'   THEN 1
          WHEN 'QUEUED'    THEN 2
          WHEN 'PAUSED'    THEN 3
          WHEN 'COMPLETED' THEN 5
          WHEN 'CANCELLED' THEN 6
          WHEN 'FAILED'    THEN 7
          ELSE 8
        END AS item_order,
        COALESCE(j.completed_at, j.started_at, j.created_at) AS relevant_at
      FROM whatsapp_dispatch_jobs j
      WHERE j.instance_id = p_instance_id
        AND j.status IN ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED')

      UNION ALL

      -- Agendados pendentes (grupo SCHEDULED). O job correspondente está DRAFT.
      SELECT
        jsonb_build_object(
          'job_id',         j.id,
          'scheduled_id',   sd.id,
          'queue_group',    'SCHEDULED',
          'kind',           j.kind,
          'total_count',    j.total_count,
          'sent_count',     j.sent_count,
          'failed_count',   j.failed_count,
          'skipped_count',  j.skipped_count,
          'send_interval_sec', j.send_interval_sec,
          'relevant_at',    sd.scheduled_at,
          'updated_at',     j.updated_at
        ) AS item,
        4 AS item_order,
        sd.scheduled_at AS relevant_at
      FROM whatsapp_scheduled_dispatches sd
      JOIN whatsapp_dispatch_jobs j
        ON j.id = sd.dispatch_job_id
       AND j.instance_id = sd.instance_id
      WHERE sd.instance_id = p_instance_id
        AND sd.executed_at IS NULL
        AND j.status = 'DRAFT'
    ) q;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_execution_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_execution_queue(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_error_log(p_instance_id, p_job_id) -> jsonb (array) (Req 23.2)
-- ----------------------------------------------------------------------------
-- Lista os Dispatch_Recipients FAILED de um job, com Contact_Number e
-- failure_reason (pt-BR, sem segredos — a marcação no worker já é genérica).
CREATE OR REPLACE FUNCTION whatsapp_get_error_log(
  p_instance_id uuid,
  p_job_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- Job precisa existir E pertencer à instância (cruzado => anti-enum).
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_dispatch_jobs j
     WHERE j.id = p_job_id AND j.instance_id = p_instance_id
  ) THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'recipient_id',   r.id,
             'target_kind',    r.target_kind,
             'phone',          r.phone,
             'group_jid',      r.group_jid,
             'failure_reason', r.failure_reason,
             'seq',            r.seq
           ) ORDER BY r.seq
         ), '[]'::jsonb)
    INTO v_result
    FROM whatsapp_dispatch_recipients r
   WHERE r.instance_id = p_instance_id
     AND r.dispatch_job_id = p_job_id
     AND r.status = 'FAILED';

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_error_log(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_error_log(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; NÃO executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instância habilitada:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Dashboard (contadores do dia):
SELECT jsonb_pretty(whatsapp_get_dashboard('<inst>'));

-- 2) Fila de execução (jobs por estado + agendados):
SELECT jsonb_pretty(whatsapp_get_execution_queue('<inst>'));

-- 3) Error log de um job com falhas:
SELECT jsonb_pretty(whatsapp_get_error_log('<inst>', '<job>'));

-- 4) Job de outra instância no error log => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_get_error_log('<inst>', '<job_de_outra_instancia>');

-- 5) Sem permissão => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action='WHATSAPP_VIEW_DENIED' ORDER BY created_at DESC LIMIT 1;
*/
