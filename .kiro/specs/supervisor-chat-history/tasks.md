# Tasks — Histórico de Conversas da IA Supervisora (migration 119)

- [ ] 1. Spec (requirements/design/tasks) — este conjunto.
- [ ] 2. Migration 119 `119_supervisor_chat_history.sql` (+ `_rollback`):
  - 2 tabelas (`supervisor_chat_sessions`, `supervisor_chat_messages`) + CHECKs +
    índices + trigger `supervisor_touch_updated_at` (reusa de 118).
  - RLS por dono (SELECT sob SUPERVISOR_VIEW + admin_id=auth.uid()); `no_dml`.
  - 6 RPCs SECURITY DEFINER (create/list sessions, list/append messages,
    rename/delete) com gate + REVOKE/GRANT. Audit em create/delete.
  - `DO $check$` defensivo (030 + 118). Idempotente. Par `_rollback`.
- [ ] 3. Núcleo puro `src/services/admin/supervisor/chatHistory.ts` (deriveTitle,
  compareSessions, compareMessages, validateMessage, CHAT_LIMITS) +
  property tests CP1–CP3 + `pureFunctions.unit`.
- [ ] 4. Service: tipos + funções em `supervisor.ts` + `sanitizeSupervisorContent`
  (reusa padrões de sanitize) + testes (mapError/listas/append/delete `_SKIPPED`/
  audit-fail).
- [ ] 5. UI: `SupervisorChatPage` com sidebar de conversas (lista, nova, abrir,
  renomear/excluir) + persistência ao perguntar; degradação preservada. + testes.
- [ ] 6. Integração `tests/admin/supervisor/` (CI; describeIntegration): RLS por
  dono, gating 42501, append toca updated_at, delete idempotente CASCADE,
  rename/delete não-dono = 0 linhas, migration 119 schema.
- [ ] 7. Docs + cobertura + checkpoint: migrations/README 119, tests/README
  (Regression_Suite), coverage.config (chatHistory) + tsc/build/lint/testes
  verdes + commit (SEM aplicar em prod — aguarda o dono).

## Dependências
- 2 depende de 1. 3 independe (puro). 4 depende de 3 + migration (assinaturas).
- 5 depende de 4. 6 depende de 2. 7 fecha.

## Deploy (pós-merge, ação do dono)
- Aplicar `119_supervisor_chat_history.sql` em produção (SQL Editor ou Management
  API). NÃO há redeploy de edge function (persistência é frontend-driven).
