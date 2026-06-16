-- ============================================================================
-- Migration 106 — whatsapp_update_draft (task 11.3)
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que EDITA um Draft (Dispatch_Job no status `DRAFT`),
-- escopada por `instance_id` da Active_Instance, com versionamento otimista
-- (`expected_updated_at`/`STALE_VERSION`). E a contraparte server-side da edicao
-- de rascunhos do Bulk/Group Dispatch (Req 21.3, 21.4).
--
-- Drafts reusam o motor de disparo existente, sem RPCs duplicadas:
--   * SALVAR como Draft  -> whatsapp_create_dispatch_job(..., p_status='DRAFT')
--     (migration 099): persiste o job em `DRAFT` SEM habilitar o Job_Worker
--     (o worker so reclama jobs `QUEUED`/`RUNNING`), atendendo Req 21.1.
--   * INICIAR um Draft   -> whatsapp_transition_dispatch(..., 'START')
--     (migration 101): acao START aplica DRAFT -> QUEUED, revalidando o estado
--     no backend e habilitando o worker (Req 21.5). Bloqueios canonicos de lista
--     vazia / conteudo invalido sao aplicados ANTES, na criacao/edicao, de modo
--     que um Draft so existe quando ja revalidado (Req 21.6).
--   * EDITAR um Draft    -> whatsapp_update_draft (ESTA migration).
--
--   whatsapp_update_draft(
--     p_instance_id, p_job_id, p_distribution_mode, p_block_size,
--     p_send_interval_sec, p_execution_quota, p_list_id, p_group_jids,
--     p_content_ids, p_expected_updated_at)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8): instancia
--       inexistente/cruzada => WHATSAPP_NOT_FOUND.
--     - Edicao SO permitida em status `DRAFT` (Req 21.3). Job em outro estado
--       (ja iniciado/terminal) => INVALID_STATE_TRANSITION (P0001).
--     - REVALIDA no backend (defesa em profundidade, identico a 099):
--         * send_interval_sec > 0  senao WHATSAPP_INVALID_SEND_INTERVAL
--         * execution_quota >= 1   senao WHATSAPP_INVALID_EXECUTION_QUOTA
--         * >= 1 Content valido (texto OU >=1 midia) senao WHATSAPP_NO_VALID_CONTENT
--         * BULK: lista com >= 1 contato valido senao WHATSAPP_EMPTY_CONTACT_LIST
--         * GROUP: >= 1 grupo selecionado senao WHATSAPP_NO_GROUPS_SELECTED
--       Contents/Contatos/Lista validados como pertencentes a MESMA instancia
--       (entidade-filho validada pelo pai; cruzada => WHATSAPP_NOT_FOUND).
--     - Versionamento otimista (Req 21.4): a UPDATE filtra por
--       `status = 'DRAFT' AND updated_at = p_expected_updated_at`. ROW_COUNT = 0
--       => re-SELECT distingue NOT_FOUND (sumiu), INVALID_STATE_TRANSITION (saiu
--       de DRAFT concorrentemente) e STALE_VERSION (versao desatualizada).
--     - RE-MATERIALIZA os Dispatch_Recipients (apaga os antigos e regenera com
--       `seq` deterministico, `assigned_content_id` pela formula de
--       Distribution_Mode e `recipient_data` em snapshot) — espelho exato da
--       materializacao da 099, pois conteudos/lista/modo podem ter mudado.
--     - Retorna o job editado (id, status='DRAFT', total_count, updated_at, ...)
--       no mesmo shape consumido pela camada TS (drafts.ts::updateDraft).
--
-- O AUDIT positivo da edicao (Req 21.7) e gravado pela camada TS
-- (drafts.ts::updateDraft via executeAdminMutation, audit-by-construction,
-- admin-patterns #1), coerente com as RPCs 099/101 que tambem delegam o audit
-- de mutacao real ao wrapper TS (sempre incluindo o `instance_id`).
--
-- Markers de erro (ERRCODE P0001) — a camada TS os mapeia para Canonical_Messages
-- pt-BR (intervalo/quota/conteudo/lista/grupo) ou propaga como codigo ingles
-- (STALE_VERSION, INVALID_STATE_TRANSITION) / Canonical anti-enum (WHATSAPP_NOT_FOUND).
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs
-- (093..105) para evitar conflitos de edicao. Numero 106 reservado para esta
-- onda. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_dispatch_jobs              (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients        (SECTION 6 da 092)
--   - tabela public.whatsapp_group_dispatches           (SECTION 7 da 092)
--   - tabela public.whatsapp_contents / whatsapp_contacts (SECTION 5 da 092)
--   - dominios dispatch_kind/dispatch_status/distribution_mode (SECTION 2 da 092)
--   - trigger trg_whatsapp_dispatch_jobs_touch (touch de updated_at) (SECTION 6)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- ('SETTINGS_EDIT') no topo do corpo (camada 2 do RBAC, com log negativo
-- WHATSAPP_VIEW_DENIED em falha); anti-enumeracao via whatsapp_assert_instance;
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta a anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_contacts'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_contacts ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_update_draft(...)
-- ----------------------------------------------------------------------------
-- Edita um Draft (status DRAFT) com versionamento otimista e re-materializa os
-- recipients. Parametros tipados pelos dominios fechados da 092. A revalidacao
-- e a materializacao espelham EXATAMENTE whatsapp_create_dispatch_job (099).
CREATE OR REPLACE FUNCTION whatsapp_update_draft(
  p_instance_id         uuid,
  p_distribution_mode   distribution_mode,
  p_block_size          int,
  p_send_interval_sec   int,
  p_execution_quota     int,
  p_list_id             uuid,
  p_group_jids          text[],
  p_content_ids         uuid[],
  p_job_id              uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_kind             text;          -- kind do job (preservado: BULK|GROUP)
  v_current_status   text;          -- status atual do job (pre-fetch)
  v_requested_ids    uuid[];        -- content ids distintos solicitados
  v_requested_count  int;
  v_owned_count      int;           -- quantos dos solicitados pertencem a instancia
  v_content_ids      uuid[];        -- content ids VALIDOS, ordenados por position
  v_content_count    int;           -- M (>= 1 apos validacao)
  v_mode             text;          -- modo efetivo da formula (GROUP usa INTERLEAVED)
  v_block_size       int;           -- tamanho de bloco efetivo (>= 1)
  v_group_jids       text[];        -- grupos saneados/deduplicados (GROUP)
  v_persist_mode     distribution_mode;  -- distribution_mode persistido no job
  v_rows             int;
  v_total            int := 0;
  v_updated_at       timestamptz;
  v_still_exists     boolean;
  v_recheck_status   text;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard. Loga
  --     WHATSAPP_VIEW_DENIED e aborta com permission_denied em falha.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Pre-fetch do job, escopado por instancia (entidade-filho validada contra
  --     o instance_id). Job inexistente OU de outra instancia => anti-enumeracao.
  SELECT status::text, kind::text
    INTO v_current_status, v_kind
    FROM whatsapp_dispatch_jobs
   WHERE id = p_job_id
     AND instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Edicao SO permitida em DRAFT (Req 21.3). Job ja iniciado/terminal nao e
  --     editavel => INVALID_STATE_TRANSITION (a camada TS propaga o codigo).
  IF v_current_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Revalidacao de Send_Interval (Req 8.2): > 0.
  IF p_send_interval_sec IS NULL OR p_send_interval_sec <= 0 THEN
    RAISE EXCEPTION 'WHATSAPP_INVALID_SEND_INTERVAL' USING ERRCODE = 'P0001';
  END IF;

  -- (f) Revalidacao de Execution_Quota (Req 8.4): >= 1.
  IF p_execution_quota IS NULL OR p_execution_quota < 1 THEN
    RAISE EXCEPTION 'WHATSAPP_INVALID_EXECUTION_QUOTA' USING ERRCODE = 'P0001';
  END IF;

  -- (g) Distribution_Mode efetivo + persistido (espelha 099):
  --     BULK exige BLOCK|INTERLEAVED; GROUP persiste NULL mas usa INTERLEAVED
  --     internamente (exatamente 1 content por grupo).
  IF v_kind = 'BULK' THEN
    IF p_distribution_mode IS NULL OR p_distribution_mode NOT IN ('BLOCK', 'INTERLEAVED') THEN
      RAISE EXCEPTION
        'whatsapp_update_draft: distribution_mode obrigatorio (BLOCK|INTERLEAVED) para BULK'
        USING ERRCODE = '22023';
    END IF;
    v_mode         := p_distribution_mode;
    v_persist_mode := p_distribution_mode;
  ELSE
    v_mode         := 'INTERLEAVED';  -- formula interna para GROUP
    v_persist_mode := NULL;           -- distribution_mode NULL para GROUP
  END IF;

  -- Tamanho de bloco efetivo (>= 1): evita divisao por zero quando BLOCK.
  v_block_size := GREATEST(COALESCE(p_block_size, 1), 1);

  -- (h) Contents: precisa de >= 1 id; todos devem pertencer a instancia
  --     (cruzado/inexistente => anti-enum); >= 1 deve ser VALIDO (Req 6.5).
  IF p_content_ids IS NULL OR array_length(p_content_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'WHATSAPP_NO_VALID_CONTENT' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT cid) INTO v_requested_ids
    FROM unnest(p_content_ids) AS cid;
  v_requested_count := array_length(v_requested_ids, 1);

  SELECT count(*) INTO v_owned_count
    FROM whatsapp_contents c
   WHERE c.id = ANY (v_requested_ids)
     AND c.instance_id = p_instance_id;

  IF v_owned_count <> v_requested_count THEN
    -- Algum Content nao existe ou e de outra instancia => anti-enumeracao.
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Contents VALIDOS (texto nao vazio OU >=1 midia), ordenados por position
  -- (a "ordem registrada dos Contents" usada pela distribuicao, Req 7.3).
  SELECT array_agg(c.id ORDER BY c.position, c.created_at, c.id)
    INTO v_content_ids
    FROM whatsapp_contents c
   WHERE c.id = ANY (v_requested_ids)
     AND c.instance_id = p_instance_id
     AND (
       (c.body IS NOT NULL AND length(btrim(c.body)) > 0)
       OR EXISTS (
         SELECT 1 FROM whatsapp_content_media m
          WHERE m.content_id = c.id
            AND m.instance_id = p_instance_id
       )
     );

  v_content_count := COALESCE(array_length(v_content_ids, 1), 0);
  IF v_content_count = 0 THEN
    RAISE EXCEPTION 'WHATSAPP_NO_VALID_CONTENT' USING ERRCODE = 'P0001';
  END IF;

  -- (i) Pre-validacao de destinatarios por tipo de disparo (Req 5.7 / 12.7).
  IF v_kind = 'BULK' THEN
    IF p_list_id IS NULL THEN
      RAISE EXCEPTION 'WHATSAPP_EMPTY_CONTACT_LIST' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM whatsapp_contact_lists cl
       WHERE cl.id = p_list_id
         AND cl.instance_id = p_instance_id
    ) THEN
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT array_agg(DISTINCT j) INTO v_group_jids
      FROM (
        SELECT btrim(g) AS j
          FROM unnest(COALESCE(p_group_jids, ARRAY[]::text[])) AS g
         WHERE btrim(g) <> ''
      ) s;

    IF v_group_jids IS NULL OR array_length(v_group_jids, 1) IS NULL THEN
      RAISE EXCEPTION 'WHATSAPP_NO_GROUPS_SELECTED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (j) UPDATE com VERSIONAMENTO OTIMISTA (Req 21.4) + guarda de estado DRAFT
  --     (Req 21.3). O trigger trg_whatsapp_dispatch_jobs_touch atualiza
  --     updated_at apos o match do WHERE (que usa o updated_at ANTIGO do cliente).
  --     GROUP grava distribution_mode/block_size = NULL/NULL.
  UPDATE whatsapp_dispatch_jobs
     SET distribution_mode = v_persist_mode,
         block_size        = CASE WHEN v_kind = 'BULK' AND v_mode = 'BLOCK'
                                  THEN v_block_size ELSE NULL END,
         send_interval_sec = p_send_interval_sec,
         execution_quota   = p_execution_quota
   WHERE id = p_job_id
     AND instance_id = p_instance_id
     AND status = 'DRAFT'
     AND updated_at = p_expected_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- (k) ROW_COUNT = 0: o pre-fetch (c) encontrou a linha em DRAFT, logo o
  --     nao-match aqui e por (1) delecao concorrente, (2) saida concorrente de
  --     DRAFT (ja iniciado) ou (3) versao desatualizada. Distingue via re-SELECT.
  IF v_rows = 0 THEN
    SELECT status::text
      INTO v_recheck_status
      FROM whatsapp_dispatch_jobs
     WHERE id = p_job_id AND instance_id = p_instance_id;

    v_still_exists := FOUND;

    IF NOT v_still_exists THEN
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    ELSIF v_recheck_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (l) RE-MATERIALIZA os recipients: apaga os antigos do job e regenera com a
  --     nova lista/conteudos/modo (conteudos/lista/modo podem ter mudado). A
  --     formula espelha assignContents / a materializacao da 099.
  DELETE FROM whatsapp_dispatch_recipients
   WHERE dispatch_job_id = p_job_id
     AND instance_id = p_instance_id;

  IF v_kind = 'BULK' THEN
    INSERT INTO whatsapp_dispatch_recipients (
      instance_id, dispatch_job_id, target_kind, phone, group_jid,
      recipient_data, assigned_content_id, seq, status
    )
    SELECT
      p_instance_id,
      p_job_id,
      'CONTACT',
      o.phone,
      NULL,
      o.recipient_data,                         -- snapshot do Recipient_Data
      v_content_ids[
        CASE WHEN v_mode = 'BLOCK'
             THEN ((floor(o.idx::numeric / v_block_size))::int % v_content_count)
             ELSE (o.idx % v_content_count)
        END + 1
      ],
      o.idx,
      'PENDING'
    FROM (
      SELECT
        ct.phone,
        ct.recipient_data,
        (row_number() OVER (ORDER BY ct.created_at, ct.id) - 1)::int AS idx
      FROM whatsapp_contacts ct
      WHERE ct.list_id = p_list_id
        AND ct.instance_id = p_instance_id
    ) o;
  ELSE
    INSERT INTO whatsapp_dispatch_recipients (
      instance_id, dispatch_job_id, target_kind, phone, group_jid,
      recipient_data, assigned_content_id, seq, status
    )
    SELECT
      p_instance_id,
      p_job_id,
      'GROUP',
      NULL,
      o.jid,
      '{}'::jsonb,
      v_content_ids[
        CASE WHEN v_mode = 'BLOCK'
             THEN ((floor(o.idx::numeric / v_block_size))::int % v_content_count)
             ELSE (o.idx % v_content_count)
        END + 1
      ],
      o.idx,
      'PENDING'
    FROM (
      SELECT
        g.jid,
        (g.ord - 1)::int AS idx
      FROM unnest(v_group_jids) WITH ORDINALITY AS g(jid, ord)
    ) o;
  END IF;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  -- (m) Guarda final: nenhum recipient gerado => bloqueia (rollback da edicao).
  --     BULK e a lista valida vazia (Req 5.7); GROUP ja foi barrado em (i).
  IF v_total = 0 THEN
    IF v_kind = 'BULK' THEN
      RAISE EXCEPTION 'WHATSAPP_EMPTY_CONTACT_LIST' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'WHATSAPP_NO_GROUPS_SELECTED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (n) total_count = numero de recipients materializados. Captura a versao
  --     otimista final (updated_at) para a proxima chamada do cliente.
  UPDATE whatsapp_dispatch_jobs
     SET total_count = v_total
   WHERE id = p_job_id
     AND instance_id = p_instance_id
  RETURNING updated_at INTO v_updated_at;

  -- (o) GROUP: atualiza os JIDs alvo do disparo (espelha o INSERT da 099). Como
  --     nao ha unique em (dispatch_job_id), substitui deletando + inserindo.
  IF v_kind = 'GROUP' THEN
    DELETE FROM whatsapp_group_dispatches
     WHERE dispatch_job_id = p_job_id
       AND instance_id = p_instance_id;

    INSERT INTO whatsapp_group_dispatches (instance_id, dispatch_job_id, group_jids)
    VALUES (p_instance_id, p_job_id, v_group_jids);
  END IF;

  -- (p) Retorna o job editado (mantem status DRAFT, Req 21.3). Mesmo shape da 099.
  RETURN jsonb_build_object(
    'id',                p_job_id,
    'instance_id',       p_instance_id,
    'kind',              v_kind,
    'status',            'DRAFT',
    'distribution_mode', v_persist_mode,
    'block_size',        CASE WHEN v_kind = 'BULK' AND v_mode = 'BLOCK' THEN v_block_size ELSE NULL END,
    'send_interval_sec', p_send_interval_sec,
    'execution_quota',   p_execution_quota,
    'total_count',       v_total,
    'updated_at',        v_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_update_draft(
  uuid, distribution_mode, int, int, int, uuid, text[], uuid[], uuid, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_update_draft(
  uuid, distribution_mode, int, int, int, uuid, text[], uuid[], uuid, timestamptz
) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e crie um Draft BULK (via 099):
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT (whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,100,
--             '<list_id>',NULL,ARRAY['<content_a>','<content_b>']::uuid[],'DRAFT'))->>'id' AS job_id;
--   SELECT id, status, updated_at FROM whatsapp_dispatch_jobs WHERE id='<job>';

-- 1) Editar o Draft (troca para BLOCK/2, interval 45, quota 50). Use o updated_at lido:
SELECT jsonb_pretty(whatsapp_update_draft(
  '<inst>','BLOCK',2,45,50,'<list_id>',NULL,
  ARRAY['<content_a>','<content_b>']::uuid[],'<job>','<updated_at>'));
-- => { status:'DRAFT', distribution_mode:'BLOCK', block_size:2, total_count:<n>, updated_at:<novo> }
-- Verifique seq/assigned_content_id re-materializados:
--   SELECT seq, phone, assigned_content_id FROM whatsapp_dispatch_recipients
--    WHERE dispatch_job_id='<job>' ORDER BY seq;

-- 2) Editar com versao antiga => STALE_VERSION (P0001):
SELECT whatsapp_update_draft('<inst>','INTERLEAVED',NULL,30,100,'<list_id>',NULL,
  ARRAY['<content_a>']::uuid[],'<job>','2000-01-01T00:00:00Z');

-- 3) Intervalo/quota invalidos => WHATSAPP_INVALID_SEND_INTERVAL / _EXECUTION_QUOTA:
SELECT whatsapp_update_draft('<inst>','INTERLEAVED',NULL,0,1,'<list_id>',NULL,
  ARRAY['<content_a>']::uuid[],'<job>','<novo_updated_at>');

-- 4) Sem content valido => WHATSAPP_NO_VALID_CONTENT (P0001):
SELECT whatsapp_update_draft('<inst>','INTERLEAVED',NULL,30,1,'<list_id>',NULL,
  ARRAY[]::uuid[],'<job>','<novo_updated_at>');

-- 5) Iniciar o Draft (DRAFT -> QUEUED) via 101, depois tentar editar => INVALID_STATE_TRANSITION:
SELECT whatsapp_transition_dispatch('<inst>','<job>','START','<novo_updated_at>');
SELECT whatsapp_update_draft('<inst>','INTERLEAVED',NULL,30,1,'<list_id>',NULL,
  ARRAY['<content_a>']::uuid[],'<job>','<updated_at_apos_start>');  -- INVALID_STATE_TRANSITION

-- 6) Instancia/job inexistente ou cruzado => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_update_draft('00000000-0000-0000-0000-000000000000','INTERLEAVED',NULL,30,1,
  '<list_id>',NULL,ARRAY['<content_a>']::uuid[],'<job>',now());

-- 7) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action='WHATSAPP_VIEW_DENIED' ORDER BY created_at DESC LIMIT 1;
*/
