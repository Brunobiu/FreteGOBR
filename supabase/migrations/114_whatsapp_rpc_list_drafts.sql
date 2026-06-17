-- ============================================================================
-- Migration 114 — whatsapp_list_drafts (task 20.13, Req 21.2)
-- ----------------------------------------------------------------------------
-- RPC de LEITURA dos Drafts (rascunhos) da Active_Instance. Drafts são
-- Dispatch_Jobs no status `DRAFT` que NÃO estão atrelados a um agendamento
-- pendente (esses aparecem na aba Programados, não na lista de rascunhos).
-- A `whatsapp_list_campaign_history` (107) exclui DRAFT de propósito (só lista
-- executados), por isso esta RPC dedicada (Req 21.2).
--
--   whatsapp_list_drafts(p_instance_id) -> jsonb (array)
--     - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC), log negativo em falha.
--     - Anti-enumeração via whatsapp_assert_instance (Req 2.8).
--     - Retorna os DRAFT da instância SEM Scheduled_Dispatch pendente, com
--       resumo: kind, distribution_mode, block_size, send_interval_sec,
--       execution_quota, total_count (destinatários materializados),
--       content_count (Contents distintos atribuídos) e datas (created_at =
--       criação, updated_at = última edição). Ordenado por updated_at DESC.
--
-- Depende de objetos da 092 (whatsapp_require_permission/assert_instance,
-- whatsapp_dispatch_jobs/_recipients/_scheduled_dispatches).
--
-- Postura (admin-patterns #2,#10): SECURITY DEFINER + SET search_path=public;
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated.
-- _Requirements: 21.2, 21.8
-- ============================================================================

BEGIN;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'whatsapp_assert_instance'
  ) THEN
    RAISE EXCEPTION 'Migration 092 nao aplicada: whatsapp_assert_instance ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_scheduled_dispatches'
  ) THEN
    RAISE EXCEPTION 'Migration 092 nao aplicada: whatsapp_scheduled_dispatches ausente';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION whatsapp_list_drafts(p_instance_id uuid)
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

  -- (c) DRAFT sem agendamento pendente, com resumo. content_count = Contents
  --     distintos efetivamente atribuídos aos destinatários do job.
  SELECT COALESCE(jsonb_agg(d ORDER BY (d->>'updated_at') DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
               'id',                j.id,
               'kind',              j.kind,
               'distribution_mode', j.distribution_mode,
               'block_size',        j.block_size,
               'send_interval_sec', j.send_interval_sec,
               'execution_quota',   j.execution_quota,
               'total_count',       j.total_count,
               'content_count', (
                 SELECT count(DISTINCT r.assigned_content_id)
                   FROM whatsapp_dispatch_recipients r
                  WHERE r.dispatch_job_id = j.id
                    AND r.assigned_content_id IS NOT NULL
               ),
               'created_at',        j.created_at,
               'updated_at',        j.updated_at
             ) AS d
        FROM whatsapp_dispatch_jobs j
       WHERE j.instance_id = p_instance_id
         AND j.status = 'DRAFT'
         AND NOT EXISTS (
               SELECT 1 FROM whatsapp_scheduled_dispatches sd
                WHERE sd.dispatch_job_id = j.id
                  AND sd.executed_at IS NULL
             )
    ) s;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_drafts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_drafts(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; NÃO executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pré-req: crie um job DRAFT (whatsapp_create_dispatch_job ... 'DRAFT').
SELECT jsonb_pretty(whatsapp_list_drafts('<inst>'));
-- Um DRAFT agendado (com scheduled_dispatch pendente) NÃO deve aparecer aqui.
*/
