-- ============================================================================
-- ROLLBACK da Migration 111 — RPCs do motor de disparo durável (tasks 12.2-12.5)
-- ----------------------------------------------------------------------------
-- Documentação de reversão (NÃO auto-aplicada). Desfaz apenas as RPCs de
-- resultado/finalização/varredura/recuperação criadas pela 111, preservando
-- todo o schema/dados das demais migrations (092 foundation, RPCs de claim 103,
-- demais RPCs 093..110). Aplicar manualmente no SQL editor do ambiente
-- hospedado se for necessário reverter as tasks 12.2-12.5.
--
-- IMPORTANTE: reverter estas RPCs "desliga" a finalização/recuperação do worker
-- (a Edge Function whatsapp-job-worker passa a falhar ao chamá-las). Reverta
-- apenas em conjunto com o redeploy do worker no estado esqueleto (task 12.1).
--
-- Idempotente: DROP FUNCTION IF EXISTS com as assinaturas exatas da 111. Nenhum
-- dado de whatsapp_dispatch_jobs/recipients/scheduled_dispatches é removido — o
-- rollback reverte apenas as funções, não o estado eventualmente gravado.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS whatsapp_worker_recover(int, int);
DROP FUNCTION IF EXISTS whatsapp_worker_sweep_scheduled(int);
DROP FUNCTION IF EXISTS whatsapp_worker_finalize_job(uuid);
DROP FUNCTION IF EXISTS whatsapp_worker_release_recipient(uuid);
DROP FUNCTION IF EXISTS whatsapp_worker_mark_failed(uuid, text);
DROP FUNCTION IF EXISTS whatsapp_worker_mark_sent(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS whatsapp_worker_job_snapshot(uuid);

COMMIT;
