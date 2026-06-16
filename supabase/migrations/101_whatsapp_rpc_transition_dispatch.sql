-- ============================================================================
-- Migration 101 — whatsapp_transition_dispatch (task 11.1)
-- ----------------------------------------------------------------------------
-- RPC SECURITY DEFINER que aplica a MAQUINA DE ESTADOS do Dispatch_Job para as
-- acoes de controle do disparo (Req 9): START, PAUSE, RESUME, CANCEL. Escopada
-- por `instance_id` da Active_Instance. E a contraparte server-side dos botoes
-- "Iniciar / Pausar / Continuar / Cancelar".
--
--   whatsapp_transition_dispatch(p_instance_id, p_job_id, p_action,
--                                p_expected_updated_at)
--
-- Acoes e transicoes (espelham o state diagram de design.md > Dispatch Engine):
--   * START  : DRAFT              -> QUEUED      (Req 9.1) habilita o Job_Worker
--   * PAUSE  : RUNNING            -> PAUSED      (Req 9.2) interrompe novos envios
--   * RESUME : PAUSED             -> QUEUED      (Req 9.3) re-enfileira do proximo
--              (Continuar) zera exec_sent_count para reabrir a janela de quota
--   * CANCEL : QUEUED|RUNNING|PAUSED -> CANCELLED (Req 9.4) impede novos envios;
--              grava completed_at (estado terminal => Execution_Duration)
--
-- Semantica de resultado (admin-patterns #3, #4):
--   * Transicao JA APLICADA (estado atual == estado-alvo da acao), ex.: PAUSE de
--     um job ja PAUSED => IDEMPOTENCIA: NAO muta, grava audit `*_SKIPPED` DENTRO
--     desta RPC (nao ha mutacao real, logo nao usa executeAdminMutation) e
--     retorna { skipped: true, reason: 'ALREADY_<STATE>' } (Req 9.5).
--   * Transicao INVALIDA (estado atual nao admite a acao), ex.: RESUME de um job
--     COMPLETED/CANCELLED => RAISE 'INVALID_STATE_TRANSITION' (ERRCODE P0001),
--     aborta sem efeito (Req 9.7).
--   * Versionamento otimista (Req 9.6): a UPDATE da transicao valida filtra por
--     `updated_at = p_expected_updated_at`. ROW_COUNT = 0 => distingue, via
--     re-SELECT, NOT_FOUND (linha sumiu) de STALE_VERSION (outra escrita
--     concorrente mudou updated_at) e lanca o marker apropriado.
--   * Transicao VALIDA: muta o status (+ efeitos colaterais por acao) e retorna
--     { ok: true, id, instance_id, status, previous_status, updated_at }. O
--     AUDIT da transicao valida (Req 9.8) e gravado pela camada TS
--     (dispatch.ts::transitionDispatch via executeAdminMutation, task 11.2),
--     que recebe `previous_status`/`status`/`instance_id` no retorno desta RPC e
--     materializa o registro before/after — coerente com admin-patterns #1
--     (mutacao real => audit-by-construction no wrapper TS) e com a 099
--     (whatsapp_create_dispatch_job tambem delega o audit positivo ao TS).
--
-- Markers de erro (ERRCODE P0001) — a camada TS (task 11.2) os mapeia:
--   * INVALID_STATE_TRANSITION -> erro 'INVALID_STATE_TRANSITION'
--   * STALE_VERSION            -> erro 'STALE_VERSION' (toast "Outro admin...")
--   * WHATSAPP_NOT_FOUND       -> Canonical_Message anti-enumeracao
--                                 `Nao foi possivel concluir a operacao.`
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e das demais RPCs
-- (093..100) para evitar conflitos de edicao. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)   (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)      (SECTION 14 da 092)
--   - tabela public.whatsapp_dispatch_jobs              (SECTION 6 da 092)
--   - dominio public.dispatch_status                    (SECTION 2 da 092)
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
-- _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
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
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_transition_dispatch(...)
-- ----------------------------------------------------------------------------
-- p_action e um text de dominio fechado {START,PAUSE,RESUME,CANCEL}; valores
-- fora do dominio abortam com 22023 (erro de programacao, nao transicao).
-- p_expected_updated_at carrega o valor de updated_at lido pelo cliente antes
-- de abrir o controle (versionamento otimista, admin-patterns #3).
CREATE OR REPLACE FUNCTION whatsapp_transition_dispatch(
  p_instance_id         uuid,
  p_job_id              uuid,
  p_action              text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller          uuid;
  v_action          text;
  v_current_status  text;   -- estado atual do job (pre-fetch)
  v_target_status   text;   -- estado-alvo da acao
  v_is_valid_from   boolean;-- estado atual admite a acao?
  v_skip_reason     text;   -- reason de idempotencia (ALREADY_<STATE>)
  v_new_updated_at  timestamptz;
  v_rows            int;
  v_still_exists    boolean;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard. Loga
  --     WHATSAPP_VIEW_DENIED e aborta com permission_denied em falha.
  v_caller := whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao de instancia: inexistente/desabilitada/cruzada =>
  --     WHATSAPP_NOT_FOUND (Req 2.8). Mapeado para Canonical_Message no TS.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Dominio fechado da acao (erro de programacao se fora do conjunto).
  v_action := upper(btrim(COALESCE(p_action, '')));
  IF v_action NOT IN ('START', 'PAUSE', 'RESUME', 'CANCEL') THEN
    RAISE EXCEPTION
      'whatsapp_transition_dispatch: acao invalida "%": esperado START|PAUSE|RESUME|CANCEL', p_action
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- (d) Pre-fetch do estado atual, escopado por instancia (entidade-filho
  --     validada contra o instance_id). Job inexistente OU de outra instancia
  --     => anti-enumeracao (indistinguivel de "sem acesso").
  SELECT status::text
    INTO v_current_status
    FROM whatsapp_dispatch_jobs
   WHERE id = p_job_id
     AND instance_id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Tabela de transicoes da maquina de estados (design.md > Dispatch Engine):
  --       acao    estado-alvo   estados de origem validos
  --       START   QUEUED        {DRAFT}
  --       PAUSE   PAUSED        {RUNNING}
  --       RESUME  QUEUED        {PAUSED}
  --       CANCEL  CANCELLED     {QUEUED, RUNNING, PAUSED}
  CASE v_action
    WHEN 'START' THEN
      v_target_status := 'QUEUED';
      v_is_valid_from := (v_current_status = 'DRAFT');
    WHEN 'PAUSE' THEN
      v_target_status := 'PAUSED';
      v_is_valid_from := (v_current_status = 'RUNNING');
    WHEN 'RESUME' THEN
      v_target_status := 'QUEUED';
      v_is_valid_from := (v_current_status = 'PAUSED');
    WHEN 'CANCEL' THEN
      v_target_status := 'CANCELLED';
      v_is_valid_from := (v_current_status IN ('QUEUED', 'RUNNING', 'PAUSED'));
  END CASE;

  -- (f) IDEMPOTENCIA (Req 9.5): se o job JA esta no estado-alvo da acao, nao ha
  --     mutacao. Grava o audit `<ACTION>_SKIPPED` DENTRO desta RPC (admin-
  --     patterns #4: skip nao usa executeAdminMutation) e retorna skip. Tem
  --     precedencia sobre versionamento (no-op nao depende da versao).
  IF v_current_status = v_target_status THEN
    v_skip_reason := 'ALREADY_' || v_target_status;

    INSERT INTO admin_audit_logs(
      admin_id, action, target_type, target_id, before_data, after_data
    )
    VALUES (
      v_caller,
      'WHATSAPP_DISPATCH_' || v_action || '_SKIPPED',
      'whatsapp_dispatch_jobs',
      p_job_id,
      jsonb_build_object('instance_id', p_instance_id, 'status', v_current_status),
      jsonb_build_object('instance_id', p_instance_id, 'reason', v_skip_reason)
    );

    RETURN jsonb_build_object('skipped', true, 'reason', v_skip_reason);
  END IF;

  -- (g) TRANSICAO INVALIDA (Req 9.7): estado atual nao admite a acao e nao e o
  --     estado-alvo (ex.: RESUME de COMPLETED/CANCELLED, START de RUNNING).
  IF NOT v_is_valid_from THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  -- (h) TRANSICAO VALIDA com versionamento otimista (Req 9.6). O trigger
  --     trg_whatsapp_dispatch_jobs_touch atualiza updated_at apos o match do
  --     WHERE (que usa o updated_at ANTIGO informado pelo cliente). Efeitos por
  --     acao:
  --       RESUME -> zera exec_sent_count (reabre a janela de quota, Req 9.3 /
  --                 design "Continuar zera exec_sent_count e re-enfileira").
  --       CANCEL -> grava completed_at (estado terminal => Execution_Duration).
  UPDATE whatsapp_dispatch_jobs
     SET status          = v_target_status::dispatch_status,
         exec_sent_count = CASE WHEN v_action = 'RESUME' THEN 0 ELSE exec_sent_count END,
         completed_at    = CASE WHEN v_action = 'CANCEL' THEN now() ELSE completed_at END
   WHERE id = p_job_id
     AND instance_id = p_instance_id
     AND updated_at = p_expected_updated_at
  RETURNING updated_at INTO v_new_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- (i) ROW_COUNT = 0: o pre-fetch (d) encontrou a linha, logo o nao-match aqui
  --     e por versao desatualizada OU por delecao concorrente. Distingue via
  --     re-SELECT: ainda existe => STALE_VERSION; sumiu => NOT_FOUND.
  IF v_rows = 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM whatsapp_dispatch_jobs
       WHERE id = p_job_id AND instance_id = p_instance_id
    ) INTO v_still_exists;

    IF v_still_exists THEN
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (j) Retorno da transicao valida. previous_status/status/instance_id sao
  --     consumidos pela camada TS (task 11.2) para o audit via
  --     executeAdminMutation (Req 9.8). updated_at e a nova versao otimista.
  RETURN jsonb_build_object(
    'ok',              true,
    'id',              p_job_id,
    'instance_id',     p_instance_id,
    'action',          v_action,
    'previous_status', v_current_status,
    'status',          v_target_status,
    'updated_at',      v_new_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_transition_dispatch(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_transition_dispatch(uuid, uuid, text, timestamptz) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada e crie um job DRAFT (via whatsapp_create_dispatch_job):
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;
--   SELECT (whatsapp_create_dispatch_job('<inst>','BULK','INTERLEAVED',NULL,30,100,
--             '<list_id>',NULL,ARRAY['<content_a>']::uuid[]))->>'id' AS job_id;
--   SELECT id, status, updated_at FROM whatsapp_dispatch_jobs WHERE id='<job>';

-- 1) START valido (DRAFT -> QUEUED). Use o updated_at lido acima:
SELECT jsonb_pretty(whatsapp_transition_dispatch('<inst>','<job>','START','<updated_at>'));
-- => { ok:true, previous_status:'DRAFT', status:'QUEUED', updated_at:<novo> }

-- 2) START de novo (ja QUEUED) => idempotencia _SKIPPED:
SELECT jsonb_pretty(whatsapp_transition_dispatch('<inst>','<job>','START','<novo_updated_at>'));
-- => { skipped:true, reason:'ALREADY_QUEUED' }
SELECT action, before_data, after_data FROM admin_audit_logs
 WHERE action='WHATSAPP_DISPATCH_START_SKIPPED' ORDER BY created_at DESC LIMIT 1;

-- 3) RESUME de um QUEUED (nao PAUSED) => INVALID_STATE_TRANSITION (P0001):
SELECT whatsapp_transition_dispatch('<inst>','<job>','RESUME','<novo_updated_at>');

-- 4) CANCEL valido (QUEUED -> CANCELLED), grava completed_at:
SELECT jsonb_pretty(whatsapp_transition_dispatch('<inst>','<job>','CANCEL','<novo_updated_at>'));
SELECT status, completed_at FROM whatsapp_dispatch_jobs WHERE id='<job>';

-- 5) Qualquer acao sobre o job CANCELLED (terminal) => INVALID (exceto CANCEL,
--    que e idempotente _SKIPPED ALREADY_CANCELLED):
SELECT whatsapp_transition_dispatch('<inst>','<job>','PAUSE','<updated_at>');  -- INVALID_STATE_TRANSITION
SELECT jsonb_pretty(whatsapp_transition_dispatch('<inst>','<job>','CANCEL','<updated_at>')); -- skipped

-- 6) Versao desatualizada => STALE_VERSION (P0001): use um updated_at antigo:
SELECT whatsapp_transition_dispatch('<inst>','<job>','PAUSE','2000-01-01T00:00:00Z');

-- 7) Instancia/job inexistente ou cruzado => WHATSAPP_NOT_FOUND (anti-enum):
SELECT whatsapp_transition_dispatch('00000000-0000-0000-0000-000000000000','<job>','START',now());

-- 8) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs WHERE action='WHATSAPP_VIEW_DENIED' ORDER BY created_at DESC LIMIT 1;
*/
