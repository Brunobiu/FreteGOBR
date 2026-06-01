-- =====================================================
-- ROLLBACK Migration 047: admin-assistant
--
-- DOCUMENTACAO APENAS — NAO E AUTO-APLICADO.
-- (As migrations *_rollback.sql nao entram no pipeline de apply automatico;
--  este arquivo existe para reverter manualmente a 047 em caso de
--  necessidade — Req 15.9.)
--
-- Reverte, em ordem segura de dependencias, tudo o que a
-- 047_admin_assistant.sql adicionou:
--   - desagenda o Cron_Job pg_cron 'assistant_monitor_job' (secao 8.2);
--   - dropa as 11 RPCs rpc_assistant_* (secoes 3..7), com assinaturas
--     completas para desambiguar overloads;
--   - dropa as policies RLS Owner_Only_Gate das 5 tabelas (secao 2.6);
--   - dropa as 5 tabelas do modulo em ORDEM REVERSA de dependencia
--     (secao 2): assistant_messages e assistant_critical_events ANTES de
--     assistant_conversations (FK), error_logs e assistant_config sem FK
--     interna;
--   - reverte is_admin_with_permission para o corpo ANTERIOR (migration 030),
--     removendo ASSISTANT_VIEW/ASSISTANT_EDIT da lista de exclusao do ramo
--     ADMIN (secao 1).
--
-- !!! AVISO DE PERDA DE DADOS !!!
-- O DROP das tabelas error_logs, assistant_conversations, assistant_messages
-- e assistant_critical_events DESTROI permanentemente TODOS os dados do
-- assistente: o historico de erros de frontend capturados, todas as conversas
-- e mensagens do chat, e todos os eventos criticos detectados pelo monitor.
-- NAO ha como recuperar esses valores apos o COMMIT. Faca backup das tabelas
-- antes de rodar este rollback se houver intencao de reaplicar a 047
-- preservando o estado.
--
-- !!! SEGREDOS NO VAULT (REMOCAO MANUAL) !!!
-- Este rollback NAO remove os segredos das chaves de API gravados no Vault
-- (supabase_vault) sob o nome `assistant_provider_key_<provider>`
-- (claude/gemini/grok/llama). O Vault e um cofre compartilhado e a remocao de
-- segredos e uma operacao sensivel e deliberadamente MANUAL. Para limpa-los,
-- veja o bloco opcional comentado ao final deste arquivo e execute-o a mao
-- com plena ciencia do impacto.
--
-- ORDEM DE DEPENDENCIAS (por que esta sequencia):
--   1. Desagendar o Cron_Job primeiro: independe das tabelas/funcoes e evita
--      que o monitor dispare durante o teardown.
--   2. Dropar as 11 RPCs: nenhuma policy/tabela depende delas; o DROP FUNCTION
--      nao valida o corpo, entao pode preceder o drop das tabelas referenciadas.
--   3. Dropar as policies RLS: explicitadas por documentacao (o DROP TABLE da
--      secao 4 as removeria em cascata, mas listamos para deixar o teardown
--      auto-documentado e idempotente).
--   4. Dropar as 5 tabelas em ordem reversa de dependencia (dependentes da FK
--      assistant_conversations primeiro).
--   5. Reverter is_admin_with_permission por ultimo: CREATE OR REPLACE mantem
--      a mesma assinatura; as policies que a referenciavam ja foram removidas.
--
-- Idempotente: todos os passos usam IF EXISTS / OR REPLACE / guardas
-- defensivas e podem ser reexecutados sem erro.
-- =====================================================

BEGIN;

-- ========== 1. Desagendar o Cron_Job 'assistant_monitor_job' (secao 8.2) ==========
--
-- Guarda defensiva: pg_cron pode nao existir no ambiente (ex.: shadow DB de
-- testes) e o job pode nunca ter sido agendado (a secao 8.2 so agenda quando
-- pg_cron + pg_net + Vault estao presentes). So desagenda quando a extensao e
-- o job de fato existem; caso contrario emite WARNING e segue.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron ausente: nada a desagendar (assistant_monitor_job nunca foi criado)';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assistant_monitor_job') THEN
    PERFORM cron.unschedule('assistant_monitor_job');
  ELSE
    RAISE WARNING 'Cron_Job assistant_monitor_job nao encontrado: nada a desagendar';
  END IF;
END
$cron$;


-- ========== 2. Dropar as 11 RPCs rpc_assistant_* (secoes 3..7) ==========
--
-- Assinaturas completas para desambiguar (DROP FUNCTION exige tipos dos args).
-- Nenhuma policy/tabela depende destas funcoes; o DROP FUNCTION nao valida o
-- corpo, portanto pode preceder o drop das tabelas referenciadas no corpo.

-- 2.1 - Error_Ingest (secao 3)
DROP FUNCTION IF EXISTS rpc_assistant_ingest_errors(jsonb);

-- 2.2 - Config get/update (secao 4)
DROP FUNCTION IF EXISTS rpc_assistant_get_config();
DROP FUNCTION IF EXISTS rpc_assistant_update_config(jsonb, timestamptz);

-- 2.3 - Segredos / Vault (secao 5)
DROP FUNCTION IF EXISTS rpc_assistant_set_secret(text, text);
DROP FUNCTION IF EXISTS rpc_assistant_clear_secret(text);
DROP FUNCTION IF EXISTS rpc_assistant_read_provider_key(text);

-- 2.4 - Conversa / mensagem (secao 6)
DROP FUNCTION IF EXISTS rpc_assistant_list_conversations();
DROP FUNCTION IF EXISTS rpc_assistant_load_conversation(uuid);
DROP FUNCTION IF EXISTS rpc_assistant_post_message(uuid, text, text);

-- 2.5 - Evento critico / status (secao 7)
DROP FUNCTION IF EXISTS rpc_assistant_persist_critical_event(jsonb);
DROP FUNCTION IF EXISTS rpc_assistant_get_status();


-- ========== 3. Dropar as policies RLS Owner_Only_Gate (secao 2.6) ==========
--
-- O DROP TABLE da secao 4 removeria estas policies em cascata; listamos
-- explicitamente para deixar o teardown auto-documentado (admin-patterns
-- Sec. 9) e idempotente (DROP POLICY IF EXISTS).

-- 3.1 - error_logs (somente SELECT sob ASSISTANT_VIEW)
DROP POLICY IF EXISTS error_logs_select_owner ON error_logs;

-- 3.2 - assistant_conversations
DROP POLICY IF EXISTS assistant_conversations_select_owner ON assistant_conversations;
DROP POLICY IF EXISTS assistant_conversations_mutate_owner ON assistant_conversations;

-- 3.3 - assistant_messages
DROP POLICY IF EXISTS assistant_messages_select_owner ON assistant_messages;
DROP POLICY IF EXISTS assistant_messages_mutate_owner ON assistant_messages;

-- 3.4 - assistant_critical_events
DROP POLICY IF EXISTS assistant_critical_events_select_owner ON assistant_critical_events;
DROP POLICY IF EXISTS assistant_critical_events_mutate_owner ON assistant_critical_events;

-- 3.5 - assistant_config (SELECT sob ASSISTANT_VIEW; escrita sob ASSISTANT_EDIT)
DROP POLICY IF EXISTS assistant_config_select_owner ON assistant_config;
DROP POLICY IF EXISTS assistant_config_mutate_owner ON assistant_config;


-- ========== 4. Dropar as 5 tabelas em ordem REVERSA de dependencia (secao 2) ==========
--
-- !!! PERDA DE DADOS IRREVERSIVEL !!! (ver aviso no cabecalho)
--
-- FKs internas do modulo:
--   - assistant_messages.conversation_id        -> assistant_conversations(id) ON DELETE CASCADE
--   - assistant_critical_events.conversation_id -> assistant_conversations(id) ON DELETE SET NULL
--   - error_logs.affected_user_id               -> users(id) ON DELETE SET NULL  (FK EXTERNA)
--   - assistant_config                           -> sem FK
-- Portanto assistant_messages e assistant_critical_events sao dropadas ANTES de
-- assistant_conversations. error_logs e assistant_config nao tem dependentes
-- internos e podem ser dropadas a qualquer momento.

-- 4.1 - error_logs (sem dependentes internos)
DROP TABLE IF EXISTS error_logs;

-- 4.2 - assistant_messages (FK -> assistant_conversations): ANTES da pai.
DROP TABLE IF EXISTS assistant_messages;

-- 4.3 - assistant_critical_events (FK -> assistant_conversations): ANTES da pai.
DROP TABLE IF EXISTS assistant_critical_events;

-- 4.4 - assistant_conversations (pai das duas acima): depois dos dependentes.
DROP TABLE IF EXISTS assistant_conversations;

-- 4.5 - assistant_config (registro unico, sem FK).
DROP TABLE IF EXISTS assistant_config;


-- ========== 5. Reverter is_admin_with_permission ao corpo da migration 030 ==========
--
-- A 047 (secao 1) apenas acrescentou 'ASSISTANT_VIEW','ASSISTANT_EDIT' a lista
-- de exclusao do ramo ADMIN (p_action NOT IN (...)). Reverter ao corpo da
-- migration 030 remove essas duas acoes da exclusao — efetivamente apagando
-- qualquer vestigio das permissoes do assistente da matriz RBAC. CREATE OR
-- REPLACE mantem a mesma assinatura (text)->boolean; nao e necessario (nem
-- desejavel) DROPAR esta funcao, que e fundacao compartilhada da migration 030.
--
-- NOTA: este e o corpo EXATO da migration 030 (admin-foundation), que e o
-- estado imediatamente anterior ao que a 047 modificou (a 047 baseou-se nesse
-- corpo). Caso o ambiente tenha aplicado variacoes intermediarias desta funcao,
-- ajuste a allowlist abaixo para o estado pre-047 correto antes de executar.

CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH active AS (
    SELECT role
    FROM admin_roles
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_EDIT'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;


COMMIT;


-- ========== 6. (MANUAL / OPCIONAL) Remover os segredos do Vault ==========
--
-- !!! NAO EXECUTADO POR ESTE SCRIPT !!! Remocao de segredos do Vault e uma
-- operacao sensivel e deliberadamente manual. Descomente e rode a mao SOMENTE
-- se tiver certeza de que as chaves de API do assistente devem ser destruidas.
-- (Apos remove-las, reconfigurar o assistente exigira recolar as chaves.)
/*
DELETE FROM vault.secrets WHERE name LIKE 'assistant_provider_key_%';
*/


-- ========== VERIFY (apos rollback; permanentemente comentado) ==========
-- Reaplicar manualmente para confirmar o teardown. Mantido comentado.
/*
-- (a) Cron_Job desagendado: deve retornar 0 linhas (quando pg_cron presente).
SELECT jobname FROM cron.job WHERE jobname = 'assistant_monitor_job';

-- (b) RPCs removidas: deve retornar 0 linhas.
SELECT proname FROM pg_proc
 WHERE proname IN (
   'rpc_assistant_ingest_errors','rpc_assistant_get_config','rpc_assistant_update_config',
   'rpc_assistant_set_secret','rpc_assistant_clear_secret','rpc_assistant_read_provider_key',
   'rpc_assistant_list_conversations','rpc_assistant_load_conversation','rpc_assistant_post_message',
   'rpc_assistant_persist_critical_event','rpc_assistant_get_status');

-- (c) Tabelas removidas: deve retornar 0 linhas.
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('error_logs','assistant_conversations','assistant_messages',
                      'assistant_critical_events','assistant_config');

-- (d) Policies removidas: deve retornar 0 linhas.
SELECT policyname FROM pg_policies
 WHERE tablename IN ('error_logs','assistant_conversations','assistant_messages',
                     'assistant_critical_events','assistant_config');

-- (e) is_admin_with_permission revertida (NAO deve mais conter ASSISTANT_*):
SELECT pg_get_functiondef(oid) LIKE '%ASSISTANT_%' AS ainda_tem_assistant
  FROM pg_proc WHERE proname = 'is_admin_with_permission';  -- esperado: false

-- (f) Segredos do assistente no Vault (se NAO removidos manualmente, listam aqui):
SELECT name FROM vault.decrypted_secrets WHERE name LIKE 'assistant_provider_key_%';
*/
