-- ============================================================================
-- WhatsApp — Script de GO-LIVE (rodar no SQL Editor do Supabase)
-- ============================================================================
-- COMO USAR:
--   1. Abra o painel do Supabase do projeto  ->  menu "SQL Editor"  ->  "New query".
--   2. Troque os <PREENCHA_...> pelos seus valores reais.
--   3. Rode BLOCO por BLOCO (selecione o bloco e clique em "Run").
--
-- IMPORTANTE:
--   - NAO commite este arquivo com os valores reais preenchidos (sao segredos).
--   - Os "segredos globais" (BLOCO 1) sao do projeto inteiro.
--   - Os "segredos por instancia" (BLOCO 3) sao 1 conjunto por numero de WhatsApp.
--   - <project-ref> e o codigo do seu projeto Supabase (aparece na URL do painel
--     e em Project Settings; a URL fica https://<project-ref>.supabase.co).
-- ============================================================================


-- ============================================================================
-- BLOCO 1 — Segredos GLOBAIS (rode uma vez)
-- ----------------------------------------------------------------------------
-- Se algum ja existir e voce quiser TROCAR o valor, veja o BLOCO 1B (update).
-- ============================================================================

-- URL do servidor da Evolution API (ex.: https://evolution.suaempresa.com)
select vault.create_secret('<PREENCHA_URL_DA_EVOLUTION>', 'whatsapp_evolution_url', 'WhatsApp Evolution base URL');

-- Token que a Evolution vai mandar no webhook (VOCE inventa um texto forte e secreto).
-- Esse MESMO valor vai ser configurado na Evolution depois (passo do webhook).
select vault.create_secret('<PREENCHA_UM_TOKEN_SECRETO_DO_WEBHOOK>', 'whatsapp_webhook_token', 'WhatsApp webhook token');

-- URL da Edge Function do worker (troque so o <project-ref>):
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/whatsapp-job-worker', 'whatsapp_worker_url', 'WhatsApp worker URL');

-- Segredo de invocacao do worker (VOCE inventa outro texto forte e secreto).
select vault.create_secret('<PREENCHA_OUTRO_SEGREDO_DO_WORKER>', 'whatsapp_worker_secret', 'WhatsApp worker secret');


-- ============================================================================
-- BLOCO 1B — (opcional) TROCAR um segredo global que JA existe
-- ----------------------------------------------------------------------------
-- Use SO se o BLOCO 1 reclamar que o nome ja existe e voce quiser atualizar.
-- Troque 'whatsapp_evolution_url' pelo nome do segredo e o valor.
-- ============================================================================
-- do $$
-- declare v_id uuid;
-- begin
--   select id into v_id from vault.secrets where name = 'whatsapp_evolution_url';
--   perform vault.update_secret(v_id, '<NOVO_VALOR>', 'whatsapp_evolution_url', 'WhatsApp Evolution base URL');
-- end $$;


-- ============================================================================
-- BLOCO 2 — Ver as instancias (copie o "id" de cada numero de WhatsApp)
-- ============================================================================
select id, label, display_order
  from whatsapp_instances
 where enabled
 order by display_order;


-- ============================================================================
-- BLOCO 3 — Segredos POR INSTANCIA (repita para cada id do BLOCO 2)
-- ----------------------------------------------------------------------------
-- Troque <instance_id> pelo id copiado acima (nos DOIS lugares: valor e nome).
-- A chave da Evolution e obrigatoria. A chave de IA so se voce quiser a
-- resposta automatica por IA (senao pode pular).
-- ============================================================================

-- Chave da Evolution API desta instancia:
select vault.create_secret('<PREENCHA_CHAVE_EVOLUTION_DESTA_INSTANCIA>', 'whatsapp_evolution_key_<instance_id>', 'Evolution key da instancia');

-- (opcional) Chave de IA (ex.: OpenAI) desta instancia:
-- select vault.create_secret('<PREENCHA_CHAVE_DE_IA>', 'whatsapp_ai_key_<instance_id>', 'AI key da instancia');


-- ============================================================================
-- BLOCO 4 — CONFERIR se ficou tudo certo (smoke test, so leitura)
-- ============================================================================

-- 4.1 As extensoes do agendador estao ligadas? (espera pg_cron e pg_net)
select extname from pg_extension where extname in ('pg_cron', 'pg_net') order by extname;

-- 4.2 O agendamento do worker existe e esta ativo? (deve aparecer 1 linha, active = true)
select jobid, jobname, schedule, active from cron.job where jobname = 'whatsapp-job-worker-tick';

-- 4.3 Os segredos globais estao todos provisionados? (esperado: 4 linhas)
select name from vault.secrets
 where name in ('whatsapp_evolution_url', 'whatsapp_webhook_token', 'whatsapp_worker_url', 'whatsapp_worker_secret')
 order by name;

-- 4.4 As chaves por instancia estao provisionadas? (1 linha por instancia configurada)
select name from vault.secrets where name like 'whatsapp_evolution_key_%' order by name;

-- 4.5 (apos conectar no painel) Status das sessoes por instancia:
select instance_id, status, last_connected_at from whatsapp_sessions order by updated_at desc;
