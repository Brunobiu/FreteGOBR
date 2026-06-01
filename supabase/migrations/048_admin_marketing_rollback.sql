-- ============================================================================
-- ROLLBACK Migration 048: admin-marketing
--
-- DOCUMENTACAO APENAS — NAO E AUTO-APLICADO.
-- (As migrations *_rollback.sql nao entram no pipeline de apply automatico do
--  Supabase / CI: o push aplica apenas arquivos cujo nome casa com
--  ^[0-9]+_<nome>\.sql -- o sufixo "_rollback" mantem este script fora do
--  pipeline. Por isso o numero "048" aqui so indica a migration que ele
--  reverte; nao ocupa um slot proprio na sequencia. Existe para reverter a
--  048 manualmente em caso de necessidade -- Req 13.7.)
--
-- COMO USAR (recovery manual, apos backup completo de marketing_config,
-- marketing_events e marketing_metrics_cache):
--   1. Copie o conteudo deste arquivo.
--   2. Crie uma migration nova com numero sequencial real -- por exemplo,
--      049_rollback_048.sql -- com o conteudo abaixo (ajustando o cabecalho),
--      OU rode os comandos a mao no SQL editor com plena ciencia do impacto.
--   3. Aplique a nova migration via supabase db push / CI.
--   NAO renomear este arquivo; ele e referencia documental do par 048.
--
-- Reverte, em ordem segura de dependencias, tudo o que a
-- 048_admin_marketing.sql adicionou:
--   - dropa as 3 policies RLS *_no_dml das 3 tabelas (secoes 2..4);
--   - dropa as 6 RPCs do modulo (secoes 6..8), com assinaturas completas
--     para desambiguar overloads;
--   - dropa os 2 indices auxiliares (secoes 3 e 4);
--   - dropa as 3 tabelas do modulo (secoes 2..4);
--   - NAO dropa is_admin_with_permission (fundacao compartilhada da 030 -- ver
--     secao 5 e o aviso abaixo).
--
-- !!! AVISO DE PERDA DE DADOS !!!
-- O DROP das tabelas marketing_events e marketing_metrics_cache DESTROI
-- permanentemente TODOS os dados do modulo: o log server-side de eventos CAPI
-- (com os hashes SHA-256 de PII) e todos os snapshots de metricas cacheados da
-- Meta. O DROP de marketing_config apaga a configuracao vigente da integracao
-- (ad_account_id, pixel_id, periodo default e a REFERENCIA token_secret_id ao
-- segredo no Vault). NAO ha como recuperar esses valores apos o COMMIT. Faca
-- backup das tabelas antes de rodar este rollback se houver intencao de
-- reaplicar a 048 preservando o estado.
--
-- !!! SEGREDO NO VAULT (REMOCAO MANUAL) !!!
-- Este rollback NAO remove o Meta_Access_Token gravado no Vault
-- (supabase_vault) sob o nome estavel `meta_access_token`. O Vault e um cofre
-- compartilhado e a remocao de segredos e uma operacao sensivel e
-- deliberadamente MANUAL: dropar as tabelas apaga apenas a REFERENCIA
-- (marketing_config.token_secret_id), nunca o segredo em si, que continuaria
-- orfao no Vault. Para limpa-lo, veja o bloco opcional comentado ao final deste
-- arquivo (secao 6) e execute-o a mao com plena ciencia do impacto.
--
-- ORDEM DE DEPENDENCIAS (por que esta sequencia):
--   1. Dropar as policies RLS primeiro: explicitadas por documentacao (o DROP
--      TABLE da secao 4 as removeria em cascata, mas listamos para deixar o
--      teardown auto-documentado -- admin-patterns Sec. 9 -- e idempotente).
--   2. Dropar as 6 RPCs: nenhuma policy/tabela depende delas; o DROP FUNCTION
--      nao valida o corpo, entao pode preceder o drop das tabelas referenciadas.
--   3. Dropar os 2 indices: explicitos por documentacao (o DROP TABLE tambem os
--      removeria em cascata); IF EXISTS para idempotencia.
--   4. Dropar as 3 tabelas: sem FKs internas entre elas (apenas
--      marketing_config.updated_by -> users(id), FK EXTERNA com ON DELETE SET
--      NULL), logo a ordem entre as tres e indiferente; mantemos a ordem de
--      declaracao da 048.
--   5. is_admin_with_permission: NAO e dropada (ver secao 5).
--
-- Idempotente: todos os passos usam IF EXISTS e podem ser reexecutados sem erro.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DROP das 3 policies RLS *_no_dml (secoes 2.., 3.., 4.. da 048)
-- ============================================================================
-- O DROP TABLE da secao 4 removeria estas policies em cascata; listamos
-- explicitamente para deixar o teardown auto-documentado (admin-patterns
-- Sec. 9) e idempotente (DROP POLICY IF EXISTS). Todas eram FOR ALL
-- USING(false) WITH CHECK(false) -- bloqueio total de DML direto.

DROP POLICY IF EXISTS marketing_config_no_dml        ON marketing_config;
DROP POLICY IF EXISTS marketing_events_no_dml        ON marketing_events;
DROP POLICY IF EXISTS marketing_metrics_cache_no_dml ON marketing_metrics_cache;


-- ============================================================================
-- 2. DROP das 6 RPCs do modulo (secoes 6..8 da 048)
-- ============================================================================
-- Assinaturas completas para desambiguar (DROP FUNCTION exige os tipos dos
-- args). Nenhuma policy/tabela depende destas funcoes; o DROP FUNCTION nao
-- valida o corpo, portanto pode preceder o drop das tabelas referenciadas.

-- 2.1 - RPCs de configuracao (secao 6): get (STABLE) + update otimista.
DROP FUNCTION IF EXISTS marketing_config_get();
DROP FUNCTION IF EXISTS marketing_config_update(text, text, text, boolean, timestamptz);

-- 2.2 - RPCs de token via Vault (secao 7): set (cria/atualiza) + clear (apaga).
DROP FUNCTION IF EXISTS marketing_token_set(text, timestamptz);
DROP FUNCTION IF EXISTS marketing_token_clear(timestamptz);

-- 2.3 - RPCs helper de cache server-only (secao 8): read (STABLE) + write.
DROP FUNCTION IF EXISTS marketing_cache_read(text, text, integer);
DROP FUNCTION IF EXISTS marketing_cache_write(text, text, jsonb);


-- ============================================================================
-- 3. DROP dos 2 indices auxiliares (secoes 3 e 4 da 048)
-- ============================================================================
-- O DROP TABLE da secao 4 tambem removeria estes indices em cascata; listamos
-- explicitamente para o teardown ficar auto-documentado e idempotente.

DROP INDEX IF EXISTS idx_marketing_events_event_time;
DROP INDEX IF EXISTS idx_marketing_metrics_cache_lookup;


-- ============================================================================
-- 4. DROP das 3 tabelas do modulo (secoes 2..4 da 048)
-- ============================================================================
-- !!! PERDA DE DADOS IRREVERSIVEL !!! (ver aviso no cabecalho)
--
-- Nao ha FK interna ENTRE as 3 tabelas; a unica FK e EXTERNA
-- (marketing_config.updated_by -> users(id) ON DELETE SET NULL), que nao
-- impede o drop. Portanto a ordem entre as tres e indiferente: mantemos a
-- ordem de declaracao da 048 (config, events, metrics_cache). DROP TABLE IF
-- EXISTS (sem CASCADE) basta -- as policies e indices ja foram removidos
-- explicitamente acima; nao ha views/objetos externos dependentes criados pela
-- 048.

DROP TABLE IF EXISTS marketing_config;
DROP TABLE IF EXISTS marketing_events;
DROP TABLE IF EXISTS marketing_metrics_cache;


-- ============================================================================
-- 5. is_admin_with_permission: PRESERVADA INTENCIONALMENTE (NAO dropar)
-- ============================================================================
-- A 048 (secao 5) recriou is_admin_with_permission via CREATE OR REPLACE
-- APENAS para documentar a paridade MARKETING_VIEW / MARKETING_EDIT da
-- Permission_Matrix -- SEM nenhuma mudanca comportamental: MARKETING_* ja era
-- concedida por construcao a SUPER_ADMIN (wildcard) e a ADMIN (NOT IN
-- deny-list), e negada por deny-by-default aos demais papeis, exatamente como
-- antes da 048. O corpo recriado e identico ao da 047 (que ja continha
-- ASSISTANT_*).
--
-- Por isso este rollback NAO dropa NEM reverte is_admin_with_permission:
--   - e fundacao COMPARTILHADA introduzida na migration 030, da qual dependem
--     TODAS as RPCs gated de TODOS os modulos admin (users, fretes, blacklist,
--     dashboard, financeiro, assistant, ...). Dropa-la quebraria o painel
--     inteiro;
--   - a 048 nao alterou seu comportamento, entao nao ha o que reverter.
-- Deixa-la como esta e seguro e correto. (Se o objetivo for tambem desfazer a
-- 047, use o 047_admin_assistant_rollback.sql, que reverte a funcao ao corpo
-- da 030.)


COMMIT;


-- ============================================================================
-- 6. (MANUAL / OPCIONAL) Remover o segredo do Meta_Access_Token no Vault
-- ============================================================================
-- !!! NAO EXECUTADO POR ESTE SCRIPT !!! Dropar as tabelas acima apaga apenas a
-- REFERENCIA (marketing_config.token_secret_id), nunca o segredo em si, que
-- ficaria orfao no Vault. Remocao de segredos do Vault e uma operacao sensivel
-- e deliberadamente manual. Descomente e rode a mao SOMENTE se tiver certeza de
-- que o Meta_Access_Token deve ser destruido. (Apos remove-lo, reconfigurar o
-- modulo Marketing exigira recolar o token.)
/*
DELETE FROM vault.secrets WHERE name = 'meta_access_token';
*/


-- ============================================================================
-- VERIFY (apos rollback; permanentemente comentado)
-- ============================================================================
-- Reaplicar manualmente para confirmar o teardown. Mantido comentado.
/*
-- (a) Tabelas removidas: deve retornar 0 linhas.
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('marketing_config','marketing_events','marketing_metrics_cache');

-- (b) Indices removidos: deve retornar 0 linhas.
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('idx_marketing_events_event_time','idx_marketing_metrics_cache_lookup');

-- (c) RPCs removidas: deve retornar 0 linhas.
SELECT proname FROM pg_proc
 WHERE proname IN (
   'marketing_config_get','marketing_config_update',
   'marketing_token_set','marketing_token_clear',
   'marketing_cache_read','marketing_cache_write');

-- (d) Policies removidas (cascata pelo DROP TABLE, mas confirmamos): 0 linhas.
SELECT policyname FROM pg_policies
 WHERE tablename IN ('marketing_config','marketing_events','marketing_metrics_cache');

-- (e) is_admin_with_permission PRESERVADA (esperado: 1 linha -- continua existindo).
SELECT proname FROM pg_proc WHERE proname = 'is_admin_with_permission';

-- (f) Segredo do Meta no Vault (se NAO removido manualmente, lista aqui):
SELECT name FROM vault.decrypted_secrets WHERE name = 'meta_access_token';
*/
