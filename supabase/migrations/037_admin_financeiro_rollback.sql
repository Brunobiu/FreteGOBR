-- ============================================================================
-- Migration 037 -- ROLLBACK (Admin Financeiro)
-- ============================================================================
-- ATENCAO: este arquivo e DOCUMENTACAO. NAO e auto-aplicado pela CI / Supabase
-- push. O Supabase aplica migrations cujo nome corresponde ao padrao
-- ^[0-9]+_<nome>\.sql -- o sufixo "_rollback" mantem este script fora do
-- pipeline. Por isso o numero "037" aqui apenas indica a migration que ele
-- reverte, nao ocupa um slot proprio na sequencia.
--
-- COMO USAR (recovery manual, apos backup completo de admin_audit_logs e
-- financial_repasses):
--   1. Copie o conteudo deste arquivo.
--   2. Crie uma migration nova com numero sequencial real -- por exemplo,
--      038_rollback_037.sql -- com o conteudo abaixo (ajustando o cabecalho).
--   3. Aplique a nova migration via supabase db push / CI.
--   NAO renomear este arquivo; ele e referencia documental do par 037.
--
-- O QUE ESTE SCRIPT FAZ (ordem reversa de dependencias para evitar erro de
-- FK / referencias entre objetos):
--
--   1. DROP de 4 policies do bucket financial_proofs em storage.objects
--      (financial_proofs_select_view, _insert_edit, _update_edit,
--       _delete_blocked).
--   2. DROP do trigger on_frete_close_create_repasse em fretes + funcao
--      suporte trg_on_frete_close_create_repasse().
--   3. DROP CASCADE das 6 RPCs do modulo financeiro:
--        admin_financeiro_settings_get(),
--        admin_financeiro_settings_update(numeric, jsonb, timestamptz),
--        admin_repasse_mark_paid(uuid, text, text, text, timestamptz),
--        admin_repasse_estornar(uuid, text, timestamptz),
--        admin_repasses_list(jsonb),
--        admin_financeiro_summary(timestamptz, timestamptz).
--   4. DROP da funcao pura compute_commission_value(numeric, jsonb).
--   5. DROP CASCADE das tabelas financial_repasses, financial_settings
--      (cobre suas policies no_dml, indices e constraints).
--
-- O QUE ESTE SCRIPT NAO FAZ (intencional):
--   - NAO dropa o bucket financial_proofs nem seus objetos. O bucket
--     guarda comprovantes de pagamento que sao evidencia legal/auditoria
--     dos repasses ja efetuados. A decisao de apagar fisicamente a
--     evidencia e do operador e deve ser executada manualmente via
--     console Supabase (Storage > financial_proofs > Delete bucket),
--     com registro em ata fora do banco.
--   - NAO reverte alteracoes de is_admin_with_permission feitas em 036
--     ou anteriores -- a migration 037 NAO tocou is_admin_with_permission
--     (FINANCEIRO_VIEW e FINANCEIRO_EDIT ja existiam desde 030 na role
--     FINANCEIRO).
--   - NAO dropa indices auxiliares em fretes/users criados por outras
--     migrations.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. DROP das 4 policies do bucket financial_proofs em storage.objects
-- ============================================================================
-- Removidas primeiro porque dependem do bucket existir e da funcao
-- is_admin_with_permission. O bucket em si NAO e dropado (ver cabecalho).

DROP POLICY IF EXISTS financial_proofs_delete_blocked ON storage.objects;
DROP POLICY IF EXISTS financial_proofs_update_edit   ON storage.objects;
DROP POLICY IF EXISTS financial_proofs_insert_edit   ON storage.objects;
DROP POLICY IF EXISTS financial_proofs_select_view   ON storage.objects;


-- ============================================================================
-- 2. DROP do trigger em fretes + funcao suporte
-- ============================================================================
-- Trigger antes da funcao para que o Postgres nao reclame de dependencia
-- residual. Ambos foram criados juntos na sec. 5 da migration 037.

DROP TRIGGER  IF EXISTS on_frete_close_create_repasse ON fretes;
DROP FUNCTION IF EXISTS trg_on_frete_close_create_repasse();


-- ============================================================================
-- 3. DROP CASCADE das 6 RPCs do modulo financeiro
-- ============================================================================
-- CASCADE cobre eventuais views/funcoes externas que tenham passado a
-- referencia-las apos o deploy original (defensivo). Ordem: primeiro as
-- 4 RPCs que mutam (settings_update, mark_paid, estornar) e em seguida
-- as 2 RPCs STABLE de leitura (settings_get, list, summary).

DROP FUNCTION IF EXISTS admin_repasse_mark_paid(uuid, text, text, text, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS admin_repasse_estornar(uuid, text, timestamptz)               CASCADE;
DROP FUNCTION IF EXISTS admin_financeiro_settings_update(numeric, jsonb, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS admin_repasses_list(jsonb)                                    CASCADE;
DROP FUNCTION IF EXISTS admin_financeiro_summary(timestamptz, timestamptz)            CASCADE;
DROP FUNCTION IF EXISTS admin_financeiro_settings_get()                               CASCADE;


-- ============================================================================
-- 4. DROP da funcao pura compute_commission_value
-- ============================================================================
-- Removida apos as RPCs e o trigger porque ambos a chamavam. IMMUTABLE,
-- sem efeitos colaterais; drop e seguro.

DROP FUNCTION IF EXISTS compute_commission_value(numeric, jsonb);


-- ============================================================================
-- 5. DROP CASCADE das tabelas financial_repasses e financial_settings
-- ============================================================================
-- financial_repasses primeiro: nao tem FK saindo dela para financial_settings
-- (o snapshot e copiado por valor no trigger), mas mantemos a ordem
-- "mais especifico antes do mais geral" por convencao. CASCADE limpa as
-- policies no_dml, os indices auxiliares (idx_financial_repasses_*,
-- idx_financial_settings_effective_from) e as 3 constraints de coerencia
-- de financial_repasses (chk_financial_repasses_paid_consistency,
-- _pendente_clean, _arithmetic).
--
-- IMPORTANTE: este drop e DESTRUTIVO. Todos os repasses historicos serao
-- perdidos. Garantir backup completo antes de aplicar.

DROP TABLE IF EXISTS financial_repasses CASCADE;
DROP TABLE IF EXISTS financial_settings CASCADE;


-- ============================================================================
-- 6. Bucket financial_proofs: PRESERVADO INTENCIONALMENTE
-- ============================================================================
-- O bucket privado financial_proofs e seus objetos NAO sao dropados aqui.
-- Comprovantes de pagamento de repasses sao evidencia legal/auditoria e
-- a decisao de apagar a evidencia fisica deve ser executada manualmente
-- pelo operador via console Supabase, com registro em ata fora do banco.
--
-- Para apagar manualmente apos este rollback (apenas se aprovado):
--   Console Supabase > Storage > financial_proofs > Settings > Delete bucket.

COMMIT;


-- ============================================================================
-- Pos-rollback: validar manualmente
-- ============================================================================
/*
-- Tabelas removidas
SELECT to_regclass('public.financial_settings'),
       to_regclass('public.financial_repasses');
-- Esperado: NULL, NULL

-- Funcoes removidas (6 RPCs + funcao pura + funcao do trigger)
SELECT proname
  FROM pg_proc
 WHERE proname IN (
   'admin_financeiro_settings_get',
   'admin_financeiro_settings_update',
   'admin_repasse_mark_paid',
   'admin_repasse_estornar',
   'admin_repasses_list',
   'admin_financeiro_summary',
   'compute_commission_value',
   'trg_on_frete_close_create_repasse'
 );
-- Esperado: 0 linhas

-- Trigger removido
SELECT tgname
  FROM pg_trigger
 WHERE tgname = 'on_frete_close_create_repasse'
   AND NOT tgisinternal;
-- Esperado: 0 linhas

-- Policies do storage.objects para o bucket financial_proofs
SELECT policyname
  FROM pg_policies
 WHERE schemaname = 'storage'
   AND tablename  = 'objects'
   AND policyname LIKE 'financial_proofs_%';
-- Esperado: 0 linhas

-- Bucket PRESERVADO (verificacao -- esperado retornar 1 linha)
SELECT id, name, public
  FROM storage.buckets
 WHERE id = 'financial_proofs';
-- Esperado: 1 linha (bucket nao foi dropado).
*/
