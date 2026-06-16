-- ============================================================================
-- Migration 107 — Campaign_History (task 11.4)
-- ----------------------------------------------------------------------------
-- RPCs do Campaign_History do WhatsApp_Module (Req 20). Tres funcoes, todas
-- escopadas por `instance_id` da Active_Instance (isolamento multi-instancia —
-- Req 20.6): nunca expoem nem operam campanhas de outra WhatsApp_Instance.
--
--   1) whatsapp_list_campaign_history(p_instance_id, p_status, p_limit, p_offset)
--        - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC, Req 20.8), com log
--          negativo WHATSAPP_VIEW_DENIED em falha.
--        - Lista os Dispatch_Jobs JA EXECUTADOS da instancia: estados terminais
--          preservados sem exclusao automatica (COMPLETED/CANCELLED/FAILED —
--          Req 20.1) e os em andamento (RUNNING/PAUSED). DRAFT/QUEUED (nao
--          executados) ficam de fora do historico.
--        - Cada item traz data/hora de execucao, qtd de contatos (total de
--          destinatarios), conteudos utilizados, estado final (Status),
--          Execution_Duration, total enviado e total com erro (Req 20.2, 20.9).
--        - Execution_Duration = completed_at - started_at (em segundos), NULL
--          quando ainda nao terminou ou nao iniciou (Req 20.10).
--        - p_status opcional filtra por um estado; NULL = todos os executados.
--        - Retorna SEMPRE um array jsonb (vazio quando nao ha historico).
--
--   2) whatsapp_get_campaign_detail(p_instance_id, p_job_id)
--        - LEITURA, gating SETTINGS_VIEW (Req 20.8). Detalhe ESCOPADO a
--          instancia (Req 20.3, 20.6): Contents (com midias), destinatarios,
--          configuracoes e resultados, alem de data/hora, qtd de contatos,
--          Status final e Execution_Duration (Req 20.9, 20.10).
--        - Job inexistente OU de outra instancia (cruzado) => WHATSAPP_NOT_FOUND
--          (P0001), resposta indistinguivel (anti-enumeracao, Req 2.8, 30.8).
--
--   3) whatsapp_duplicate_campaign(p_instance_id, p_job_id, p_mode)
--        - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC). Cria um NOVO
--          Dispatch_Job na instancia copiando Contents (novas linhas + midias),
--          destinatarios e configuracoes da campanha de origem, gravando
--          `source_job_id` = job de origem (Req 20.4, 20.5, 20.11). Preserva
--          INTACTO o Dispatch_Job historico original.
--        - p_mode (dominio fechado):
--            * DUPLICATE => novo job em DRAFT (Req 20.4);
--            * REUSE     => novo job em DRAFT para edicao (Req 20.11);
--            * RESEND    => novo job em QUEUED para reprocessamento (Req 20.5).
--        - O AUDIT (Req 20.7, 20.12) NAO e gravado aqui: a camada de servico
--          (history.ts) envolve esta RPC em executeAdminMutation, registrando o
--          `instance_id` e o `source_job_id` (campanha de origem).
--        - Job inexistente/cruzado => WHATSAPP_NOT_FOUND (anti-enumeracao).
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs para
-- evitar conflitos de edicao. Numero 107 reservado para esta onda. Depende dos
-- objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)    (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)       (SECTION 14 da 092)
--   - tabela public.whatsapp_dispatch_jobs               (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients         (SECTION 6 da 092)
--   - tabela public.whatsapp_contents                    (SECTION 5 da 092)
--   - tabela public.whatsapp_content_media               (SECTION 5 da 092)
--   - tabela public.whatsapp_group_dispatches            (SECTION 7 da 092)
--   - dominios dispatch_status/dispatch_kind/distribution_mode (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- anti-enumeracao via whatsapp_assert_instance; REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO authenticated. Nunca expostas ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.9, 20.10, 20.11, 20.12_
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Validacoes defensivas: a 092 (whatsapp foundation) precisa ter sido aplicada.
-- Aborta cedo (sem criar objetos orfaos) se os pre-requisitos faltarem.
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

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_contents'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_contents ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_content_media'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_content_media ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_group_dispatches'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_group_dispatches ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC 1: whatsapp_list_campaign_history(p_instance_id, p_status, p_limit, p_offset)
-- ----------------------------------------------------------------------------
-- LEITURA do Campaign_History: Dispatch_Jobs JA EXECUTADOS da instancia. Inclui
-- os estados terminais preservados (COMPLETED/CANCELLED/FAILED — Req 20.1) e os
-- em andamento (RUNNING/PAUSED); exclui DRAFT/QUEUED (ainda nao executados).
-- Para cada item: qtd de contatos (total de destinatarios), conteudos
-- utilizados (distintos), enviados/erro (agregados dos recipients) e o
-- Execution_Duration em segundos (completed_at - started_at; Req 20.2, 20.9, 20.10).
CREATE OR REPLACE FUNCTION whatsapp_list_campaign_history(
  p_instance_id uuid,
  p_status      text DEFAULT NULL,
  p_limit       int  DEFAULT 50,
  p_offset      int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  c_max_limit constant int := 200;  -- hard cap de paginacao
  v_limit  int;
  v_offset int;
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard. Em falha grava
  --     WHATSAPP_VIEW_DENIED e lanca permission_denied (ERRCODE 42501).
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Normaliza a paginacao (defaults seguros, dentro do limite hard).
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), c_max_limit);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- (d) Lista escopada por instance_id (Req 20.6). Filtra os jobs ja executados
  --     (status em COMPLETED/CANCELLED/FAILED/RUNNING/PAUSED). p_status opcional
  --     restringe a um unico estado. Ordem: completed_at/started_at/created_at
  --     decrescente (a campanha mais recente primeiro). Sempre array jsonb.
  SELECT COALESCE(
           jsonb_agg(item ORDER BY ord_completed DESC NULLS LAST,
                                   ord_started   DESC NULLS LAST,
                                   ord_created   DESC),
           '[]'::jsonb
         )
    INTO v_result
    FROM (
      SELECT
        jsonb_build_object(
          'id',                    j.id,
          'instance_id',           j.instance_id,
          'kind',                  j.kind,
          'status',                j.status,
          'distribution_mode',     j.distribution_mode,
          'block_size',            j.block_size,
          'send_interval_sec',     j.send_interval_sec,
          'execution_quota',       j.execution_quota,
          'total_count',           j.total_count,
          'sent_count',            agg.sent_count,
          'failed_count',          agg.failed_count,
          'content_count',         agg.content_count,
          'source_job_id',         j.source_job_id,
          'started_at',            j.started_at,
          'completed_at',          j.completed_at,
          'execution_duration_sec',
            CASE
              WHEN j.started_at IS NOT NULL AND j.completed_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (j.completed_at - j.started_at))::int
              ELSE NULL
            END,
          'created_at',            j.created_at,
          'updated_at',            j.updated_at
        ) AS item,
        j.completed_at AS ord_completed,
        j.started_at   AS ord_started,
        j.created_at   AS ord_created
      FROM whatsapp_dispatch_jobs j
      CROSS JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE r.status = 'SENT')::int   AS sent_count,
          count(*) FILTER (WHERE r.status = 'FAILED')::int AS failed_count,
          count(DISTINCT r.assigned_content_id)::int       AS content_count
        FROM whatsapp_dispatch_recipients r
        WHERE r.dispatch_job_id = j.id
          AND r.instance_id = j.instance_id
      ) agg
      WHERE j.instance_id = p_instance_id
        AND j.status IN ('COMPLETED', 'CANCELLED', 'FAILED', 'RUNNING', 'PAUSED')
        AND (p_status IS NULL OR j.status = p_status::dispatch_status)
      ORDER BY j.completed_at DESC NULLS LAST,
               j.started_at   DESC NULLS LAST,
               j.created_at   DESC
      LIMIT v_limit OFFSET v_offset
    ) page;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_campaign_history(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_campaign_history(uuid, text, int, int) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC 2: whatsapp_get_campaign_detail(p_instance_id, p_job_id)
-- ----------------------------------------------------------------------------
-- LEITURA do detalhe de um item do Campaign_History, ESCOPADO a instancia
-- (Req 20.3, 20.6, 20.9). Retorna o job (config + resultados + Execution_Duration),
-- os Contents utilizados (com midias) e os destinatarios (com resultado por
-- recipient). Job inexistente/cruzado => WHATSAPP_NOT_FOUND (anti-enumeracao).
CREATE OR REPLACE FUNCTION whatsapp_get_campaign_detail(
  p_instance_id uuid,
  p_job_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_job        whatsapp_dispatch_jobs%ROWTYPE;
  v_sent       bigint;
  v_failed     bigint;
  v_skipped    bigint;
  v_pending    bigint;
  v_contents   jsonb;
  v_recipients jsonb;
BEGIN
  -- (a) Gating de leitura (Req 20.8) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) O job precisa existir E pertencer a MESMA instancia (Req 20.6). Job
  --     inexistente ou cruzado => WHATSAPP_NOT_FOUND, resposta indistinguivel.
  SELECT * INTO v_job
    FROM whatsapp_dispatch_jobs j
   WHERE j.id = p_job_id
     AND j.instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Agrega os contadores de resultado por status (escopado por job+instancia).
  SELECT
    count(*) FILTER (WHERE r.status = 'SENT'),
    count(*) FILTER (WHERE r.status = 'FAILED'),
    count(*) FILTER (WHERE r.status = 'SKIPPED'),
    count(*) FILTER (WHERE r.status = 'PENDING')
    INTO v_sent, v_failed, v_skipped, v_pending
    FROM whatsapp_dispatch_recipients r
   WHERE r.dispatch_job_id = p_job_id
     AND r.instance_id = p_instance_id;

  -- (e) Contents UTILIZADOS pelo disparo (distintos referenciados pelos
  --     recipients), com suas midias. Ordenados por position (ordem registrada).
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',       c.id,
               'body',     c.body,
               'position', c.position,
               'is_valid', c.is_valid,
               'media',    c.media
             ) ORDER BY c.position, c.id
           ),
           '[]'::jsonb
         )
    INTO v_contents
    FROM (
      SELECT
        ct.id,
        ct.body,
        ct.position,
        ct.is_valid,
        COALESCE(
          (
            SELECT jsonb_agg(
                     jsonb_build_object(
                       'id',           m.id,
                       'media_type',   m.media_type,
                       'mime_type',    m.mime_type,
                       'storage_path', m.storage_path
                     ) ORDER BY m.created_at, m.id
                   )
              FROM whatsapp_content_media m
             WHERE m.content_id = ct.id
               AND m.instance_id = p_instance_id
          ),
          '[]'::jsonb
        ) AS media
      FROM whatsapp_contents ct
      WHERE ct.instance_id = p_instance_id
        AND ct.id IN (
          SELECT DISTINCT r.assigned_content_id
            FROM whatsapp_dispatch_recipients r
           WHERE r.dispatch_job_id = p_job_id
             AND r.instance_id = p_instance_id
             AND r.assigned_content_id IS NOT NULL
        )
    ) c;

  -- (f) Destinatarios do disparo com o resultado por recipient (Req 20.3).
  --     failure_reason e sempre pt-BR e sem segredos (garantido na escrita).
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',                  r.id,
               'target_kind',         r.target_kind,
               'phone',               r.phone,
               'group_jid',           r.group_jid,
               'recipient_data',      r.recipient_data,
               'assigned_content_id', r.assigned_content_id,
               'seq',                 r.seq,
               'status',              r.status,
               'sent_at',             r.sent_at,
               'failure_reason',      r.failure_reason
             ) ORDER BY r.seq
           ),
           '[]'::jsonb
         )
    INTO v_recipients
    FROM whatsapp_dispatch_recipients r
   WHERE r.dispatch_job_id = p_job_id
     AND r.instance_id = p_instance_id;

  -- (g) Contrato estavel para a UI/servico (detalhe + resultados + duracao).
  RETURN jsonb_build_object(
    'id',                    v_job.id,
    'instance_id',           v_job.instance_id,
    'kind',                  v_job.kind,
    'status',                v_job.status,
    'distribution_mode',     v_job.distribution_mode,
    'block_size',            v_job.block_size,
    'send_interval_sec',     v_job.send_interval_sec,
    'execution_quota',       v_job.execution_quota,
    'total_count',           v_job.total_count,
    'sent_count',            v_sent,
    'failed_count',          v_failed,
    'skipped_count',         v_skipped,
    'pending_count',         v_pending,
    'source_job_id',         v_job.source_job_id,
    'started_at',            v_job.started_at,
    'completed_at',          v_job.completed_at,
    'execution_duration_sec',
      CASE
        WHEN v_job.started_at IS NOT NULL AND v_job.completed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (v_job.completed_at - v_job.started_at))::int
        ELSE NULL
      END,
    'created_at',            v_job.created_at,
    'updated_at',            v_job.updated_at,
    'contents',              v_contents,
    'recipients',            v_recipients
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_campaign_detail(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_campaign_detail(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC 3: whatsapp_duplicate_campaign(p_instance_id, p_job_id, p_mode)
-- ----------------------------------------------------------------------------
-- ESCRITA: cria um NOVO Dispatch_Job copiando Contents (novas linhas + midias),
-- destinatarios e configuracoes da campanha de origem, gravando `source_job_id`
-- (Req 20.4, 20.5, 20.11). O job historico de origem permanece INTACTO. O novo
-- job nasce em DRAFT (DUPLICATE/REUSE) ou QUEUED (RESEND). O AUDIT (Req 20.7,
-- 20.12) e responsabilidade da camada de servico (executeAdminMutation).
CREATE OR REPLACE FUNCTION whatsapp_duplicate_campaign(
  p_instance_id uuid,
  p_job_id      uuid,
  p_mode        text DEFAULT 'DUPLICATE'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_mode        text;
  v_new_status  text;
  v_src         whatsapp_dispatch_jobs%ROWTYPE;
  v_new_job_id  uuid;
  v_created_at  timestamptz;
  v_updated_at  timestamptz;
  v_new_status_ret text;
  v_content_map jsonb := '{}'::jsonb;       -- old_content_id::text -> new_content_id::text
  v_rec         record;
  v_new_content_id uuid;
  v_total       int := 0;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard. Loga
  --     WHATSAPP_VIEW_DENIED e aborta com permission_denied em falha.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Valida o modo (dominio fechado) e define o status do novo job.
  v_mode := COALESCE(p_mode, 'DUPLICATE');
  IF v_mode NOT IN ('DUPLICATE', 'REUSE', 'RESEND') THEN
    RAISE EXCEPTION
      'whatsapp_duplicate_campaign: modo invalido "%": esperado DUPLICATE|REUSE|RESEND', v_mode
      USING ERRCODE = '22023';
  END IF;
  -- RESEND => reprocessamento imediato (QUEUED, Req 20.5); demais => DRAFT.
  v_new_status := CASE WHEN v_mode = 'RESEND' THEN 'QUEUED' ELSE 'DRAFT' END;

  -- (d) Campanha de origem precisa existir E pertencer a MESMA instancia
  --     (Req 20.6). Inexistente/cruzada => WHATSAPP_NOT_FOUND (anti-enumeracao).
  SELECT * INTO v_src
    FROM whatsapp_dispatch_jobs j
   WHERE j.id = p_job_id
     AND j.instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Cria o NOVO Dispatch_Job copiando as configuracoes da origem, com
  --     `source_job_id` = origem (Req 20.4/20.5/20.11). Contadores zerados e
  --     started_at/completed_at/last_send_at nulos (campanha nova, ainda nao
  --     executada). total_count e ajustado apos copiar os recipients.
  INSERT INTO whatsapp_dispatch_jobs (
    instance_id, kind, status, distribution_mode, block_size,
    send_interval_sec, execution_quota, total_count, source_job_id
  )
  VALUES (
    p_instance_id,
    v_src.kind,
    v_new_status::dispatch_status,
    v_src.distribution_mode,
    v_src.block_size,
    v_src.send_interval_sec,
    v_src.execution_quota,
    0,
    p_job_id
  )
  RETURNING id, status, created_at, updated_at
    INTO v_new_job_id, v_new_status_ret, v_created_at, v_updated_at;

  -- (f) Copia os Contents UTILIZADOS pela origem (distintos referenciados pelos
  --     recipients) como NOVAS linhas (ids novos), preservando body/position/
  --     is_valid, e replica as midias. Mantem o mapa old->new para reapontar os
  --     recipients. Copiar (em vez de reutilizar) garante que editar o novo
  --     rascunho nao altere a campanha historica original (Req 20.11).
  FOR v_rec IN
    SELECT DISTINCT c.id AS old_id, c.body, c.position, c.is_valid
      FROM whatsapp_contents c
      JOIN whatsapp_dispatch_recipients r
        ON r.assigned_content_id = c.id
     WHERE r.dispatch_job_id = p_job_id
       AND r.instance_id = p_instance_id
       AND c.instance_id = p_instance_id
     ORDER BY c.position, c.id
  LOOP
    INSERT INTO whatsapp_contents (
      instance_id, dispatch_job_id, body, position, is_valid
    )
    VALUES (
      p_instance_id, v_new_job_id, v_rec.body, v_rec.position, v_rec.is_valid
    )
    RETURNING id INTO v_new_content_id;

    -- Replica as midias do Content de origem para o Content copiado.
    INSERT INTO whatsapp_content_media (
      instance_id, content_id, media_type, storage_path, mime_type
    )
    SELECT p_instance_id, v_new_content_id, m.media_type, m.storage_path, m.mime_type
      FROM whatsapp_content_media m
     WHERE m.content_id = v_rec.old_id
       AND m.instance_id = p_instance_id;

    v_content_map := v_content_map
      || jsonb_build_object(v_rec.old_id::text, v_new_content_id::text);
  END LOOP;

  -- (g) Copia os destinatarios da origem para o novo job, reapontando o
  --     assigned_content_id para o Content copiado (via mapa), reiniciando o
  --     status para PENDING e zerando o resultado (sent_at/failure_reason/
  --     provider_message_id). Preserva `seq` (ordem deterministica) e o
  --     `recipient_data` em snapshot.
  INSERT INTO whatsapp_dispatch_recipients (
    instance_id, dispatch_job_id, target_kind, phone, group_jid,
    recipient_data, assigned_content_id, seq, status
  )
  SELECT
    p_instance_id,
    v_new_job_id,
    r.target_kind,
    r.phone,
    r.group_jid,
    r.recipient_data,
    CASE
      WHEN r.assigned_content_id IS NULL THEN NULL
      ELSE (v_content_map ->> r.assigned_content_id::text)::uuid
    END,
    r.seq,
    'PENDING'
  FROM whatsapp_dispatch_recipients r
  WHERE r.dispatch_job_id = p_job_id
    AND r.instance_id = p_instance_id;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  -- (h) total_count = numero de recipients copiados.
  UPDATE whatsapp_dispatch_jobs
     SET total_count = v_total
   WHERE id = v_new_job_id
     AND instance_id = p_instance_id;

  -- (i) GROUP: replica o registro de grupos-alvo (group_jids) para o novo job.
  IF v_src.kind = 'GROUP' THEN
    INSERT INTO whatsapp_group_dispatches (instance_id, dispatch_job_id, group_jids)
    SELECT p_instance_id, v_new_job_id, gd.group_jids
      FROM whatsapp_group_dispatches gd
     WHERE gd.dispatch_job_id = p_job_id
       AND gd.instance_id = p_instance_id;
  END IF;

  -- (j) Retorna o novo job (forma consumida pela camada TS, task 11.4), incluindo
  --     `source_job_id` e `mode` para o audit (Req 20.7, 20.12).
  RETURN jsonb_build_object(
    'id',                v_new_job_id,
    'instance_id',       p_instance_id,
    'kind',              v_src.kind,
    'status',            v_new_status_ret,
    'distribution_mode', v_src.distribution_mode,
    'block_size',        v_src.block_size,
    'send_interval_sec', v_src.send_interval_sec,
    'execution_quota',   v_src.execution_quota,
    'total_count',       v_total,
    'source_job_id',     p_job_id,
    'mode',              v_mode,
    'created_at',        v_created_at,
    'updated_at',        v_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_duplicate_campaign(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_duplicate_campaign(uuid, uuid, text) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e um job dela em estado terminal/execucao:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT id, status FROM whatsapp_dispatch_jobs
--     WHERE instance_id = '<inst>'
--       AND status IN ('COMPLETED','CANCELLED','FAILED','RUNNING','PAUSED')
--     ORDER BY created_at DESC LIMIT 1;

-- 1) Listar o Campaign_History (jobs executados, com Execution_Duration):
SELECT jsonb_pretty(whatsapp_list_campaign_history('<inst>'));

-- 2) Filtrar por status terminal:
SELECT jsonb_pretty(whatsapp_list_campaign_history('<inst>', 'COMPLETED', 50, 0));

-- 3) Detalhe escopado de um item (contents + recipients + duracao):
SELECT jsonb_pretty(whatsapp_get_campaign_detail('<inst>', '<job_id>'));

-- 4) Detalhe de job inexistente/cruzado => WHATSAPP_NOT_FOUND (P0001):
SELECT whatsapp_get_campaign_detail('<inst>', '00000000-0000-0000-0000-000000000000');

-- 5) Duplicar (novo DRAFT, source_job_id gravado):
SELECT jsonb_pretty(whatsapp_duplicate_campaign('<inst>', '<job_id>', 'DUPLICATE'));
--   Confira: SELECT id, status, source_job_id, total_count FROM whatsapp_dispatch_jobs
--              WHERE source_job_id = '<job_id>' ORDER BY created_at DESC;

-- 6) Reenviar (novo QUEUED, original intacto):
SELECT jsonb_pretty(whatsapp_duplicate_campaign('<inst>', '<job_id>', 'RESEND'));

-- 7) Reutilizar/editar como nova (novo DRAFT):
SELECT jsonb_pretty(whatsapp_duplicate_campaign('<inst>', '<job_id>', 'REUSE'));

-- 8) Modo invalido => 22023:
SELECT whatsapp_duplicate_campaign('<inst>', '<job_id>', 'FOO');

-- 9) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
