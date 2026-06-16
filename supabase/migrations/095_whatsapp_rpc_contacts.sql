-- ============================================================================
-- Migration 095 — Contact_List / Contact RPCs (task 8.1)
-- ----------------------------------------------------------------------------
-- RPCs de Contact_List/Contact do WhatsApp_Module, todas escopadas por
-- `instance_id` da Active_Instance (Req 2.5, 5.4, 5.6, 5.7):
--
--   whatsapp_create_contact_list(p_instance_id, p_name, p_contacts)
--     - ESCRITA, gating SETTINGS_EDIT (camada 2 do RBAC).
--     - Anti-enumeracao via whatsapp_assert_instance (Req 2.8).
--     - Persiste a Contact_List COM o `instance_id` e insere os Contacts
--       (Req 5.6). `p_contacts` e um array jsonb de `{ phone, recipient_data }`
--       ja NORMALIZADO em E.164 pela camada TS (reuso de `normalizeNumbers`).
--     - SANITY CHECK server-side (defesa em profundidade): mantem SOMENTE
--       telefones em E.164 BR (`^\+55\d{10,11}$`), descartando qualquer phone
--       fora do formato; dedup por telefone (DISTINCT ON + UNIQUE(list_id,phone)
--       com ON CONFLICT DO NOTHING) — armazena apenas E.164 (Req 5.2, 5.3).
--     - LISTA VAZIA: se nao sobra nenhum telefone valido, NAO cria a lista e
--       lanca o marker WHATSAPP_EMPTY_CONTACT_LIST (ERRCODE P0001), que a camada
--       TS mapeia para a Canonical_Message `Informe ao menos um contato valido.`
--       (Req 5.7) — guarda reutilizada pelo caminho de criacao de disparo.
--
--   whatsapp_list_contact_lists(p_instance_id)
--     - LEITURA, gating SETTINGS_VIEW. Lista as Contact_Lists da instancia com
--       a contagem de Contacts (escopo estrito por `instance_id`).
--
--   whatsapp_get_contacts(p_instance_id, p_list_id)
--     - LEITURA, gating SETTINGS_VIEW. Retorna os Contacts de uma lista,
--       validando que a lista pertence a `instance_id` (lista cruzada/inexistente
--       => marker anti-enumeracao WHATSAPP_NOT_FOUND).
--
-- Esta migration e SEPARADA da 092 (foundation/schema), 093 (instances) e 094
-- (session) para evitar conflitos de edicao. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)  (SECTION 13 da 092)
--   - funcao public.whatsapp_assert_instance(uuid)     (SECTION 14 da 092)
--   - tabela public.whatsapp_contact_lists             (SECTION 5 da 092)
--   - tabela public.whatsapp_contacts                  (SECTION 5 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- no topo do corpo (com log negativo WHATSAPP_VIEW_DENIED em falha);
-- REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. Nunca exposta ao
-- role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 5.4, 5.6, 5.7, 2.5_
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
     WHERE table_schema = 'public' AND table_name = 'whatsapp_contact_lists'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_contact_lists ausente';
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
-- RPC: whatsapp_create_contact_list(p_instance_id uuid, p_name text,
--                                   p_contacts jsonb DEFAULT '[]'::jsonb)
-- ----------------------------------------------------------------------------
-- Cria a Contact_List da instancia e persiste seus Contacts. `p_contacts` e um
-- array jsonb de objetos `{ "phone": "+55DDDNNNNNNNN", "recipient_data": {...} }`
-- ja normalizado/validado no frontend (normalizeNumbers). O backend REVALIDA o
-- formato E.164 (sanity check), descarta phones fora do padrao, deduplica por
-- telefone e, se sobrar a lista VAZIA, aborta com WHATSAPP_EMPTY_CONTACT_LIST
-- (sem criar a lista). Retorna jsonb com a lista criada e a contagem efetiva.
CREATE OR REPLACE FUNCTION whatsapp_create_contact_list(
  p_instance_id uuid,
  p_name        text,
  p_contacts    jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_name        text;
  v_valid_count int;
  v_list_id     uuid;
  v_created_at  timestamptz;
  v_updated_at  timestamptz;
  v_count       int;
BEGIN
  -- (a) Gating de escrita (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_EDIT');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Validacao de input: nome obrigatorio (nao vazio apos trim).
  v_name := btrim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'whatsapp_create_contact_list: nome obrigatorio'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- (d) Sanity check server-side: conta telefones DISTINTOS em E.164 BR valido.
  --     Defesa em profundidade — mesmo que o front falhe, so persistimos E.164.
  SELECT count(DISTINCT (c->>'phone'))
    INTO v_valid_count
    FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) AS c
   WHERE (c->>'phone') ~ '^\+55\d{10,11}$';

  -- (e) Lista valida vazia => bloqueia o inicio sem criar a lista (Req 5.7).
  --     Marker canonico mapeado em TS para `Informe ao menos um contato valido.`.
  IF COALESCE(v_valid_count, 0) = 0 THEN
    RAISE EXCEPTION 'WHATSAPP_EMPTY_CONTACT_LIST' USING ERRCODE = 'P0001';
  END IF;

  -- (f) Persiste a Contact_List COM o instance_id da Active_Instance (Req 5.6).
  INSERT INTO whatsapp_contact_lists (instance_id, name)
  VALUES (p_instance_id, v_name)
  RETURNING id, created_at, updated_at
    INTO v_list_id, v_created_at, v_updated_at;

  -- (g) Insere os Contacts deduplicados por telefone (DISTINCT ON pega a
  --     primeira ocorrencia/recipient_data). Armazena somente E.164; o UNIQUE
  --     (list_id, phone) + ON CONFLICT DO NOTHING reforca a dedup (Req 5.2, 5.3).
  INSERT INTO whatsapp_contacts (instance_id, list_id, phone, recipient_data)
  SELECT p_instance_id, v_list_id, d.phone, d.recipient_data
    FROM (
      SELECT DISTINCT ON (c->>'phone')
             c->>'phone'                                AS phone,
             COALESCE(c->'recipient_data', '{}'::jsonb) AS recipient_data
        FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb))
               WITH ORDINALITY AS t(c, ord)
       WHERE (c->>'phone') ~ '^\+55\d{10,11}$'
       ORDER BY c->>'phone', ord
    ) d
  ON CONFLICT (list_id, phone) DO NOTHING;

  -- (h) Contagem efetiva de Contacts persistidos na lista (escopo por instancia).
  SELECT count(*) INTO v_count
    FROM whatsapp_contacts ct
   WHERE ct.list_id = v_list_id
     AND ct.instance_id = p_instance_id;

  RETURN jsonb_build_object(
    'id',            v_list_id,
    'instance_id',   p_instance_id,
    'name',          v_name,
    'contact_count', v_count,
    'created_at',    v_created_at,
    'updated_at',    v_updated_at
  );
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_create_contact_list(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_create_contact_list(uuid, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_list_contact_lists(p_instance_id uuid)
-- ----------------------------------------------------------------------------
-- LEITURA das Contact_Lists da instancia (escopo estrito por instance_id), com
-- a contagem de Contacts de cada lista. Ordena pelas mais recentes primeiro.
CREATE OR REPLACE FUNCTION whatsapp_list_contact_lists(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_result jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) Projecao escopada por instance_id; contact_count via subselect escopado.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',            cl.id,
               'name',          cl.name,
               'contact_count', (
                 SELECT count(*)
                   FROM whatsapp_contacts ct
                  WHERE ct.list_id = cl.id
                    AND ct.instance_id = p_instance_id
               ),
               'created_at',    cl.created_at,
               'updated_at',    cl.updated_at
             )
             ORDER BY cl.created_at DESC, cl.id
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM whatsapp_contact_lists cl
   WHERE cl.instance_id = p_instance_id;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_contact_lists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_contact_lists(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: whatsapp_get_contacts(p_instance_id uuid, p_list_id uuid)
-- ----------------------------------------------------------------------------
-- LEITURA dos Contacts de uma Contact_List. A lista precisa pertencer a
-- `instance_id` (coerencia pai/instancia). Lista inexistente ou de outra
-- instancia => marker anti-enumeracao WHATSAPP_NOT_FOUND (resposta
-- indistinguivel, Req 2.8).
CREATE OR REPLACE FUNCTION whatsapp_get_contacts(
  p_instance_id uuid,
  p_list_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_list_ok boolean;
  v_result  jsonb;
BEGIN
  -- (a) Gating de leitura (camada 2 do RBAC) + auth guard.
  PERFORM whatsapp_require_permission('SETTINGS_VIEW');

  -- (b) Anti-enumeracao: instancia precisa existir/estar habilitada.
  PERFORM whatsapp_assert_instance(p_instance_id);

  -- (c) A lista precisa existir E pertencer a esta instancia; caso contrario
  --     marker canonico anti-enumeracao (nao revela existencia da lista).
  SELECT EXISTS (
    SELECT 1
      FROM whatsapp_contact_lists cl
     WHERE cl.id = p_list_id
       AND cl.instance_id = p_instance_id
  ) INTO v_list_ok;

  IF NOT v_list_ok THEN
    RAISE EXCEPTION 'WHATSAPP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Contacts da lista, escopados por instance_id, em ordem deterministica.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',             ct.id,
               'phone',          ct.phone,
               'recipient_data', ct.recipient_data
             )
             ORDER BY ct.created_at, ct.id
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM whatsapp_contacts ct
   WHERE ct.list_id = p_list_id
     AND ct.instance_id = p_instance_id;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_get_contacts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_get_contacts(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Pegue uma instancia habilitada qualquer:
--   SELECT id FROM whatsapp_instances WHERE enabled = true ORDER BY display_order LIMIT 1;

-- 1) Criar lista com 2 contatos validos (1 duplicado descartado):
SELECT whatsapp_create_contact_list(
  '<instance_id>',
  'Lista Teste',
  '[{"phone":"+5511999999999","recipient_data":{"nome":"Ana"}},
    {"phone":"+5511999999999","recipient_data":{"nome":"Ana2"}},
    {"phone":"+5511988888888","recipient_data":{}}]'::jsonb
);  -- contact_count = 2

-- 2) Lista vazia/sem validos => WHATSAPP_EMPTY_CONTACT_LIST (P0001):
SELECT whatsapp_create_contact_list('<instance_id>', 'Vazia', '[{"phone":"abc"}]'::jsonb);

-- 3) Listar listas da instancia:
SELECT jsonb_pretty(whatsapp_list_contact_lists('<instance_id>'));

-- 4) Contatos de uma lista:
SELECT jsonb_pretty(whatsapp_get_contacts('<instance_id>', '<list_id>'));

-- 5) Lista de outra instancia / inexistente => WHATSAPP_NOT_FOUND (P0001):
SELECT whatsapp_get_contacts('<instance_id>', '00000000-0000-0000-0000-000000000000');

-- 6) Sem permissao => permission_denied + log WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
