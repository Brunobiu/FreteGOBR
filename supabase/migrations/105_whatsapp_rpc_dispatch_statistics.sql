-- ============================================================================
-- Migration 105 — whatsapp_get_dispatch_statistics (task 14.1)
-- ----------------------------------------------------------------------------
-- RPC de LEITURA das Dispatch_Statistics de um Dispatch_Job (Req 28). Agrega os
-- contadores de whatsapp_dispatch_recipients por status, SEMPRE escopados pelo
-- par (instance_id, dispatch_job_id) — nunca cruza dados de outra instancia
-- (Req 28.6). Os contadores derivados sao (Req 28.2):
--   - sent_count      : Dispatch_Recipients com status SENT      (total enviado)
--   - pending_count   : Dispatch_Recipients com status PENDING   (total pendente)
--   - failed_count    : Dispatch_Recipients com status FAILED    (total com erro)
--   - skipped_count   : Dispatch_Recipients com status SKIPPED
--   - completed_count : SENT + FAILED + SKIPPED                  (total concluido)
--   - total_count     : total de Dispatch_Recipients do job
--
-- O Estimated_Completion_Time (Req 28.3, 28.4) NAO e calculado aqui: a RPC
-- expoe pending_count + send_interval_sec e a camada de servico (stats.ts)
-- reusa a funcao pura `estimatedCompletionMs(pending, intervalSec)` (tasks
-- 2.9/2.11), mantendo a formula em um unico lugar testavel por property test.
--
--   whatsapp_get_dispatch_statistics(p_instance_id uuid, p_job_id uuid)
--     - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC), com log negativo
--       WHATSAPP_VIEW_DENIED em falha.
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8, 30.8).
--     - Job inexistente OU de outra instancia (cruzado) => WHATSAPP_NOT_FOUND
--       (P0001), resposta indistinguivel, sem revelar existencia.
--     - Retorna { job_id, sent_count, pending_count, failed_count,
--       skipped_count, completed_count, total_count, send_interval_sec }.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs para
-- evitar conflitos de edicao. Numero 105 reservado para esta onda (outras ondas
-- usam 103/104). Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)    (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)       (SECTION 14 da 092)
--   - tabela public.whatsapp_dispatch_jobs               (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients         (SECTION 6 da 092)
--   - dominio public.recipient_status                    (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- anti-enumeracao via whatsapp_assert_instance; REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO authenticated. Nunca exposta ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 28.1, 28.2, 28.3, 28.4, 28.6_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_require_permission'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_require_permission ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_assert_instance'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_assert_instance ausente';
  END IF;

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
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_dispatch_statistics(p_instance_id uuid, p_job_id uuid)
-- ----------------------------------------------------------------------------
-- LEITURA das Dispatch_Statistics de um Dispatch_Job. Agrega os contadores de
-- whatsapp_dispatch_recipients por status, escopados por (instance_id, job).
CREATE OR REPLACE FUNCTION whatsapp_get_dispatch_statistics(
  p_instance_id uuid,
  p_job_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_send_interval_sec int;
  v_sent_count        bigint;
  v_pending_count     bigint;
  v_failed_count      bigint;
  v_skipped_count     bigint;
  v_total_count       bigint;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard. Em falha grava
  --     WHATSAPP_VIEW_DENIED e lanca permission_denied (ERRCODE 42501).
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada; caso
  --     contrario, marker canonico WHATSAPP_NOT_FOUND (Req 2.8, 30.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) O job precisa existir E pertencer a MESMA instancia (Req 28.6). Job
  --     inexistente ou cruzado entre instancias => WHATSAPP_NOT_FOUND, resposta
  --     indistinguivel (anti-enumeracao). O send_interval_sec e lido aqui para
  --     o calculo do Estimated_Completion_Time na camada de servico (Req 28.3).
  SELECT j.send_interval_sec
    INTO v_send_interval_sec
    FROM whatsapp_dispatch_jobs j
   WHERE j.id = p_job_id
     AND j.instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Agrega os contadores por status, SEMPRE escopados por (instance_id,
  --     dispatch_job_id) — nunca agrega recipients de outra instancia (Req 28.6).
  SELECT
    count(*) FILTER (WHERE r.status = 'SENT'),
    count(*) FILTER (WHERE r.status = 'PENDING'),
    count(*) FILTER (WHERE r.status = 'FAILED'),
    count(*) FILTER (WHERE r.status = 'SKIPPED'),
    count(*)
    INTO v_sent_count, v_pending_count, v_failed_count, v_skipped_count, v_total_count
    FROM whatsapp_dispatch_recipients r
   WHERE r.instance_id = p_instance_id
     AND r.dispatch_job_id = p_job_id;

  -- (e) Contrato estavel para a UI/servico. completed_count = SENT + FAILED +
  --     SKIPPED (total concluido, Req 28.2). Os contadores vao como inteiros.
  RETURN jsonb_build_object(
    'job_id',            p_job_id,
    'sent_count',        v_sent_count,
    'pending_count',     v_pending_count,
    'failed_count',      v_failed_count,
    'skipped_count',     v_skipped_count,
    'completed_count',   (v_sent_count + v_failed_count + v_skipped_count),
    'total_count',       v_total_count,
    'send_interval_sec', v_send_interval_sec
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_dispatch_statistics(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_dispatch_statistics(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e um job dela:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT id FROM whatsapp_dispatch_jobs WHERE instance_id = '<instance_id>' LIMIT 1;

-- 1) Estatisticas do job (contadores agregados por status):
SELECT jsonb_pretty(whatsapp_get_dispatch_statistics('<instance_id>', '<job_id>'));

-- 2) Job inexistente => anti-enumeracao (WHATSAPP_NOT_FOUND / P0001):
SELECT whatsapp_get_dispatch_statistics('<instance_id>', '00000000-0000-0000-0000-000000000000');

-- 3) Job de OUTRA instancia (cruzado) => WHATSAPP_NOT_FOUND (mesma resposta):
SELECT whatsapp_get_dispatch_statistics('<instance_id>', '<job_de_outra_instancia>');

-- 4) Instancia inexistente => anti-enumeracao (WHATSAPP_NOT_FOUND / P0001):
SELECT whatsapp_get_dispatch_statistics('00000000-0000-0000-0000-000000000000', '<job_id>');

-- 5) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
