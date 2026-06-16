-- ============================================================================
-- Migration 093 — whatsapp_list_instances (task 6.1)
-- ----------------------------------------------------------------------------
-- RPC de LEITURA data-driven que lista as WhatsApp_Instances HABILITADAS do
-- painel admin, com o status de conexao derivado de whatsapp_sessions. Nenhuma
-- quantidade fixa de instancias e codificada: a RPC itera as linhas habilitadas
-- de whatsapp_instances (sem `5` hardcoded / sem LIMIT), de modo que aumentar o
-- numero de instancias e apenas inserir linhas (Req 2.1, 2.2, 29.1, 29.2, 29.7).
--
-- Esta migration e SEPARADA da 092 (foundation/schema) para evitar conflitos de
-- edicao na migration principal. Depende dos objetos criados em 092:
--   - funcao public.whatsapp_require_permission(text)  (SECTION 13 da 092)
--   - tabela public.whatsapp_instances                 (SECTION 3 da 092)
--   - tabela public.whatsapp_sessions                  (SECTION 8 da 092)
--   - dominio public.session_status                    (SECTION 2 da 092)
--
-- Postura de seguranca (admin-patterns #2, #10): SECURITY DEFINER +
-- SET search_path = public; gating server-side via whatsapp_require_permission
-- ('SETTINGS_VIEW') no topo do corpo (camada 2 do RBAC, com log negativo
-- WHATSAPP_VIEW_DENIED em falha); REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
-- authenticated. Nunca exposta ao role anon.
--
-- Idempotente: CREATE OR REPLACE FUNCTION; wrapper BEGIN/COMMIT; bloco
-- defensivo DO $check$ validando os pre-requisitos da 092.
-- _Requirements: 2.1, 2.2, 29.1, 29.2, 29.7_
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
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'whatsapp_instances'
  ) THEN
    RAISE EXCEPTION
      'Migration 092 (whatsapp foundation) nao aplicada: tabela whatsapp_instances ausente';
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
-- RPC: whatsapp_list_instances()
-- ----------------------------------------------------------------------------
-- Retorna um jsonb array (ordenado por display_order) com uma entrada por
-- WhatsApp_Instance HABILITADA. Cada entrada expoe:
--   - id            : uuid da instancia
--   - label         : rotulo exibido ("WhatsApp 1", ...)
--   - display_order : ordem no painel (nao e limite)
--   - status        : session_status efetivo derivado de whatsapp_sessions;
--                     LEFT JOIN + COALESCE => 'DISCONNECTED' quando nao ha
--                     sessao registrada para a instancia.
--
-- Data-driven: itera as linhas habilitadas (WHERE enabled = true); nenhuma
-- contagem fixa, nenhum LIMIT. A quantidade exibida deriva exclusivamente das
-- linhas presentes (Req 29.1, 29.2, 29.7).
CREATE OR REPLACE FUNCTION whatsapp_list_instances()
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

  -- (b) Projecao data-driven: uma entrada por instancia habilitada, ordenada
  --     por display_order. O status vem da sessao unica da instancia
  --     (UNIQUE(instance_id) em whatsapp_sessions); sem sessao => DISCONNECTED.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',            i.id,
               'label',         i.label,
               'display_order', i.display_order,
               'status',        COALESCE(s.status::text, 'DISCONNECTED')
             )
             ORDER BY i.display_order
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM whatsapp_instances i
    LEFT JOIN whatsapp_sessions s ON s.instance_id = i.id
   WHERE i.enabled = true;

  RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION whatsapp_list_instances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_list_instances() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFY (smoke test manual; nao executado automaticamente)
-- ----------------------------------------------------------------------------
/*
-- Como admin com SETTINGS_VIEW, deve retornar um array ordenado por
-- display_order, status 'DISCONNECTED' nas instancias sem sessao:
SELECT jsonb_pretty(whatsapp_list_instances());

-- Sem permissao, deve lancar permission_denied e gravar WHATSAPP_VIEW_DENIED:
SELECT * FROM admin_audit_logs
 WHERE action = 'WHATSAPP_VIEW_DENIED'
 ORDER BY created_at DESC LIMIT 1;
*/
