-- ============================================================================
-- Migration 097 — whatsapp_get_ai_config / whatsapp_save_ai_config (task 15.1)
-- ----------------------------------------------------------------------------
-- RPCs da Configuracao de IA por instancia (Req 14, 15, 26). A config vive em
-- whatsapp_ai_configs (UNIQUE(instance_id) => no maximo 1 por instancia, criada
-- na 092) e guarda apenas dados NAO sensiveis: enabled, ai_prompt (persona —
-- Req 26), knowledge_base (base de conhecimento — Req 15.2) e handoff_message
-- (AI_Handoff_Message — Req 31.4).
--
-- A AI_Api_Key NUNCA fica em coluna nem em resposta: vive no Supabase Vault
-- escopada por instancia, gravada via whatsapp_set_instance_secret(instance,
-- 'AI', key) (migration 092). Aqui apenas expomos/derivamos o indicador
-- booleano `has_api_key` via whatsapp_instance_secret_is_set(instance, 'AI')
-- (Req 14.2, 14.5, 18.7) — o valor em texto puro jamais e selecionado.
--
--   whatsapp_get_ai_config(p_instance_id)
--     - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8, 30.8).
--     - Retorna { enabled, ai_prompt, knowledge_base, has_api_key,
--       handoff_message, updated_at }. Quando ainda nao ha config, retorna a
--       forma default (enabled=false, demais NULL, updated_at NULL); has_api_key
--       sempre reflete o Vault, mesmo sem linha de config.
--     - NUNCA retorna a chave bruta — apenas o indicador has_api_key.
--
--   whatsapp_save_ai_config(p_instance_id, p_enabled, p_ai_prompt,
--                           p_knowledge_base, p_handoff_message,
--                           p_expected_updated_at)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance.
--     - Validacoes revalidadas no backend (Req 15.6, 26.8):
--         * ai_prompt vazio/so espacos => 'Informe um prompt valido.' (Req 26.3)
--         * knowledge_base acima do limite => 'O conteudo excede o limite
--           permitido.' (Req 15.3), SEM truncar em silencio (Req 15.2).
--     - Versionamento otimista por expected_updated_at => STALE_VERSION na
--       divergencia (Req 15.4, 26.6). Primeira gravacao: expected_updated_at
--       NULL (ainda nao ha linha).
--     - UPSERT keyed por instance_id (UNIQUE(instance_id)) escopado pela
--       instancia. NAO toca a AI_Api_Key (gravada via whatsapp_set_instance_secret)
--       nem retorna segredo. has_api_key derivado do Vault no retorno.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) para evitar conflitos de
-- edicao. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)        (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)           (SECTION 14 da 092)
--   - funcao public.whatsapp_set_instance_secret(uuid,text,text) (SECTION 14)
--   - funcao public.whatsapp_instance_secret_is_set(uuid,text)   (SECTION 14)
--   - tabela public.whatsapp_ai_configs                      (SECTION 8 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta ao
-- role anon. Nenhuma resposta/log carrega a chave (testes expectNoSecrets).
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 15.1, 15.2, 15.3, 15.4, 15.5,
--               15.6, 26.1, 26.2, 26.3, 26.6, 26.7, 26.8_
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
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_set_instance_secret'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_set_instance_secret ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'whatsapp_instance_secret_is_set'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: funcao whatsapp_instance_secret_is_set ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_ai_configs'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_ai_configs ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_ai_config(p_instance_id uuid)
-- ----------------------------------------------------------------------------
-- LEITURA da config de IA da instancia. Retorna jsonb com:
--   - enabled         : boolean (auto-reply habilitado)
--   - ai_prompt       : persona (Req 26) ou NULL
--   - knowledge_base  : base de conhecimento (Req 15.2) ou NULL
--   - has_api_key     : indicador derivado do Vault (Req 14.2, 14.5) — NUNCA a chave
--   - handoff_message : AI_Handoff_Message (Req 31.4) ou NULL
--   - updated_at      : versao da linha (NULL quando ainda nao ha config)
--
-- Quando NAO existe linha de config, retorna a forma default (enabled=false,
-- demais NULL). has_api_key SEMPRE reflete o Vault (Req 14.5), independente de
-- existir linha de config — assim a UI indica a pendencia de chave corretamente.
CREATE OR REPLACE FUNCTION whatsapp_get_ai_config(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_has_api_key boolean;
  v_result      jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard. Em falha grava
  --     WHATSAPP_VIEW_DENIED e lanca permission_denied (ERRCODE 42501).
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada; caso
  --     contrario, marker canonico WHATSAPP_NOT_FOUND (Req 2.8, 30.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Indicador de chave SEMPRE derivado do Vault (Req 14.2, 14.5, 18.7) —
  --     o valor bruto da AI_Api_Key nunca e selecionado/retornado.
  v_has_api_key := whatsapp_instance_secret_is_set(p_instance_id, 'AI');

  -- (d) Config unica por instancia (UNIQUE(instance_id)); no maximo uma linha.
  SELECT jsonb_build_object(
           'enabled',         c.enabled,
           'ai_prompt',       c.ai_prompt,
           'knowledge_base',  c.knowledge_base,
           'has_api_key',     v_has_api_key,
           'handoff_message', c.handoff_message,
           'updated_at',      c.updated_at
         )
    INTO v_result
    FROM whatsapp_ai_configs c
   WHERE c.instance_id = p_instance_id;

  -- (e) Sem config registrada => forma default (contrato estavel para a UI).
  IF v_result IS NULL THEN
    v_result := jsonb_build_object(
      'enabled',         false,
      'ai_prompt',       NULL,
      'knowledge_base',  NULL,
      'has_api_key',     v_has_api_key,
      'handoff_message', NULL,
      'updated_at',      NULL
    );
  END IF;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_ai_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_ai_config(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_save_ai_config(p_instance_id, p_enabled, p_ai_prompt,
--          p_knowledge_base, p_handoff_message, p_expected_updated_at)
-- ----------------------------------------------------------------------------
-- ESCRITA idempotente da config de IA da instancia, escopada por instance_id.
-- NAO toca a AI_Api_Key (gravada via whatsapp_set_instance_secret) e nunca
-- retorna/loga segredo. has_api_key e derivado do Vault no retorno.
--
-- Validacoes (revalidadas no backend, Req 15.6/26.8):
--   - ai_prompt vazio/so espacos => 'Informe um prompt valido.' (Req 26.3)
--   - knowledge_base > KNOWLEDGE_BASE_MAX_LENGTH => 'O conteudo excede o limite
--     permitido.' (Req 15.3), SEM truncar (Req 15.2).
--
-- Versionamento otimista (admin-patterns #3): p_expected_updated_at deve casar
-- com a versao atual da linha; divergencia => STALE_VERSION (Req 15.4, 26.6).
-- Primeira gravacao (sem linha): exige p_expected_updated_at IS NULL.
CREATE OR REPLACE FUNCTION whatsapp_save_ai_config(
  p_instance_id         uuid,
  p_enabled             boolean,
  p_ai_prompt           text,
  p_knowledge_base      text,
  p_handoff_message     text,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  -- Limite maximo da Knowledge_Base — espelha KNOWLEDGE_BASE_MAX_LENGTH em
  -- src/services/admin/whatsapp/validation.ts (Req 15.2, 15.3).
  c_kb_max_length constant int := 100000;
  v_current_updated_at timestamptz;
  v_exists             boolean;
  v_has_api_key        boolean;
  v_result             jsonb;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao do AI_Prompt: obrigatorio, nao vazio (Req 26.3). Canonical_Message.
  IF p_ai_prompt IS NULL OR length(btrim(p_ai_prompt)) = 0 THEN
    RAISE EXCEPTION 'Informe um prompt valido.' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Validacao da Knowledge_Base: acima do limite => rejeita SEM truncar
  --     (Req 15.2, 15.3). NULL/vazio e permitido (KB e opcional).
  IF p_knowledge_base IS NOT NULL AND length(p_knowledge_base) > c_kb_max_length THEN
    RAISE EXCEPTION 'O conteudo excede o limite permitido.' USING ERRCODE = 'P0001';
  END IF;

  -- (e) Versionamento otimista: confere a versao atual da linha (se existir).
  SELECT c.updated_at INTO v_current_updated_at
    FROM whatsapp_ai_configs c
   WHERE c.instance_id = p_instance_id;

  v_exists := FOUND;

  IF v_exists THEN
    -- Linha existe: expected_updated_at deve casar exatamente.
    IF p_expected_updated_at IS DISTINCT FROM v_current_updated_at THEN
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    END IF;

    UPDATE whatsapp_ai_configs
       SET enabled         = p_enabled,
           ai_prompt       = p_ai_prompt,
           knowledge_base  = p_knowledge_base,
           handoff_message = p_handoff_message
     WHERE instance_id = p_instance_id;
  ELSE
    -- Sem linha ainda: primeira gravacao exige expected_updated_at NULL. Se o
    -- chamador esperava uma versao mas a linha sumiu => STALE_VERSION.
    IF p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE = 'P0001';
    END IF;

    -- has_api_key e apenas indicador legado da coluna; a fonte de verdade e o
    -- Vault (derivado no retorno). Default false no INSERT.
    INSERT INTO whatsapp_ai_configs (
      instance_id, enabled, ai_prompt, knowledge_base, handoff_message
    )
    VALUES (
      p_instance_id, p_enabled, p_ai_prompt, p_knowledge_base, p_handoff_message
    );
  END IF;

  -- (f) Indicador de chave derivado do Vault (Req 14.2, 14.5) — nunca a chave.
  v_has_api_key := whatsapp_instance_secret_is_set(p_instance_id, 'AI');

  -- (g) Retorna a config persistida (mesma forma de whatsapp_get_ai_config).
  SELECT jsonb_build_object(
           'enabled',         c.enabled,
           'ai_prompt',       c.ai_prompt,
           'knowledge_base',  c.knowledge_base,
           'has_api_key',     v_has_api_key,
           'handoff_message', c.handoff_message,
           'updated_at',      c.updated_at
         )
    INTO v_result
    FROM whatsapp_ai_configs c
   WHERE c.instance_id = p_instance_id;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_save_ai_config(uuid, boolean, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_save_ai_config(uuid, boolean, text, text, text, timestamptz) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Sem config registrada, get retorna a forma default (enabled=false):
SELECT jsonb_pretty(whatsapp_get_ai_config('<instance_id>'));

-- 2) Primeira gravacao (expected_updated_at NULL) cria a config:
SELECT jsonb_pretty(whatsapp_save_ai_config(
  '<instance_id>', true, 'Voce e um atendente cordial.', 'Base de conhecimento...',
  'Vou transferir voce para um atendente.', NULL
));

-- 3) ai_prompt vazio => 'Informe um prompt valido.':
SELECT whatsapp_save_ai_config('<instance_id>', true, '   ', NULL, NULL, NULL);

-- 4) knowledge_base acima do limite => 'O conteudo excede o limite permitido.':
SELECT whatsapp_save_ai_config('<instance_id>', true, 'ok', repeat('x', 100001), NULL, NULL);

-- 5) expected_updated_at divergente => STALE_VERSION:
SELECT whatsapp_save_ai_config('<instance_id>', true, 'ok', NULL, NULL, now());

-- 6) has_api_key reflete o Vault apos whatsapp_set_instance_secret(instance,'AI',key):
SELECT whatsapp_set_instance_secret('<instance_id>', 'AI', 'sk-test-123');
SELECT (whatsapp_get_ai_config('<instance_id>') ->> 'has_api_key');  -- true

-- 7) Instancia inexistente => anti-enumeracao (WHATSAPP_NOT_FOUND / P0001):
SELECT whatsapp_get_ai_config('00000000-0000-0000-0000-000000000000');

-- 8) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
