-- ============================================================================
-- Migration 099 — whatsapp_create_dispatch_job (task 10.1)
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que CRIA um Dispatch_Job e MATERIALIZA seus
-- Dispatch_Recipients de forma duravel, escopado por `instance_id` da
-- Active_Instance. E a porta de entrada do motor de disparo: persiste o job e,
-- ANTES do inicio do processamento, gera cada Dispatch_Recipient com:
--   * `seq` deterministico (ordem estavel de processamento);
--   * `assigned_content_id` calculado pela formula de Distribution_Mode
--     (espelha `assignContents` da camada pura, distribution.ts):
--       - INTERLEAVED: contents[i mod M]              (rodizio)
--       - BLOCK:       contents[floor(i/blockSize) mod M]
--     onde M = quantidade de Contents VALIDOS e i = indice 0-based do recipient;
--   * `recipient_data` em SNAPSHOT (copiado no momento da criacao, para que a
--     Rendered_Message use os dados congelados no instante do disparo).
-- `total_count` recebe a contagem de recipients gerados.
--
--   whatsapp_create_dispatch_job(
--     p_instance_id, p_kind, p_distribution_mode, p_block_size,
--     p_send_interval_sec, p_execution_quota, p_list_id, p_group_jids,
--     p_content_ids, p_status)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8): instancia
--       inexistente/cruzada => WHATSAPP_NOT_FOUND.
--     - REVALIDA no backend (Req 8.8, 5.6, 6.6) — defesa em profundidade,
--       independentemente do frontend:
--         * send_interval_sec > 0  senao WHATSAPP_INVALID_SEND_INTERVAL
--             => Canonical_Message `Informe um intervalo valido.`
--         * execution_quota >= 1   senao WHATSAPP_INVALID_EXECUTION_QUOTA
--             => Canonical_Message `Informe uma quantidade valida.`
--         * >= 1 Content valido (texto OU >=1 midia, Req 6.5) senao
--           WHATSAPP_NO_VALID_CONTENT
--             => Canonical_Message `Informe um texto ou anexe ao menos uma midia.`
--         * BULK: lista com >= 1 contato valido senao WHATSAPP_EMPTY_CONTACT_LIST
--             => Canonical_Message `Informe ao menos um contato valido.` (Req 5.7)
--         * GROUP: >= 1 grupo selecionado senao WHATSAPP_NO_GROUPS_SELECTED
--             => Canonical_Message `Selecione ao menos um grupo.` (Req 12.7)
--     - Todos os Contents/Contatos sao validados como pertencentes ao MESMO
--       `instance_id` (entidade-filho validada pelo pai; cruzada => anti-enum).
--     - Persiste o Dispatch_Job com `status` = p_status (DRAFT por padrao; ou
--       QUEUED quando o disparo ja deve ser enfileirado para o Job_Worker).
--     - Retorna o job criado (id, status, total_count, kind, ...).
--
-- Markers de erro (ERRCODE P0001) — a camada TS (task 10.2) os mapeia para as
-- Canonical_Messages pt-BR acima. Todos abortam a transacao e revertem o job
-- eventualmente ja inserido (atomicidade da RPC).
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs
-- (093..097) para evitar conflitos de edicao. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_dispatch_jobs              (SECTION 6 da 092)
--   - tabela public.whatsapp_dispatch_recipients        (SECTION 6 da 092)
--   - tabela public.whatsapp_contents                   (SECTION 5 da 092)
--   - tabela public.whatsapp_contacts                   (SECTION 5 da 092)
--   - dominios dispatch_kind/dispatch_status/distribution_mode (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- anti-enumeracao via whatsapp_assert_instance; REVOKE ALL FROM PUBLIC +
-- GRANT EXECUTE TO authenticated. Nunca exposta ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 7.6, 8.8, 10.1, 25.7_
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
-- RPC: whatsapp_create_dispatch_job(...)
-- ----------------------------------------------------------------------------
-- Parametros tipados pelos dominios fechados da 092 (dispatch_kind/_status/
-- distribution_mode) — o CHECK do dominio ja restringe os valores aceitos.
-- p_status default DRAFT (rascunho); QUEUED quando o job deve ja ir para a fila.
CREATE OR REPLACE FUNCTION whatsapp_create_dispatch_job(
  p_instance_id       uuid,
  p_kind              dispatch_kind,
  p_distribution_mode distribution_mode DEFAULT NULL,
  p_block_size        int               DEFAULT NULL,
  p_send_interval_sec int               DEFAULT NULL,
  p_execution_quota   int               DEFAULT NULL,
  p_list_id           uuid              DEFAULT NULL,
  p_group_jids        text[]            DEFAULT NULL,
  p_content_ids       uuid[]            DEFAULT NULL,
  p_status            dispatch_status   DEFAULT 'DRAFT'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_requested_ids    uuid[];        -- content ids distintos solicitados
  v_requested_count  int;
  v_owned_count      int;           -- quantos dos solicitados pertencem a instancia
  v_content_ids      uuid[];        -- content ids VALIDOS, ordenados por position
  v_content_count    int;           -- M (>= 1 apos validacao)
  v_mode             text;          -- modo efetivo da formula (GROUP usa INTERLEAVED)
  v_block_size       int;           -- tamanho de bloco efetivo (>= 1)
  v_group_jids       text[];        -- grupos saneados/deduplicados (GROUP)
  v_persist_mode     distribution_mode;  -- distribution_mode persistido no job
  v_job_id           uuid;
  v_status           text;
  v_created_at       timestamptz;
  v_updated_at       timestamptz;
  v_total            int := 0;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard. Loga
  --     WHATSAPP_VIEW_DENIED e aborta com permission_denied em falha.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada (Req 2.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao do kind/status (alem do CHECK de dominio, garante nao-nulo e
  --     restringe o status de criacao a DRAFT|QUEUED — os demais sao alcancados
  --     apenas por transicao posterior, task 11.x).
  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'whatsapp_create_dispatch_job: kind obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  v_status := COALESCE(p_status, 'DRAFT');
  IF v_status NOT IN ('DRAFT', 'QUEUED') THEN
    RAISE EXCEPTION
      'whatsapp_create_dispatch_job: status de criacao invalido "%": esperado DRAFT|QUEUED', v_status
      USING ERRCODE = '22023';
  END IF;

  -- (d) Revalidacao de Send_Interval (Req 8.2, 8.8): > 0.
  IF p_send_interval_sec IS NULL OR p_send_interval_sec <= 0 THEN
    RAISE EXCEPTION 'WHATSAPP_INVALID_SEND_INTERVAL' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Revalidacao de Execution_Quota (Req 8.4, 8.8): >= 1.
  IF p_execution_quota IS NULL OR p_execution_quota < 1 THEN
    RAISE EXCEPTION 'WHATSAPP_INVALID_EXECUTION_QUOTA' USING ERRCODE = 'P0001';
  END IF;

  -- (f) Distribution_Mode efetivo + persistido:
  --     BULK exige BLOCK|INTERLEAVED; GROUP persiste NULL (Req modelo) mas usa
  --     INTERLEAVED internamente para garantir exatamente 1 content por grupo.
  IF p_kind = 'BULK' THEN
    IF p_distribution_mode IS NULL OR p_distribution_mode NOT IN ('BLOCK', 'INTERLEAVED') THEN
      RAISE EXCEPTION
        'whatsapp_create_dispatch_job: distribution_mode obrigatorio (BLOCK|INTERLEAVED) para BULK'
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

  -- (g) Contents: precisa de >= 1 id; todos devem pertencer a instancia
  --     (cruzado/inexistente => anti-enum); >= 1 deve ser VALIDO (Req 6.5).
  IF p_content_ids IS NULL OR array_length(p_content_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'WHATSAPP_NO_VALID_CONTENT' USING ERRCODE = 'P0001';
  END IF;

  -- Distintos solicitados.
  SELECT array_agg(DISTINCT cid) INTO v_requested_ids
    FROM unnest(p_content_ids) AS cid;
  v_requested_count := array_length(v_requested_ids, 1);

  -- Quantos dos solicitados realmente pertencem a esta instancia.
  SELECT count(*) INTO v_owned_count
    FROM whatsapp_contents c
   WHERE c.id = ANY (v_requested_ids)
     AND c.instance_id = p_instance_id;

  IF v_owned_count <> v_requested_count THEN
    -- Algum Content nao existe ou e de outra instancia => anti-enumeracao.
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Contents VALIDOS (texto nao vazio OU >=1 midia), ordenados por position.
  -- Esta ordem (position) e a "ordem registrada dos Contents" usada pela
  -- distribuicao (Req 7.3); empates por created_at/id mantem determinismo.
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

  -- (h) Pre-validacao de destinatarios por tipo de disparo (antes do INSERT do
  --     job, para nao depender apenas do rollback): BULK exige lista valida com
  --     contatos; GROUP exige >= 1 grupo selecionado.
  IF p_kind = 'BULK' THEN
    -- Lista obrigatoria e pertencente a instancia (cruzada/inexistente =>
    -- anti-enum). p_list_id NULL => trata como lista vazia (Req 5.7).
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
    -- GROUP: saneia (trim) e deduplica os JIDs; vazio => bloqueia (Req 12.7).
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

  -- (i) Persiste o Dispatch_Job (status DRAFT|QUEUED). total_count e ajustado
  --     apos materializar os recipients. distribution_mode/block_size so fazem
  --     sentido em BULK; GROUP grava NULL/NULL.
  INSERT INTO whatsapp_dispatch_jobs (
    instance_id, kind, status, distribution_mode, block_size,
    send_interval_sec, execution_quota, total_count
  )
  VALUES (
    p_instance_id,
    p_kind,
    v_status::dispatch_status,
    v_persist_mode,
    CASE WHEN p_kind = 'BULK' AND v_mode = 'BLOCK' THEN v_block_size ELSE NULL END,
    p_send_interval_sec,
    p_execution_quota,
    0
  )
  RETURNING id, created_at, updated_at
    INTO v_job_id, v_created_at, v_updated_at;

  -- (j) Materializa os Dispatch_Recipients com seq deterministico,
  --     assigned_content_id pela formula de distribuicao e recipient_data em
  --     SNAPSHOT (Req 7.6, 25.7). A formula espelha assignContents:
  --       INTERLEAVED: idx mod M ; BLOCK: floor(idx/blockSize) mod M
  --     (+1 porque arrays SQL sao 1-based).
  IF p_kind = 'BULK' THEN
    INSERT INTO whatsapp_dispatch_recipients (
      instance_id, dispatch_job_id, target_kind, phone, group_jid,
      recipient_data, assigned_content_id, seq, status
    )
    SELECT
      p_instance_id,
      v_job_id,
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
      v_job_id,
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

  -- (k) Guarda final: nenhum recipient gerado => bloqueia (rollback do job).
  --     Para BULK e a lista valida vazia (Req 5.7); GROUP ja foi barrado em (h).
  IF v_total = 0 THEN
    IF p_kind = 'BULK' THEN
      RAISE EXCEPTION 'WHATSAPP_EMPTY_CONTACT_LIST' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'WHATSAPP_NO_GROUPS_SELECTED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (l) total_count = numero de recipients materializados.
  UPDATE whatsapp_dispatch_jobs
     SET total_count = v_total
   WHERE id = v_job_id
     AND instance_id = p_instance_id;

  -- (m) GROUP: registra os JIDs alvo do disparo (Req 12.2).
  IF p_kind = 'GROUP' THEN
    INSERT INTO whatsapp_group_dispatches (instance_id, dispatch_job_id, group_jids)
    VALUES (p_instance_id, v_job_id, v_group_jids);
  END IF;

  -- (n) Retorna o job criado (forma consumida pela camada TS, task 10.2).
  RETURN jsonb_build_object(
    'id',                v_job_id,
    'instance_id',       p_instance_id,
    'kind',              p_kind,
    'status',            v_status,
    'distribution_mode', v_persist_mode,
    'block_size',        CASE WHEN p_kind = 'BULK' AND v_mode = 'BLOCK' THEN v_block_size ELSE NULL END,
    'send_interval_sec', p_send_interval_sec,
    'execution_quota',   p_execution_quota,
    'total_count',       v_total,
    'created_at',        v_created_at,
    'updated_at',        v_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_create_dispatch_job(
  uuid, dispatch_kind, distribution_mode, int, int, int, uuid, text[], uuid[], dispatch_status
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_create_dispatch_job(
  uuid, dispatch_kind, distribution_mode, int, int, int, uuid, text[], uuid[], dispatch_status
) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 0) Prepare 2 Contents validos e uma Contact_List com 3 contatos:
--   SELECT whatsapp_upsert_content('<inst>', 0, NULL, 'Ola {{nome}} A');  -- content A
--   SELECT whatsapp_upsert_content('<inst>', 1, NULL, 'Ola {{nome}} B');  -- content B
--   SELECT whatsapp_create_contact_list('<inst>', 'L',
--     '[{"phone":"+5511999999991","recipient_data":{"nome":"Ana"}},
--       {"phone":"+5511999999992","recipient_data":{"nome":"Bia"}},
--       {"phone":"+5511999999993","recipient_data":{"nome":"Cid"}}]'::jsonb);

-- 1) Criar BULK INTERLEAVED (DRAFT): 3 recipients, contents A,B,A (i mod 2):
SELECT jsonb_pretty(whatsapp_create_dispatch_job(
  '<inst>', 'BULK', 'INTERLEAVED', NULL, 30, 100, '<list_id>', NULL,
  ARRAY['<content_a>','<content_b>']::uuid[]));
-- Verifique seq/assigned_content_id:
--   SELECT seq, phone, assigned_content_id, recipient_data
--     FROM whatsapp_dispatch_recipients WHERE dispatch_job_id='<job>' ORDER BY seq;

-- 2) Criar BULK BLOCK (blockSize=2): contents A,A,B (floor(i/2) mod 2):
SELECT jsonb_pretty(whatsapp_create_dispatch_job(
  '<inst>', 'BULK', 'BLOCK', 2, 45, 50, '<list_id>', NULL,
  ARRAY['<content_a>','<content_b>']::uuid[]));

-- 3) Intervalo invalido => WHATSAPP_INVALID_SEND_INTERVAL (P0001):
SELECT whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,0,1,'<list_id>',NULL,ARRAY['<content_a>']::uuid[]);

-- 4) Quota invalida => WHATSAPP_INVALID_EXECUTION_QUOTA (P0001):
SELECT whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,0,'<list_id>',NULL,ARRAY['<content_a>']::uuid[]);

-- 5) Sem content valido => WHATSAPP_NO_VALID_CONTENT (P0001):
SELECT whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,1,'<list_id>',NULL,ARRAY[]::uuid[]);

-- 6) Lista vazia/inexistente => WHATSAPP_EMPTY_CONTACT_LIST / WHATSAPP_NOT_FOUND:
SELECT whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,1,NULL,NULL,ARRAY['<content_a>']::uuid[]);

-- 7) GROUP sem grupos => WHATSAPP_NO_GROUPS_SELECTED (P0001):
SELECT whatsapp_create_dispatch_job('<inst>','GROUP',NULL,NULL,30,1,NULL,ARRAY[]::text[],ARRAY['<content_a>']::uuid[]);

-- 8) GROUP QUEUED com 2 grupos: 2 recipients, distribution_mode persistido NULL:
SELECT jsonb_pretty(whatsapp_create_dispatch_job(
  '<inst>','GROUP',NULL,NULL,30,100,NULL,
  ARRAY['123@g.us','456@g.us']::text[], ARRAY['<content_a>','<content_b>']::uuid[], 'QUEUED'));

-- 9) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action='WHATSAPP_VIEW_DENIED' ORDER BY created_at DESC LIMIT 1;
*/
