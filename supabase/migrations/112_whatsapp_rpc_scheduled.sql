-- ============================================================================
-- Migration 112 — RPCs de Scheduled_Dispatch (task 12.6)
-- ----------------------------------------------------------------------------
-- Disparos programados (Req 13): criar (exigindo data/hora futura), listar
-- pendentes e cancelar. REUSA o motor de disparo já existente — não duplica a
-- materialização de recipients:
--
--   whatsapp_create_scheduled_dispatch(p_instance_id, p_kind,
--     p_distribution_mode, p_block_size, p_send_interval_sec, p_execution_quota,
--     p_list_id, p_group_jids, p_content_ids, p_scheduled_at) -> jsonb
--     - ESCRITA, gating SETTINGS_EDIT (precedência sobre validações).
--     - Anti-enumeração via whatsapp_assert_instance (Req 2.8).
--     - Exige `p_scheduled_at` no FUTURO; passado => WHATSAPP_SCHEDULE_IN_PAST
--       (Canonical_Message `Informe uma data e hora futuras.`, Req 13.2).
--     - Cria o Dispatch_Job em `DRAFT` (NÃO QUEUED) chamando internamente
--       `whatsapp_create_dispatch_job(..., 'DRAFT')` — assim o Job_Worker NÃO o
--       reivindica antes do horário; o `whatsapp_worker_sweep_scheduled` (111)
--       promove DRAFT->QUEUED quando `scheduled_at <= now` (Req 13.3, 13.6).
--       Reusa TODA a revalidação da 099 (lista/grupos/conteúdos/intervalo/quota
--       + exatamente 1 content por recipient + snapshot de recipient_data).
--     - Persiste a linha em `whatsapp_scheduled_dispatches` (durável, com o
--       `instance_id`, Req 13.1). Tudo na MESMA transação (atômico).
--
--   whatsapp_list_scheduled_dispatches(p_instance_id) -> jsonb (array)
--     - LEITURA, gating SETTINGS_VIEW. Lista os agendamentos PENDENTES da
--       Active_Instance (executed_at IS NULL e job não-terminal) com data/hora,
--       destino (kind + lista/grupos) e contagem de Contents (Req 13.4).
--
--   whatsapp_cancel_scheduled_dispatch(p_instance_id, p_scheduled_id,
--     p_expected_updated_at) -> jsonb
--     - ESCRITA, gating SETTINGS_EDIT. Cancela um agendamento ainda não
--       executado: transiciona o Dispatch_Job DRAFT->CANCELLED (grava
--       completed_at) e marca o agendamento como resolvido (executed_at=now),
--       impedindo a execução no horário (Req 13.5). Versionamento otimista
--       (`expected_updated_at`/`STALE_VERSION`); idempotência _SKIPPED
--       (ALREADY_CANCELLED / ALREADY_EXECUTED); anti-enumeração WHATSAPP_NOT_FOUND.
--       Job já fora de DRAFT (iniciado manualmente) => INVALID_STATE_TRANSITION.
--
-- O AUDIT positivo de criação/cancelamento (Req 13.7) é gravado pela camada TS
-- (scheduled.ts) via executeAdminMutation com o `instance_id`; o _SKIPPED do
-- cancelamento é gravado DENTRO desta RPC (admin-patterns #4).
--
-- Depende de objetos da 092 e da RPC 099:
--   - funcao public.whatsapp_require_permission(text)     (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)        (SECTION 14 da 092)
--   - funcao public.whatsapp_create_dispatch_job(...)     (migration 099)
--   - tabelas whatsapp_dispatch_jobs / _scheduled_dispatches / _group_dispatches
--
-- Postura (admin-patterns #2, #10): SECURITY DEFINER + SET search_path = public;
-- gating server-side (log negativo WHATSAPP_VIEW_DENIED em falha); anti-enum;
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta a anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pré-requisitos.
-- _Requirements: 13.1, 13.2, 13.4, 13.5, 13.7
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validações defensivas: a 092 e a 099 precisam ter sido aplicadas.
-- ----------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'whatsapp_assert_instance'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: whatsapp_assert_instance ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'whatsapp_create_dispatch_job'
  ) THEN
    RAISE EXCEPTION
      'Migration 099 (whatsapp_create_dispatch_job) nao aplicada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_scheduled_dispatches'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: whatsapp_scheduled_dispatches ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_create_scheduled_dispatch(...)
-- ----------------------------------------------------------------------------
-- Cria um Scheduled_Dispatch: valida data futura, cria o job em DRAFT (reusando
-- a 099 com toda a revalidação) e persiste o agendamento. Atômico.
CREATE OR REPLACE FUNCTION whatsapp_create_scheduled_dispatch(
  p_instance_id       uuid,
  p_kind              dispatch_kind,
  p_distribution_mode distribution_mode DEFAULT NULL,
  p_block_size        int               DEFAULT NULL,
  p_send_interval_sec int               DEFAULT NULL,
  p_execution_quota   int               DEFAULT NULL,
  p_list_id           uuid              DEFAULT NULL,
  p_group_jids        text[]            DEFAULT NULL,
  p_content_ids       uuid[]            DEFAULT NULL,
  p_scheduled_at      timestamptz       DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_job          jsonb;
  v_job_id       uuid;
  v_sched_id     uuid;
  v_sched_created timestamptz;
  v_sched_updated timestamptz;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) — precedência sobre validações.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeração: instância precisa existir/estar habilitada (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Data/hora deve estar no FUTURO (Req 13.2). Passado/nulo => bloqueia.
  IF p_scheduled_at IS NULL OR p_scheduled_at <= now() THEN
    RAISE EXCEPTION 'WHATSAPP_SCHEDULE_IN_PAST' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Cria o Dispatch_Job em DRAFT reusando a 099 (revalida lista/grupos/
  --     conteúdos/intervalo/quota e materializa os recipients). Status DRAFT
  --     mantém o job FORA do alcance do worker até o sweep promover no horário.
  v_job := whatsapp_create_dispatch_job(
    p_instance_id, p_kind, p_distribution_mode, p_block_size,
    p_send_interval_sec, p_execution_quota, p_list_id, p_group_jids,
    p_content_ids, 'DRAFT'
  );
  v_job_id := (v_job ->> 'id')::uuid;

  -- (e) Persiste o agendamento (durável, com instance_id — Req 13.1).
  INSERT INTO whatsapp_scheduled_dispatches (instance_id, dispatch_job_id, scheduled_at)
  VALUES (p_instance_id, v_job_id, p_scheduled_at)
  RETURNING id, created_at, updated_at
       INTO v_sched_id, v_sched_created, v_sched_updated;

  -- (f) Retorno consumido pela camada TS (task 12.6) para o audit positivo.
  RETURN jsonb_build_object(
    'scheduled_id',    v_sched_id,
    'dispatch_job_id', v_job_id,
    'instance_id',     p_instance_id,
    'kind',            p_kind,
    'scheduled_at',    p_scheduled_at,
    'total_count',     (v_job ->> 'total_count')::int,
    'created_at',      v_sched_created,
    'updated_at',      v_sched_updated
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_create_scheduled_dispatch(
  uuid, dispatch_kind, distribution_mode, int, int, int, uuid, text[], uuid[], timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_create_scheduled_dispatch(
  uuid, dispatch_kind, distribution_mode, int, int, int, uuid, text[], uuid[], timestamptz
) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_list_scheduled_dispatches(p_instance_id)
-- ----------------------------------------------------------------------------
-- Lista os agendamentos PENDENTES (executed_at IS NULL e job não-terminal) da
-- Active_Instance, com data/hora, destino e contagem de Contents (Req 13.4).
CREATE OR REPLACE FUNCTION whatsapp_list_scheduled_dispatches(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC).
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeração de instância.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Agendamentos pendentes, escopados por instância, ordenados por horário.
  SELECT COALESCE(jsonb_agg(row_to_jsonb(s) ORDER BY s.scheduled_at), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        sd.id                AS scheduled_id,
        sd.dispatch_job_id   AS dispatch_job_id,
        sd.scheduled_at      AS scheduled_at,
        j.kind               AS kind,
        j.status             AS status,
        j.total_count        AS total_count,
        j.send_interval_sec  AS send_interval_sec,
        j.execution_quota    AS execution_quota,
        gd.group_jids        AS group_jids,
        (
          SELECT count(*) FROM whatsapp_contents c
           WHERE c.dispatch_job_id = j.id
             AND c.instance_id = p_instance_id
        )                    AS content_count,
        j.updated_at         AS updated_at
      FROM whatsapp_scheduled_dispatches sd
      JOIN whatsapp_dispatch_jobs j
        ON j.id = sd.dispatch_job_id
       AND j.instance_id = sd.instance_id
      LEFT JOIN whatsapp_group_dispatches gd
        ON gd.dispatch_job_id = j.id
       AND gd.instance_id = sd.instance_id
     WHERE sd.instance_id = p_instance_id
       AND sd.executed_at IS NULL
       AND j.status NOT IN ('CANCELLED', 'COMPLETED', 'FAILED')
    ) s;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_scheduled_dispatches(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_scheduled_dispatches(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_cancel_scheduled_dispatch(p_instance_id, p_scheduled_id, p_expected_updated_at)
-- ----------------------------------------------------------------------------
-- Cancela um agendamento pendente: job DRAFT->CANCELLED + executed_at=now
-- (impede execução no horário, Req 13.5). Idempotência _SKIPPED + versionamento
-- otimista + anti-enumeração, espelhando a postura de whatsapp_transition_dispatch.
CREATE OR REPLACE FUNCTION whatsapp_cancel_scheduled_dispatch(
  p_instance_id         uuid,
  p_scheduled_id        uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller       uuid;
  v_job_id       uuid;
  v_executed_at  timestamptz;
  v_status       text;
  v_new_updated  timestamptz;
  v_rows         int;
  v_still_exists boolean;
BEGIN
  -- (a) Gating de escrita + auth (loga WHATSAPP_VIEW_DENIED em falha).
  v_caller := whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeração de instância.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Pré-fetch escopado por instância (agendamento + job).
  SELECT sd.dispatch_job_id, sd.executed_at, j.status::text
    INTO v_job_id, v_executed_at, v_status
    FROM whatsapp_scheduled_dispatches sd
    JOIN whatsapp_dispatch_jobs j
      ON j.id = sd.dispatch_job_id
     AND j.instance_id = sd.instance_id
   WHERE sd.id = p_scheduled_id
     AND sd.instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Idempotência (Req 13.5): já cancelado ou já executado/promovido =>
  --     _SKIPPED (grava o log aqui dentro; não usa executeAdminMutation).
  IF v_status = 'CANCELLED' THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller, 'WHATSAPP_SCHEDULED_CANCEL_SKIPPED', 'whatsapp_scheduled_dispatches',
      p_scheduled_id,
      jsonb_build_object('instance_id', p_instance_id, 'status', v_status),
      jsonb_build_object('instance_id', p_instance_id, 'reason', 'ALREADY_CANCELLED')
    );
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_CANCELLED');
  END IF;

  IF v_executed_at IS NOT NULL THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    ) VALUES (
      v_caller, 'WHATSAPP_SCHEDULED_CANCEL_SKIPPED', 'whatsapp_scheduled_dispatches',
      p_scheduled_id,
      jsonb_build_object('instance_id', p_instance_id, 'status', v_status),
      jsonb_build_object('instance_id', p_instance_id, 'reason', 'ALREADY_EXECUTED')
    );
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_EXECUTED');
  END IF;

  -- (e) Job iniciado manualmente (fora de DRAFT) sem ter sido executado pelo
  --     agendamento => não é cancelável por esta via (use a transição normal).
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  -- (f) Transição DRAFT->CANCELLED com versionamento otimista (Req 13.5). O
  --     trigger de touch atualiza updated_at após o match do WHERE.
  UPDATE whatsapp_dispatch_jobs
     SET status = 'CANCELLED', completed_at = now()
   WHERE id = v_job_id
     AND instance_id = p_instance_id
     AND status = 'DRAFT'
     AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_new_updated;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- (g) ROW_COUNT = 0: versão desatualizada OU corrida com o sweep (DRAFT->
  --     QUEUED). Distingue: se o agendamento já foi marcado executado, é
  --     ALREADY_EXECUTED (_SKIPPED); senão é STALE_VERSION; se o job sumiu,
  --     NOT_FOUND.
  IF v_rows = 0 THEN
    SELECT sd.executed_at, EXISTS (
      SELECT 1 FROM whatsapp_dispatch_jobs j
       WHERE j.id = v_job_id AND j.instance_id = p_instance_id
    )
      INTO v_executed_at, v_still_exists
      FROM whatsapp_scheduled_dispatches sd
     WHERE sd.id = p_scheduled_id AND sd.instance_id = p_instance_id;

    IF v_executed_at IS NOT NULL THEN
      INSERT INTO admin_audit_logs(
        admin_id, action, target_type, target_id, before_data, after_data
      ) VALUES (
        v_caller, 'WHATSAPP_SCHEDULED_CANCEL_SKIPPED', 'whatsapp_scheduled_dispatches',
        p_scheduled_id, NULL,
        jsonb_build_object('instance_id', p_instance_id, 'reason', 'ALREADY_EXECUTED')
      );
      RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_EXECUTED');
    ELSIF v_still_exists THEN
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (h) Marca o agendamento como resolvido (não será promovido pelo sweep).
  UPDATE whatsapp_scheduled_dispatches
     SET executed_at = now()
   WHERE id = p_scheduled_id
     AND instance_id = p_instance_id;

  -- (i) Retorno da transição válida (camada TS grava o audit positivo, Req 13.7).
  RETURN jsonb_build_object(
    'ok',              true,
    'scheduled_id',    p_scheduled_id,
    'dispatch_job_id', v_job_id,
    'instance_id',     p_instance_id,
    'previous_status', 'DRAFT',
    'status',          'CANCELLED',
    'updated_at',      v_new_updated
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_cancel_scheduled_dispatch(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_cancel_scheduled_dispatch(uuid, uuid, timestamptz) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; NÃO executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pré-req: instância habilitada + 1 Content válido + 1 Contact_List com contatos.

-- 1) Criar agendamento futuro (BULK): cria job DRAFT + linha scheduled.
SELECT jsonb_pretty(whatsapp_create_scheduled_dispatch(
  '<inst>','BULK','INTERLEAVED',NULL,30,100,'<list_id>',NULL,
  ARRAY['<content_a>']::uuid[], now() + interval '1 hour'));

-- 2) Data no passado => WHATSAPP_SCHEDULE_IN_PAST (P0001):
SELECT whatsapp_create_scheduled_dispatch(
  '<inst>','BULK','INTERLEAVED',NULL,30,100,'<list_id>',NULL,
  ARRAY['<content_a>']::uuid[], now() - interval '1 minute');

-- 3) Listar pendentes:
SELECT jsonb_pretty(whatsapp_list_scheduled_dispatches('<inst>'));

-- 4) Cancelar (DRAFT->CANCELLED + executed_at). Use o updated_at do job listado:
SELECT jsonb_pretty(whatsapp_cancel_scheduled_dispatch('<inst>','<sched_id>','<updated_at>'));
SELECT status, completed_at FROM whatsapp_dispatch_jobs WHERE id='<job>';
SELECT executed_at FROM whatsapp_scheduled_dispatches WHERE id='<sched_id>';

-- 5) Cancelar de novo => _SKIPPED ALREADY_CANCELLED:
SELECT jsonb_pretty(whatsapp_cancel_scheduled_dispatch('<inst>','<sched_id>','<updated_at>'));

-- 6) Agendado/instância inexistente => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_cancel_scheduled_dispatch('<inst>','00000000-0000-0000-0000-000000000000', now());
*/
