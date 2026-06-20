# Implementation Plan — IA Supervisora (`admin-ia-supervisora`)

Plano incremental. Cada tarefa entrega código + testes (unit/property/falha) e respeita
`testing-governance`, `project-conventions`, `admin-patterns`. CPs obrigatórias CP1–CP9 (≥100 runs),
helpers canônicos reusados, validação em duas pontas. Depende de 030/041/047/117.

- [ ] 1. Migration 118 (`118_admin_ia_supervisora.sql`) + par rollback
  - [ ] 1.1 Bloco `DO $check$` (dependências 030/117 duras; 041/047 macias) + `supervisor_touch_updated_at`.
  - [ ] 1.2 Tabela `supervisor_diagnostics` (CHECK severity; `UNIQUE(dedup_key)`; índices; trigger).
  - [ ] 1.3 Tabela `supervisor_insights` (CHECK type/severity/state; índice único PARCIAL de dedup
    `WHERE state IN ('OPEN','ACKNOWLEDGED')`; índices; trigger).
  - [ ] 1.4 RLS admin-only (`*_select_admin` SUPERVISOR_VIEW + `*_no_dml`) nas duas tabelas.
  - [ ] 1.5 Re-asserção de `is_admin_with_permission` PRESERVANDO o corpo on-disk (030+115+116+117);
    `SUPERVISOR_VIEW`/`SUPERVISOR_MANAGE` por construção.
  - [ ] 1.6 RPCs `SECURITY DEFINER`: `supervisor_record_diagnostic`, `supervisor_diagnostics_list`,
    `supervisor_insights_list`, `supervisor_chat_context`, `supervisor_evaluate`,
    `supervisor_generate_summary`, `supervisor_insight_acknowledge`, `supervisor_insight_dismiss`
    (gating + log negativo + `IF v_caller IS NOT NULL` no caminho cron; `REVOKE/GRANT`).
  - [ ] 1.7 pg_cron defensivo (`supervisor-evaluate-tick` 5min + `supervisor-daily-summary`) + bloco
    `-- VERIFY` comentado.
  - [ ] 1.8 Par `118_admin_ia_supervisora_rollback.sql` documentado (não auto-aplicado).
  - _Requirements: 3, 5, 8, 9, 11, 12, 14_

- [ ] 2. Núcleo puro `src/services/admin/supervisor/` + property tests
  - [ ] 2.1 `severityClassifier.ts` (`classifySeverity`/`notifyImmediately`/`CRITICAL_MODULES_SET`).
  - [ ] 2.2 `anomalyDetector.ts` (`detectAnomalies`/`reconcileInsights`/`dedupKey`/`ALERT→ANOMALY`).
  - [ ] 2.3 `insightLifecycle.ts` (`applyInsightOp`).
  - [ ] 2.4 `summaryBuilder.ts` (`buildSummaryText`/`summaryDedupKey`).
  - [ ] 2.5 `ordering.ts` (`compareInsights`/`compareDiagnostics`/`SEVERITY_RANK`).
  - [ ] 2.6 `questionContextPlan.ts` (`planIntents`/`CONTEXT_INTENTS`).
  - [ ] 2.7 `sanitize.ts` (`sanitizeSupervisorDetail`).
  - [ ] 2.8 delta `permissions.ts`: `SUPERVISOR_VIEW`/`SUPERVISOR_MANAGE` no `ADMIN_ACTIONS`.
  - [ ] 2.9 Property tests CP1–CP5/CP8/CP9 + `pureFunctions.unit.test.ts` + `_generators.ts`.
  - _Requirements: 4, 5, 8, 10.1, 2.1; Correctness Properties CP1–CP5, CP8, CP9_

- [ ] 3. Checkpoint — lógica pura verde (tsc + testes supervisor + lint).

- [ ] 4. Service `src/services/admin/supervisor.ts` + CP6/CP7 + cenários de falha
  - [ ] 4.1 `SupervisorError`/`mapSupervisorError`/`SUPERVISOR_ERROR_MESSAGES`.
  - [ ] 4.2 Tipos `SupervisorDiagnostic`/`SupervisorInsight` (snake_case) + filtros.
  - [ ] 4.3 Leituras `listDiagnostics`/`listInsights`/`getSupervisorContext`/`askSupervisor`.
  - [ ] 4.4 Mutações `acknowledgeInsight`/`dismissInsight` (runSkippableMutation) +
    `triggerEvaluate`/`generateSummary`/`recordDiagnostic`.
  - [ ] 4.5 EXPORT puros reusados; `permissions_supervisor.unit.test.ts`.
  - [ ] 4.6 `cp6_permission_precedence` + `cp7_isolation_no_leak` + `supervisor_service.test.ts`
    (STALE/INVALID/_SKIPPED/audit-fail-não-bloqueia/degradação do chat).
  - _Requirements: 2, 9, 11, 13.3; Correctness Properties CP6, CP7_

- [ ] 5. Checkpoint — backend + service verde.

- [ ] 6. Edge function `supabase/functions/ia-supervisor/index.ts`
  - Gating `SUPERVISOR_VIEW`; `supervisor_chat_context`; prompt + `Provider_Abstraction`; degradação
    sem provider; loga `SUPERVISOR_CHAT_QUERY`; nunca envia PII.
  - _Requirements: 2_

- [ ] 7. UI `src/components/admin/supervisor/` + páginas + rotas + sidebar
  - [ ] 7.1 `InsightSeverityBadge`/`InsightStateBadge` + `SupervisorNav`.
  - [ ] 7.2 `SupervisorChatPage` (chat read-only + indisponível).
  - [ ] 7.3 `SupervisorDiagnosticsPage` (read-only, filtros popover, paginação).
  - [ ] 7.4 `SupervisorInsightsPage` (lista, filtros, Reconhecer/Descartar gated, "Avaliar agora").
  - [ ] 7.5 `SupervisorSummaryPage` (último resumo + "Gerar agora").
  - [ ] 7.6 Rotas em `AdminLayoutRoute` + item "Supervisor" em `AdminSidebar` (gated SUPERVISOR_VIEW).
  - _Requirements: 1, 2, 3, 6, 7, 8, 9, 10_

- [ ] 8. Testes de UI (`supervisorUI.test.tsx`)
  - Stealth_404 nas 4 páginas; chat indisponível; diagnóstico read-only; ack/dismiss gated; filtro
    inválido bloqueia + pt-BR; paginação default 10; sem `<h1>`; item sidebar.
  - _Requirements: 1, 2, 3, 9, 10, 15_

- [ ] 9. Testes de integração (`tests/admin/supervisor/`, CI)
  - RLS; gating/42501; `record_diagnostic` idempotente; `evaluate` dedup/auto-dismiss +
    `SUPERVISOR_INSIGHT_GENERATED`; ack/dismiss `_SKIPPED`/positivo; `generate_summary` idempotente;
    paridade RBAC; migration 118 idempotência; master imutável.
  - _Requirements: 3, 5, 8, 9, 11, 12, 13, 14_

- [ ] 10. Checkpoint final — Regression_Suite + cobertura + docs
  - Medir cobertura dos módulos puros → `Critical_Module` em `tests/coverage.config.ts`; seção em
    `tests/README.md`; entrada 118 em `supabase/migrations/README.md`; tsc + build + lint + testes
    verdes.
  - _Requirements: 15_
