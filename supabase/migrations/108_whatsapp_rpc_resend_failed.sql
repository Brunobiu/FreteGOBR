-- ============================================================================
-- Migration 108 — whatsapp_resend_failed (task 11.5)
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que implementa o "Reenviar apenas os que falharam"
-- (Failed_Resend, Req 23.3-23.7), escopado por `instance_id` da Active_Instance.
-- A partir de um Dispatch_Job de ORIGEM, cria um NOVO Dispatch_Job contendo
-- SOMENTE os Dispatch_Recipients que estavam com status `FAILED` na origem,
-- transicionando-o para `QUEUED`. Os destinatarios que estavam `SENT` na origem
-- NAO sao copiados — preservando a idempotencia por destinatario (Req 23.4):
-- quem ja recebeu nunca e reenviado.
--
--   whatsapp_resend_failed(p_instance_id, p_job_id)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC, log negativo em falha).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8): instancia
--       inexistente/desabilitada/cruzada => WHATSAPP_NOT_FOUND.
--     - Job de origem inexistente OU de outra instancia (cruzado) =>
--       WHATSAPP_NOT_FOUND (indistinguivel de "sem acesso", Req 23.7).
--     - SEM nenhum recipient `FAILED` na origem (Req 23.5): NAO cria novo job,
--       grava o audit `WHATSAPP_DISPATCH_RESEND_SKIPPED` DENTRO desta RPC
--       (admin-patterns #4: idempotencia _SKIPPED nao usa executeAdminMutation,
--       pois nao ha mutacao real) e retorna
--       { skipped: true, reason: 'NO_FAILED_RECIPIENTS' }.
--     - COM recipients `FAILED`: cria o Failed_Resend gravando `source_job_id`
--       (Req 23.3), copia para ele SOMENTE os `FAILED` da origem (status
--       PENDING, novo `seq` 0-based, preservando target/phone/group_jid/
--       recipient_data/assigned_content_id em snapshot), define status `QUEUED`
--       e total_count = quantidade copiada. Retorna o job criado + o
--       `failed_count` reenfileirado para o audit POSITIVO do TS (Req 23.6).
--
-- O AUDIT POSITIVO da criacao (Req 23.6) e gravado pela camada TS
-- (dispatch.ts::resendFailed via executeAdminMutation, task 11.5), incluindo o
-- `instance_id`, o `source_job_id` (origem) e a quantidade de destinatarios
-- reenfileirados — coerente com admin-patterns #1 (mutacao real =>
-- audit-by-construction no wrapper TS) e com a 099 (whatsapp_create_dispatch_job
-- tambem delega o audit positivo ao TS). Apenas o caminho _SKIPPED audita por
-- dentro (admin-patterns #4).
--
-- Markers de erro (ERRCODE P0001) — a camada TS (task 11.5) os mapeia:
--   * WHATSAPP_NOT_FOUND -> Canonical_Message anti-enumeracao
--                           `Nao foi possivel concluir a operacao.`
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs para
-- evitar conflitos de edicao. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_dispatch_jobs              (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients        (SECTION 6 da 092)
--   - tabela public.whatsapp_group_dispatches           (SECTION 6 da 092)
--   - dominios dispatch_status / recipient_status       (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- ('SETTINGS_EDIT') no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em
-- falha); anti-enumeracao via whatsapp_assert_instance; REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO authenticated. Nunca exposta ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 23.3, 23.4, 23.5, 23.6, 23.7_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_group_dispatches'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_group_dispatches ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_resend_failed(...)
-- ----------------------------------------------------------------------------
-- Recebe a instancia (Active_Instance) e o Dispatch_Job de ORIGEM. Cria um novo
-- Failed_Resend QUEUED so com os FAILED da origem, ou retorna skip se nao houver
-- nenhum FAILED.
CREATE OR REPLACE FUNCTION whatsapp_resend_failed(
  p_instance_id uuid,
  p_job_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller          uuid;
  v_src_kind        text;          -- kind do job de origem
  v_src_dist_mode   distribution_mode;
  v_src_block_size  int;
  v_src_interval    int;
  v_src_quota       int;
  v_failed_count    int;           -- quantos recipients FAILED a origem possui
  v_new_job_id      uuid;
  v_created_at      timestamptz;
  v_updated_at      timestamptz;
  v_total           int := 0;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard. Loga
  --     WHATSAPP_VIEW_DENIED e aborta com permission_denied em falha.
  v_caller := whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao de instancia: inexistente/desabilitada/cruzada =>
  --     WHATSAPP_NOT_FOUND (Req 2.8). Mapeado para Canonical_Message no TS.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Pre-fetch do job de ORIGEM, escopado por instancia (entidade-filho
  --     validada contra o instance_id). Job inexistente OU de outra instancia
  --     => anti-enumeracao (indistinguivel de "sem acesso", Req 23.7).
  SELECT kind::text, distribution_mode, block_size, send_interval_sec, execution_quota
    INTO v_src_kind, v_src_dist_mode, v_src_block_size, v_src_interval, v_src_quota
    FROM whatsapp_dispatch_jobs
   WHERE id = p_job_id
     AND instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Conta os Dispatch_Recipients FAILED da origem (escopados por instancia).
  SELECT count(*)
    INTO v_failed_count
    FROM whatsapp_dispatch_recipients r
   WHERE r.dispatch_job_id = p_job_id
     AND r.instance_id = p_instance_id
     AND r.status = 'FAILED';

  -- (e) IDEMPOTENCIA / sem nada a reenviar (Req 23.5): nenhum FAILED na origem.
  --     NAO cria novo job; grava o audit `WHATSAPP_DISPATCH_RESEND_SKIPPED`
  --     DENTRO desta RPC (admin-patterns #4: skip nao usa executeAdminMutation)
  --     e retorna { skipped: true, reason: 'NO_FAILED_RECIPIENTS' }.
  IF v_failed_count = 0 THEN
    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    )
    VALUES (
      v_caller,
      'WHATSAPP_DISPATCH_RESEND_SKIPPED',
      'whatsapp_dispatch_jobs',
      p_job_id,
      jsonb_build_object('instance_id', p_instance_id, 'source_job_id', p_job_id),
      jsonb_build_object(
        'instance_id',   p_instance_id,
        'source_job_id', p_job_id,
        'reason',        'NO_FAILED_RECIPIENTS',
        'failed_count',  0
      )
    );

    RETURN jsonb_build_object('skipped', true, 'reason', 'NO_FAILED_RECIPIENTS');
  END IF;

  -- (f) Cria o Failed_Resend QUEUED gravando `source_job_id` (Req 23.3). Espelha
  --     as configuracoes do job de origem (kind/distribuicao/intervalo/quota).
  --     total_count e ajustado apos copiar os recipients.
  INSERT INTO whatsapp_dispatch_jobs (
    instance_id, kind, status, distribution_mode, block_size,
    send_interval_sec, execution_quota, total_count, source_job_id
  )
  VALUES (
    p_instance_id,
    v_src_kind::dispatch_kind,
    'QUEUED'::dispatch_status,
    v_src_dist_mode,
    v_src_block_size,
    v_src_interval,
    v_src_quota,
    0,
    p_job_id
  )
  RETURNING id, created_at, updated_at
    INTO v_new_job_id, v_created_at, v_updated_at;

  -- (g) Copia SOMENTE os recipients FAILED da origem (Req 23.3, 23.4). Os SENT
  --     (e quaisquer outros estados) NAO sao copiados: quem ja recebeu nunca e
  --     reenviado (idempotencia por destinatario). Cada copia recebe:
  --       * status PENDING (elegivel para o Job_Worker);
  --       * novo `seq` 0-based deterministico (ordenado pelo seq de origem),
  --         satisfazendo UNIQUE(dispatch_job_id, seq);
  --       * snapshot preservado de target_kind/phone/group_jid/recipient_data e
  --         o mesmo assigned_content_id da origem;
  --       * failure_reason/sent_at/provider_message_id limpos.
  INSERT INTO whatsapp_dispatch_recipients (
    instance_id, dispatch_job_id, target_kind, phone, group_jid,
    recipient_data, assigned_content_id, seq, status
  )
  SELECT
    p_instance_id,
    v_new_job_id,
    o.target_kind,
    o.phone,
    o.group_jid,
    o.recipient_data,
    o.assigned_content_id,
    o.idx,
    'PENDING'
  FROM (
    SELECT
      r.target_kind,
      r.phone,
      r.group_jid,
      r.recipient_data,
      r.assigned_content_id,
      (row_number() OVER (ORDER BY r.seq, r.id) - 1)::int AS idx
    FROM whatsapp_dispatch_recipients r
    WHERE r.dispatch_job_id = p_job_id
      AND r.instance_id = p_instance_id
      AND r.status = 'FAILED'
  ) o;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  -- (h) total_count = numero de recipients copiados (== v_failed_count).
  UPDATE whatsapp_dispatch_jobs
     SET total_count = v_total
   WHERE id = v_new_job_id
     AND instance_id = p_instance_id;

  -- (i) GROUP: registra os JIDs alvo do Failed_Resend (Req 12.2), mantendo a
  --     coerencia estrutural com a criacao normal (099). Usa os JIDs distintos
  --     dos recipients copiados.
  IF v_src_kind = 'GROUP' THEN
    INSERT INTO whatsapp_group_dispatches (instance_id, dispatch_job_id, group_jids)
    SELECT
      p_instance_id,
      v_new_job_id,
      array_agg(DISTINCT g.group_jid)
    FROM whatsapp_dispatch_recipients g
    WHERE g.dispatch_job_id = v_new_job_id
      AND g.instance_id = p_instance_id
      AND g.group_jid IS NOT NULL;
  END IF;

  -- (j) Retorna o Failed_Resend criado (forma consumida pela camada TS, task
  --     11.5). `source_job_id` e `failed_count` alimentam o audit POSITIVO via
  --     executeAdminMutation (Req 23.6).
  RETURN jsonb_build_object(
    'id',                v_new_job_id,
    'instance_id',       p_instance_id,
    'kind',              v_src_kind,
    'status',            'QUEUED',
    'distribution_mode', v_src_dist_mode,
    'block_size',        v_src_block_size,
    'send_interval_sec', v_src_interval,
    'execution_quota',   v_src_quota,
    'total_count',       v_total,
    'source_job_id',     p_job_id,
    'failed_count',      v_total,
    'created_at',        v_created_at,
    'updated_at',        v_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_resend_failed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_resend_failed(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e crie um job BULK com alguns recipients:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT (whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,100,
--             '<list_id>',NULL,ARRAY['<content_a>']::uuid[]))->>'id' AS job_id;

-- 0) Simule resultado do disparo: marque alguns SENT e alguns FAILED:
--   UPDATE whatsapp_dispatch_recipients SET status='SENT'
--    WHERE dispatch_job_id='<job>' AND seq IN (0,1);
--   UPDATE whatsapp_dispatch_recipients SET status='FAILED',
--          failure_reason='Numero invalido'
--    WHERE dispatch_job_id='<job>' AND seq IN (2);

-- 1) Reenviar so os que falharam: cria novo job QUEUED com source_job_id e os
--    FAILED como PENDING (seq re-iniciado em 0); SENT NAO sao copiados:
SELECT jsonb_pretty(whatsapp_resend_failed('<inst>','<job>'));
-- => { id:<novo>, status:'QUEUED', source_job_id:'<job>', failed_count:1, total_count:1, ... }
--   SELECT seq, status, phone, failure_reason
--     FROM whatsapp_dispatch_recipients WHERE dispatch_job_id='<novo>' ORDER BY seq;
--   -- todos PENDING, failure_reason NULL, contagem == FAILED da origem.

-- 2) Reenviar de novo um job que (agora) nao tem FAILED => skip + audit _SKIPPED:
--   (use um job sem nenhum FAILED)
SELECT jsonb_pretty(whatsapp_resend_failed('<inst>','<job_sem_failed>'));
-- => { skipped:true, reason:'NO_FAILED_RECIPIENTS' }
SELECT action, before_data, after_data FROM admin_audit_logs
 WHERE action='WHATSAPP_DISPATCH_RESEND_SKIPPED' ORDER BY created_at DESC LIMIT 1;

-- 3) Job inexistente ou cruzado (outra instancia) => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_resend_failed('<inst>','00000000-0000-0000-0000-000000000000');

-- 4) Instancia inexistente/desabilitada => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_resend_failed('00000000-0000-0000-0000-000000000000','<job>');

-- 5) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action='WHATSAPP_VIEW_DENIED' ORDER BY created_at DESC LIMIT 1;
*/
