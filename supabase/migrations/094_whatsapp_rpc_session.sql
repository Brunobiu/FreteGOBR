-- ============================================================================
-- Migration 094 — whatsapp_get_session / whatsapp_set_session_status (task 6.2)
-- ----------------------------------------------------------------------------
-- RPCs da WhatsApp_Session UNICA por instancia. A conexao e centralizada e
-- persistente: existe NO MAXIMO uma sessao por WhatsApp_Instance (constraint
-- UNIQUE(instance_id) em whatsapp_sessions, criada na 092) e essa mesma sessao
-- autenticada e reutilizada por TODOS os modulos da instancia — Disparo em
-- Massa, Grupo, Programados, IA e Extrator (Req 3.3, 3.6, 4.1, 4.2, 4.3, 4.4,
-- 4.6). Aqui apenas EXPOMOS o estado da sessao (status/QR/last_connected_at) e
-- o seu UPSERT idempotente; o bloqueio de acoes quando a sessao nao esta
-- `CONNECTED` (Req 3.8, 4.5) e responsabilidade dos chamadores.
--
--   whatsapp_get_session(p_instance_id)
--     - LEITURA, gating SETTINGS_VIEW (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8, 30.8).
--     - Retorna a UNICA linha de sessao (status, qr_code, last_connected_at) ou
--       uma forma default `DISCONNECTED` quando ainda nao ha sessao registrada.
--
--   whatsapp_set_session_status(p_instance_id, p_status, p_qr_code = NULL)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance.
--     - UPSERT keyed por instance_id (INSERT ... ON CONFLICT (instance_id) DO
--       UPDATE) — garante UMA unica linha de sessao reutilizada (Req 4.2). O
--       qr_code e transitorio: limpo ao atingir `CONNECTED`; last_connected_at
--       e carimbado ao conectar e preservado nos demais estados.
--
-- Esta migration e SEPARADA da 092 (foundation/schema) e da 093
-- (whatsapp_list_instances) para evitar conflitos de edicao. Depende dos
-- objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)  (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)     (SECTION 14 da 092)
--   - tabela public.whatsapp_sessions                  (SECTION 8 da 092)
--   - dominio public.session_status                    (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta ao
-- role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 3.3, 3.6, 4.1, 4.2, 4.3, 4.4, 4.6, 2.9, 2.10_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_sessions ausente';
  END IF;
END
$check$;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_session(p_instance_id uuid)
-- ----------------------------------------------------------------------------
-- LEITURA da sessao unica da instancia. Retorna jsonb com:
--   - instance_id       : uuid da instancia
--   - status            : session_status efetivo
--   - qr_code           : QR transitorio (NULL quando conectado/sem sessao)
--   - last_connected_at : ultimo instante em que atingiu CONNECTED (ou NULL)
--   - updated_at        : versao da linha (NULL quando ainda nao ha sessao)
--
-- Quando NAO existe linha de sessao para a instancia, retorna a forma default
-- `DISCONNECTED` (a sessao e materializada apenas no primeiro set_status). Isso
-- mantem o contrato estavel para todos os modulos da instancia (Req 4.1, 4.3).
CREATE OR REPLACE FUNCTION whatsapp_get_session(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard. Em falha grava
  --     WHATSAPP_VIEW_DENIED e lanca permission_denied (ERRCODE 42501).
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada; caso
  --     contrario, marker canonico WHATSAPP_NOT_FOUND (Req 2.8, 30.8).
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Sessao unica por instancia (UNIQUE(instance_id)); no maximo uma linha.
  SELECT jsonb_build_object(
           'instance_id',       s.instance_id,
           'status',            s.status::text,
           'qr_code',           s.qr_code,
           'last_connected_at', s.last_connected_at,
           'updated_at',        s.updated_at
         )
    INTO v_result
    FROM whatsapp_sessions s
   WHERE s.instance_id = p_instance_id;

  -- (d) Sem sessao registrada => forma default DISCONNECTED (contrato estavel).
  IF v_result IS NULL THEN
    v_result := jsonb_build_object(
      'instance_id',       p_instance_id,
      'status',            'DISCONNECTED',
      'qr_code',           NULL,
      'last_connected_at', NULL,
      'updated_at',        NULL
    );
  END IF;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_session(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_set_session_status(p_instance_id uuid, p_status session_status,
--                                  p_qr_code text DEFAULT NULL)
-- ----------------------------------------------------------------------------
-- ESCRITA idempotente do estado da sessao unica da instancia. O UPSERT keyed
-- por instance_id (ON CONFLICT (instance_id)) garante que SEMPRE existe no
-- maximo UMA linha de sessao por instancia, reutilizada por todos os modulos
-- (Req 4.2). Regras transitorias:
--   - qr_code: persiste o valor recebido, EXCETO ao atingir `CONNECTED`, quando
--     e limpo (NULL) — o QR e transitorio e nao sobrevive ao pareamento.
--   - last_connected_at: carimbado com now() quando o status passa a
--     `CONNECTED`; nos demais estados o valor existente e preservado.
-- Retorna a linha atualizada (mesma forma de whatsapp_get_session).
CREATE OR REPLACE FUNCTION whatsapp_set_session_status(
  p_instance_id uuid,
  p_status      session_status,
  p_qr_code     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_connected boolean := (p_status = 'CONNECTED');
  v_qr        text    := CASE WHEN p_status = 'CONNECTED' THEN NULL ELSE p_qr_code END;
  v_result    jsonb;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao de input: status obrigatorio (o dominio session_status ja
  --     restringe o conjunto de valores aceitos; aqui garantimos nao-nulo).
  IF p_status IS NULL THEN
    RAISE EXCEPTION
      'whatsapp_set_session_status: status obrigatorio' USING ERRCODE = '22023';
  END IF;

  -- (d) UPSERT keyed por instance_id => sessao unica reutilizada (Req 4.2).
  --     updated_at e mantido pelo trigger trg_whatsapp_sessions_touch (092).
  INSERT INTO whatsapp_sessions (instance_id, status, qr_code, last_connected_at)
  VALUES (
    p_instance_id,
    p_status,
    v_qr,
    CASE WHEN v_connected THEN now() ELSE NULL END
  )
  ON CONFLICT (instance_id) DO UPDATE
    SET status            = EXCLUDED.status,
        qr_code           = EXCLUDED.qr_code,
        last_connected_at = CASE
                              WHEN v_connected THEN now()
                              ELSE whatsapp_sessions.last_connected_at
                            END
  RETURNING jsonb_build_object(
              'instance_id',       instance_id,
              'status',            status::text,
              'qr_code',           qr_code,
              'last_connected_at', last_connected_at,
              'updated_at',        updated_at
            )
    INTO v_result;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_set_session_status(uuid, session_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_set_session_status(uuid, session_status, text) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Sem sessao registrada, get retorna a forma default DISCONNECTED:
SELECT jsonb_pretty(whatsapp_get_session('<instance_id>'));

-- 2) Set para QR_PENDING grava o QR; get reflete o mesmo estado:
SELECT whatsapp_set_session_status('<instance_id>', 'QR_PENDING', 'data:image/png;base64,...');
SELECT jsonb_pretty(whatsapp_get_session('<instance_id>'));

-- 3) Set para CONNECTED limpa o qr_code e carimba last_connected_at:
SELECT whatsapp_set_session_status('<instance_id>', 'CONNECTED');

-- 4) Reaplicar o set (idempotente) NAO cria nova linha (UNIQUE(instance_id)):
SELECT count(*) FROM whatsapp_sessions WHERE instance_id = '<instance_id>';  -- = 1

-- 5) Instancia inexistente => anti-enumeracao (WHATSAPP_NOT_FOUND / P0001):
SELECT whatsapp_get_session('00000000-0000-0000-0000-000000000000');

-- 6) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
