# Implementation Plan: Central de Operação (`admin-central-operacao`)

## Overview

Plano incremental e orientado a teste que constrói a `Central_Operacao` em `/admin/operacao`
(partes 7/8/9 do documento do dono) **por cima** das fontes já em produção — `admin-dashboard` (036),
`whatsapp-automation` (092+), `notifications-hub`/`suporte-inteligente` (041/115),
`assinaturas-pagamento` (055) e `admin-foundation` (030) — sem recriá-las. Cada tarefa constrói sobre
as anteriores e termina com a fiação (wiring) nas páginas e na sidebar — sem código órfão.

Ordem de construção bottom-up (espelhando o design): **(1)** migration 117 completa
(schema/RBAC/RLS/trigger + 6 RPCs `SECURITY DEFINER` + `pg_cron`) + par rollback → **(2)** núcleo de
lógica pura TS + propriedades CP1–CP6, CP9, CP10 (e CP11\* opcional) → **(3)** service `operacao.ts` +
propriedades de fronteira CP7/CP8 + cenários de falha → **(4)** UI/páginas/rotas/sidebar → **(5)**
testes de integração (`tests/`) → **(6)** Regression_Suite + cobertura + documentação técnica.

Convenções de marcação (`project-conventions` + `testing-governance`): **CP1–CP10 são obrigatórias
(spec do painel) e NÃO levam `*`**; os únicos itens opcionais são **CP11\*** (atualização instantânea
via realtime, depende de infra externa), o **smoke da migration** (7.8\*) e o **roteiro E2E manual**
(8.2\*). Idioma: texto/UI/mensagens em pt-BR; identifiers, action codes e error codes em inglês
(UPPER_SNAKE).

Reuso obrigatório (nunca recriar): `executeAdminMutation` (`services/admin/audit.ts`),
`is_admin_with_permission` (030/036), `AdminGuard`/`Stealth_404`/`useAdminPermission`,
`DashboardKpiCard`/`DashboardBlockError`/`formatNumber` e o padrão `getMetrics`/`Partial_Degradation`
de `admin-dashboard`, versionamento otimista (`expected_updated_at`/`STALE_VERSION`), idempotência
`_SKIPPED`, master `Nexus_Vortex99` imutável, a UI compacta (sem `<h1>`, popover `SlidersHorizontal`,
paginação `10/50/100`) e os helpers de teste em `src/__tests__/_helpers/`
(`generators`/`authAssertions`/`logAssertions`/`auditAssertions`/`antiEnumeration`).

Migration: o design mantém **tudo na 117** (Req 14.4); `117b_...` é só sufixo de reserva caso
necessária uma segunda migration, preservando o `118` para a quarta spec (`admin-ia-supervisora`).

## Tasks

- [ ] 1. Migration 117 — schema, RBAC, RLS, trigger e RPCs `SECURITY DEFINER` (+ par rollback)
  - [ ] 1.1 Migration 117 (parte 1 — schema): criar `supabase/migrations/117_admin_central_operacao.sql`
    - `BEGIN; ... COMMIT;` + bloco `DO $check$` validando **dependências duras** `is_admin_with_permission` e `admin_audit_logs` (030), `admin_dashboard_metrics` (036), `users`, `subscriptions` (055) e `support_tickets` (041/115), com `RAISE EXCEPTION` clara quando ausente
    - bloco **macio** `DO $whatsapp_note$` com `RAISE NOTICE` quando `whatsapp_sessions` (092) ausente — degradação honesta em runtime, **não** aborta a migration
    - `CREATE TABLE IF NOT EXISTS system_alerts` com todas as colunas (`id` uuid pk, `alert_type`, `severity`, `state`, `source_type`, `source_id`, `dedup_key`, `title`, `detail` jsonb, `first_seen_at`, `last_seen_at`, `acknowledged_at/by`, `resolved_at/by`, `created_at`, `updated_at`) e `CHECK` dos domínios fechados (`alert_type` nos 6 tipos, `severity` em `{CRITICAL,WARNING,INFO}`, `state` em `{OPEN,ACKNOWLEDGED,RESOLVED}`)
    - índice **único parcial** `uq_system_alerts_active_dedup ON (dedup_key) WHERE state IN ('OPEN','ACKNOWLEDGED')` + `idx_system_alerts_list (state, severity, last_seen_at DESC)` + `idx_system_alerts_type`
    - função `operacao_touch_updated_at()` + trigger `trg_system_alerts_touch BEFORE UPDATE`
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.8, 14.1, 14.2, 14.3_

  - [ ] 1.2 Migration 117 (parte 2 — RBAC + RLS): append em `117_admin_central_operacao.sql`
    - `CREATE OR REPLACE FUNCTION is_admin_with_permission(text)` **preservando todas as branches de 036** e concedendo `ALERT_VIEW`/`ALERT_ACK`/`ALERT_RESOLVE`/`LOG_VIEW` **apenas** a `SUPER_ADMIN` (wildcard) e `ADMIN` (allow-all menos deny-list); as ações novas **não** entram na deny-list do ADMIN nem nas allowlists de `SUPORTE`/`FINANCEIRO`/`MODERADOR` (deny-by-default); `auth.uid()` nulo ⇒ falso; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`
    - RLS: `ENABLE ROW LEVEL SECURITY`; `DROP POLICY IF EXISTS` antes de `CREATE POLICY` — `system_alerts_select_admin` (SELECT `USING (is_admin_with_permission('ALERT_VIEW'))`) e `system_alerts_no_dml` (`FOR ALL USING(false) WITH CHECK(false)`); DML direto bloqueado para qualquer role `authenticated` (escrita só via RPC `SECURITY DEFINER`)
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 6.6, 6.7, 14.5_

  - [ ] 1.3 Migration 117 (parte 3 — RPCs de leitura): append em `117_admin_central_operacao.sql`
    - `admin_operations_metrics(p_online_window_sec int DEFAULT 300)` `SECURITY DEFINER STABLE`, gated `DASHBOARD_VIEW`; cada grupo (`users`/`subscriptions`/`tickets`/`messages`) em **sub-bloco** `BEGIN..EXCEPTION` ⇒ falha vira `errors[grupo]` e KPIs do grupo `available=false` (Partial_Degradation); calcula os 11 KPIs (`USERS_TOTAL`, `SIGNUPS_TODAY`/`Today_Window`, `SUBSCRIPTIONS_ACTIVE`/`SUBSCRIPTIONS_EXPIRED`, `TICKETS_OPEN/IN_PROGRESS/RESOLVED`, `MESSAGES_SENT/ERROR`/`Today_Window` e `MESSAGES_SCHEDULED`); `USERS_ONLINE` ⇒ `available=false` sem `Presence_Source`; **só contagens agregadas**, sem PII
    - `admin_alerts_list(p_state, p_type, p_severity, p_limit, p_offset)` gated `ALERT_VIEW`; ordena `severity` → `last_seen_at DESC` → `id` (desempate estável), `p_limit ∈ {10,50,100}` (default 10), backstop por RLS
    - `admin_logs_list(p_event_types, p_from, p_to, p_actor, p_target_type, p_limit, p_offset)` gated `LOG_VIEW`; resolve o `Log_Event_Map` para `action IN (...)` sobre `admin_audit_logs`, ordena `occurred_at DESC` + desempate estável, `summary` sem PII/segredos, `p_limit ∈ {10,50,100}`
    - postura §10 nas três: `SET search_path=public`; `auth.uid()` nulo ⇒ `permission_denied` (42501); log negativo `DASHBOARD_VIEW_DENIED`/`ALERT_VIEW_DENIED`/`LOG_VIEW_DENIED` (`before=NULL`, `after={user_id,reason}`) **antes** de abortar (precedência sobre validação de input); `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`, nunca `anon`
    - _Requirements: 1.10, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.6, 8.8, 10.1, 10.2, 10.4, 10.5, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 13.1, 13.5_

  - [ ] 1.4 Migration 117 (parte 4 — RPCs de avaliação/mutação + `pg_cron` + `-- VERIFY`): append em `117_admin_central_operacao.sql`
    - `admin_alerts_evaluate()` `SECURITY DEFINER VOLATILE`, invocável por **service-role** (`pg_cron`) **ou** sob demanda por `ALERT_VIEW`; cada fonte em sub-bloco `BEGIN..EXCEPTION` (falha grava `ALERT_SOURCE_FAILED` sem PII/segredos e **prossegue**, não aborta); insere `OPEN` + `ALERT_GENERATED`, atualiza só `last_seen_at` dos ativos (sem duplicar, via índice único parcial) e auto-resolve (`state=RESOLVED`, `resolved_at=now()`, `resolved_by=NULL`) os ativos sem situação correspondente
    - `admin_alert_acknowledge(p_id, p_expected_updated_at)` gated `ALERT_ACK`: `OPEN→ACKNOWLEDGED` com `expected_updated_at` (`STALE_VERSION`); já `ACKNOWLEDGED` ⇒ `{skipped, ALREADY_ACKNOWLEDGED}` + `ALERT_ACK_SKIPPED` na RPC; `RESOLVED` ⇒ `INVALID_STATE_TRANSITION` (terminal, não retorna a `ACKNOWLEDGED`); `NOT_FOUND` distinto
    - `admin_alert_resolve(p_id, p_expected_updated_at)` gated `ALERT_RESOLVE`: `OPEN`/`ACKNOWLEDGED → RESOLVED` (`resolved_by=auth.uid()`) com `expected_updated_at`; já `RESOLVED` ⇒ `{skipped, ALREADY_RESOLVED}` + `ALERT_RESOLVE_SKIPPED` na RPC
    - postura §10 em todas (com `FOR UPDATE` nas mutações); `admin_alerts_evaluate` também `GRANT EXECUTE TO service_role`; agendar `admin_alerts_evaluate` via `pg_cron` em intervalo fixo
    - bloco `-- VERIFY` comentado (regclass de `system_alerts`, índice único parcial, RLS/policies, RBAC reconhece as ações novas, presença das 6 RPCs, `GRANT/REVOKE` sem `anon`)
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 13.5, 14.4, 14.8_

  - [ ] 1.5 Par rollback `117_admin_central_operacao_rollback.sql` (documentado, não auto-aplicado)
    - `DROP FUNCTION` das 6 RPCs + `operacao_touch_updated_at`; `DROP POLICY` de `system_alerts`; `DROP INDEX` (`uq_system_alerts_active_dedup`, `idx_system_alerts_list`, `idx_system_alerts_type`); `DROP TABLE system_alerts`; desagendar o job `pg_cron`; restaurar `is_admin_with_permission` para a versão de 036 (sem as ações novas)
    - **não** tocar `users`, `subscriptions`, `support_tickets`, `admin_audit_logs` nem as tabelas de `whatsapp-automation`; bloco `-- VERIFY` comentado
    - _Requirements: 14.6, 14.7_

- [ ] 2. Núcleo de lógica pura (TS determinístico) e propriedades CP1–CP6, CP9, CP10
  - [ ] 2.1 `metricsShape.ts` — forma do bundle + disponibilidade
    - `src/services/admin/operacao/metricsShape.ts`: tipos (`OperationsKpiKey`, `OperationsGroupKey`, `DashboardKpi`, `OperationsMetricsBundle`, `RawKpi`), `KPI_GROUP`, `OPERATIONS_KPI_KEYS`, `buildKpi` (fonte indisponível ⇒ `{value:null, available:false}`) e `adaptOperationsBundle` (aplica `Partial_Degradation`: grupo em `errors` ⇒ todos os KPIs do grupo `available=false`, nunca `0`)
    - _Requirements: 3.1, 3.8, 3.9, 4.6, 4.7, 5.4_

  - [ ] 2.2 Teste de propriedade CP1 — determinismo das métricas operacionais
    - `src/__tests__/admin/operacao/cp1_metrics_shape.property.test.ts`, `numRuns: 100`, tag `// Feature: admin-central-operacao, Property 1`; geradores de registro cru por `OperationsKpiKey` (`value ∈ fc.option(fc.nat())`, `available: fc.boolean()`) + subconjunto aleatório de grupos em `errors`
    - **Property 1 (CP1): para o mesmo estado das fontes, `adaptOperationsBundle` produz sempre o mesmo bundle; KPI sem fonte ⇒ `{value:null, available:false}` (nunca `{value:0, available:true}`); grupo em `errors` força todos os seus KPIs a indisponíveis**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.4, 15.4**

  - [ ] 2.3 `realtimeRefresh.ts` — máquina do `Realtime_Refresh`
    - `src/services/admin/operacao/realtimeRefresh.ts`: `REFRESH_FLOOR_MS`, `DEFAULT_INTERVAL_MS`, tipos (`RefreshState`, `RefreshEvent`, `RefreshDecision`), `initRefresh` e `reduce` (pausa em aba oculta; `tick` só dispara `startFetch` se visível, `elapsed>=intervalMs` e `!inFlight`; `manual` reinicia `elapsedMs` e dispara salvo já em voo; `request_done` libera `inFlight`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 2.4 Teste de propriedade CP2 — não-sobreposição do `Realtime_Refresh`
    - `cp2_realtime_refresh.property.test.ts`, `numRuns: 100`, tag Property 2; `fc.array(eventGen)` (`tick`/`visibility`/`manual`/`request_done`), `intervalGen` incluindo valores abaixo do piso (edge 4.5), contador externo de in-flight que nunca excede 1
    - **Property 2 (CP2): para qualquer sequência de eventos, `reduce` nunca emite `startFetch` com `inFlight` verdadeiro (≤ 1 requisição em voo); atualizações automáticas só ocorrem com aba visível e após `intervalMs >= REFRESH_FLOOR_MS`; `manual` zera o temporizador**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [ ] 2.5 `alertEvaluator.ts` — `Alert_Evaluator` + `Alert_Severity_Map` + `dedupKey` + reconciliação
    - `src/services/admin/operacao/alertEvaluator.ts`: tipos (`AlertType`, `AlertSeverity`, `AlertState`, `AlertSource`, `ActiveSituation`, `EvaluatorInput`, `ExistingActiveAlert`, `ReconcilePlan`), `ALERT_SEVERITY_MAP` (determinístico), `dedupKey`, `evaluate` (6 tipos a partir das fontes; campo ausente ⇒ omite o tipo; ordena por `dedupKey`) e `reconcile` (`toOpen`/`toTouch`/`toResolve`)
    - _Requirements: 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ] 2.6 Teste de propriedade CP3 — determinismo do `Alert_Evaluator`
    - `cp3_alert_evaluator.property.test.ts`, `numRuns: 100`, tag Property 3; snapshots com arrays opcionais (`fc.option(..., { nil: undefined })`) de sessões/jobs/integrações/assinaturas/tickets, status via `fc.constantFrom`, janelas fixas
    - **Property 3 (CP3): para o mesmo snapshot, `evaluate` produz sempre o mesmo conjunto de `(Alert_Type, Alert_Source)`, com `severity === ALERT_SEVERITY_MAP[type]`; fonte ausente ⇒ zero alertas daquele tipo (omissão sem fabricação)**
    - **Validates: Requirements 6.4, 7.1, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7**

  - [ ] 2.7 Teste de propriedade CP4 — deduplicação e idempotência da reconciliação
    - `cp4_reconcile_dedup.property.test.ts`, `numRuns: 100`, tag Property 4; listas de `ActiveSituation` e `ExistingActiveAlert` (subconjunto/superconjunto das chaves); asserção de idempotência reaplicando o plano
    - **Property 4 (CP4): `reconcile` nunca propõe abrir alerta para uma `Alert_Dedup_Key` já ativa (≤ 1 ativo por situação) e é idempotente — após aplicar `toOpen`/`toTouch`, reconciliar de novo dá `toOpen` vazio e nenhum `toResolve` para situações ainda ativas**
    - **Validates: Requirements 6.5, 7.2, 7.3, 7.5**

  - [ ] 2.8 Teste de propriedade CP5 — auto-resolução consistente
    - `cp5_auto_resolve.property.test.ts`, `numRuns: 100`, tag Property 5; chaves ativas particionadas aleatoriamente em "ainda ativa" vs "extinta"
    - **Property 5 (CP5): toda `Alert_Dedup_Key` ativa sem situação correspondente aparece em `toResolve`; toda chave que ainda corresponde a uma situação ativa não aparece em `toResolve`**
    - **Validates: Requirements 7.4, 7.5**

  - [ ] 2.9 `alertLifecycle.ts` — redutor puro do ciclo de ack/resolve
    - `src/services/admin/operacao/alertLifecycle.ts`: `applyAlertOp(state, op)` modelando `OPEN → ACKNOWLEDGED → RESOLVED` e espelhando a semântica das RPCs `admin_alert_acknowledge`/`admin_alert_resolve` (sem I/O): ack de `ACKNOWLEDGED`/resolve de `RESOLVED` ⇒ `_SKIPPED`; `expected_updated_at` divergente ⇒ `STALE_VERSION`; `RESOLVED` terminal não retorna a `ACKNOWLEDGED`
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ] 2.10 Teste de propriedade CP6 — idempotência e versionamento de ack/resolve
    - `cp6_ack_resolve_reducer.property.test.ts`, `numRuns: 100`, tag Property 6; estado inicial (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`), sequência de ops (`ack`/`resolve`) e `expected_updated_at` (correto vs divergente); asserção sobre contagem de efeitos e estado final
    - **Property 6 (CP6): ack de já `ACKNOWLEDGED`/resolve de já `RESOLVED` retorna `_SKIPPED` sem mutar; `expected_updated_at` divergente retorna `STALE_VERSION` sem mutar; N acks sobre `OPEN` produzem exatamente 1 transição e N-1 `_SKIPPED` (idem resolução); `RESOLVED` é terminal**
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7, 9.8**

  - [ ] 2.11 `ordering.ts` — ordenação total de alertas e logs
    - `src/services/admin/operacao/ordering.ts`: `SEVERITY_RANK`, `compareAlerts` (severidade asc → `last_seen_at` desc → `id`) e `compareLogs` (`occurred_at` desc → `event_type` → `id`), ambos com desempate estável
    - _Requirements: 8.8, 10.2_

  - [ ] 2.12 Teste de propriedade CP9 — ordenação determinística de alertas e logs
    - `cp9_ordering.property.test.ts`, `numRuns: 100`, tag Property 9; arrays de linhas com `severity`/`lastSeenAt`/`id` e `occurredAt`/`eventType`/`id` (timestamps e ids podendo empatar)
    - **Property 9 (CP9): `compareAlerts` e `compareLogs` definem ordem total (antissimétrica, transitiva, estável); `sort(perm(xs))` produz a mesma sequência para qualquer permutação do mesmo conjunto**
    - **Validates: Requirements 8.8, 10.2**

  - [ ] 2.13 `logEventMap.ts` — `Log_Event_Map` total + rótulos
    - `src/services/admin/operacao/logEventMap.ts`: `LogEventType`, `LOG_EVENT_TYPES`, `LOG_EVENT_MAP` (cada tipo → conjunto de action codes; `LOGOUT`/`CLIENT_CREATED` ⇒ `[]`, dependência futura), `LOG_EVENT_LABEL` (rótulos pt-BR fixos) e `resolveActionCodes` (total)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 2.14 Teste de propriedade CP10 — totalidade do `Log_Event_Map`
    - `cp10_log_event_map.property.test.ts`, `numRuns: 100`, tag Property 10; `fc.constantFrom(...LOG_EVENT_TYPES)`
    - **Property 10 (CP10): `resolveActionCodes` é total e determinística para todo `Log_Event_Type`; tipos sem fonte emissora (`LOGOUT`, `CLIENT_CREATED`) resolvem para `[]` — sem erro nem fabricação**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [ ] 2.15 Espelho frontend da Permission_Matrix em `permissions.ts`
    - `src/services/admin/permissions.ts`: acrescentar `ALERT_VIEW`/`ALERT_ACK`/`ALERT_RESOLVE`/`LOG_VIEW` a `ADMIN_ACTIONS` (concedidas a `SUPER_ADMIN` via wildcard e a `ADMIN` via allow-all); **não** incluir em `ADMIN_DENY` nem nos `*_PERMS` de `SUPORTE`/`FINANCEIRO`/`MODERADOR` (deny-by-default); manter `hasPermission` negando qualquer ação fora do enum; `DASHBOARD_VIEW` permanece reusada sem redefinir concessão
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

  - [ ]* 2.16 Teste de propriedade CP11 — atualização instantânea via realtime (opcional)
    - `cp11_realtime_indicator.property.test.ts`, `numRuns: 100`, tag Property 11; handler puro `applyRealtimeAlertEvent` (incrementa o indicador ao receber `INSERT`) com mock do canal Supabase Realtime
    - **Property 11\* (CP11): quando há assinatura de tempo real em `system_alerts`, um evento de `INSERT` propaga ao contador do indicador independentemente do `Refresh_Interval`**
    - **Validates: Requirement 4.1 (complementar)**

  - [ ] 2.17 Testes unitários (exemplo/edge) das funções puras
    - cobrir `metricsShape` (formatação pt-BR via `formatNumber`, `indisponível ≠ 0`), `realtimeRefresh` (piso de intervalo — edge 4.5), `alertEvaluator` (cada um dos 6 tipos com fonte concreta), `ordering` (empates), `logEventMap` (rótulos pt-BR fixos e `[]` para `LOGOUT`/`CLIENT_CREATED`)
    - _Requirements: 3.9, 4.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.2, 11.5_

- [ ] 3. Checkpoint — lógica pura verde
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Garantir que CP1–CP6, CP9, CP10 (e CP11\* se habilitada) passam. Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Service layer `src/services/admin/operacao.ts` e propriedades de fronteira CP7/CP8
  - [ ] 4.1 Tipos, mapeamento de erros, leituras e construtores puros de redação
    - `src/services/admin/operacao.ts`: `OperacaoErrorCode`/`OPERACAO_ERROR_MESSAGES` (pt-BR) + `OperacaoError` + `mapOperacaoError` espelhando o `mapPgErrorToCode` de `dashboard.ts`/`tickets.ts` (`42501`→`PERMISSION_DENIED`; `STALE_VERSION`/`INVALID_STATE_TRANSITION`/`NOT_FOUND` por prefixo; default `UNKNOWN`)
    - leituras `getOperationsMetrics(onlineWindowSec=300)` (rpc + `adaptOperationsBundle` + timeout), `listAlerts(filters,page,pageSize)` e `listLogs(filters,page,pageSize)`; negar quando `auth.uid()` nulo (propaga `permission_denied`)
    - construtores **puros exportados** reusados por CP8: `buildLogSummary` (rótulo pt-BR + identificadores não sensíveis, sem PII/segredos) e `sanitizeAlertDetailView` (apenas contadores/timestamps/ids de origem)
    - _Requirements: 3.9, 4.6, 5.4, 8.8, 10.1, 10.5, 11.5, 12.4, 15.5_

  - [ ] 4.2 Wrappers de mutação via `executeAdminMutation` + avaliação manual
    - append em `operacao.ts`: `acknowledgeAlert(id, expectedUpdatedAt)` e `resolveAlert(id, expectedUpdatedAt)` envolvendo as RPCs em `executeAdminMutation` (action `ALERT_ACK`/`ALERT_RESOLVE`, `targetType:'system_alerts'`, `before`/`after`); `_SKIPPED` **não** passa pelo wrapper (toast neutro); propagar `expected_updated_at`; `triggerEvaluate()` chamando `admin_alerts_evaluate` sob demanda (gated `ALERT_VIEW`)
    - _Requirements: 7.6, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ] 4.3 Teste de propriedade CP7 — precedência de `permission_denied`
    - `cp7_permission_precedence.property.test.ts`, `numRuns: 100`, tag Property 7; mock da RPC que aplica o gating **antes** da validação, lançando `permission_denied` mesmo com input inválido; geradores de papel sem permissão + input inválido (`safeText`, números fora de range, `uuidLike` malformado); `authAssertions.expectRejectsPermissionDenied`
    - **Property 7 (CP7): para qualquer RPC desta spec e qualquer caller sem a permissão exigida, o resultado é `permission_denied` mesmo na presença simultânea de erro de validação, independentemente do papel (deny-by-default)**
    - **Validates: Requirements 2.7, 9.9, 9.10, 12.5, 13.1**

  - [ ] 4.4 Teste de propriedade CP8 — isolamento e não-vazamento
    - `cp8_isolation_no_leak.property.test.ts`, `numRuns: 100`, tag Property 8; alvo: `buildLogSummary`/`sanitizeAlertDetailView`/`adaptOperationsBundle` + guard de leitura (mock); geradores injetando PII (`validEmail`/`validPhone`/`validCpf`/`validCnpj`) e padrões de chave; `logAssertions.expectNoSecrets`; `authAssertions.expectPermissionDenied` para o gating
    - **Property 8 (CP8): nenhuma RPC retorna dados a caller sem a permissão exigida; e nenhum `Operations_Metrics_Bundle`, `detail` de `System_Alert` ou `summary` de `Log_Entry` contém PII bruta, conteúdo de mensagens nem segredos**
    - **Validates: Requirements 5.1, 5.4, 6.6, 6.7, 6.8, 12.1, 12.4, 12.6, 13.2, 13.3, 13.4**

  - [ ] 4.5 Testes de cenários de falha do service (caminhos negativos)
    - `STALE_VERSION` → refetch; `INVALID_STATE_TRANSITION` (ack de `RESOLVED`) mantém o estado; `_SKIPPED` (ack/resolve idempotente) como toast neutro, não erro; degradação parcial (`errors[grupo]` ⇒ KPIs do grupo `available=false`, demais grupos renderizam); falha de audit **não** bloqueia a mutação (`auditAssertions.expectMutationSucceedsDespiteAuditFailure`)
    - _Requirements: 4.7, 4.9, 9.5, 9.6, 9.7, 9.8, 15.3_

- [ ] 5. Checkpoint — backend + service verdes
  - Rodar `npx tsc --noEmit`, `npm run test:run` e `npm run lint`. Confirmar CP7, CP8 e os cenários de falha do service. Ensure all tests pass, ask the user if questions arise.

- [ ] 6. UI — componentes, páginas `/admin/operacao/*` e sidebar (padrão compacto)
  - [ ] 6.1 Cards de KPI e grid responsivo
    - `src/components/admin/operacao/`: `OperacaoKpiGrid` (grid responsivo dos 11 KPIs, vira coluna única em `<768px`), reuso de `DashboardKpiCard` (label `text-[10px] uppercase`, valor `text-base sm:text-lg`; `available=false` ⇒ `indisponível`, nunca `0`; `formatNumber` pt-BR) e `DashboardBlockError` (erro isolado por grupo + "Tentar novamente")
    - _Requirements: 3.1, 3.9, 3.10, 4.8, 4.9_

  - [ ] 6.2 `OperacaoDashboardPage` + `Realtime_Refresh` (wiring)
    - `src/pages/admin/operacao/OperacaoDashboardPage.tsx`: orquestra os 11 KPIs via `getOperationsMetrics`; aplica `Realtime_Refresh` usando `realtimeRefresh.reduce` (timer de `tick`, `visibilitychange` pausa/retoma, uma requisição em voo, botão de atualização **manual** que reinicia o temporizador); sem `<h1>` grande
    - _Requirements: 1.9, 4.1, 4.2, 4.3, 4.4_

  - [ ] 6.3 Componentes de alerta (badges + ações gated)
    - `AlertSeverityBadge` (`CRÍTICO`/`ALERTA`/`INFO`), `AlertStateBadge` (`Aberto`/`Reconhecido`/`Resolvido`), `AlertActionsCell` (botão **Reconhecer** visível só com `ALERT_ACK` e alerta `OPEN`; **Resolver** visível só com `ALERT_RESOLVE` e `OPEN`/`ACKNOWLEDGED`; envia `expected_updated_at`), tabela desktop + cards mobile single-column
    - _Requirements: 8.8, 9.1, 9.2_

  - [ ] 6.4 `OperacaoAlertasPage` (lista + filtros popover + ack/resolve)
    - `src/pages/admin/operacao/OperacaoAlertasPage.tsx`: lista ordenada por `compareAlerts`, filtros em **popover** (`SlidersHorizontal`: estado/tipo/severidade) que **só dispara no "Aplicar"**, paginação `10/50/100` (default `10`), botão "Avaliar agora" (gated `ALERT_VIEW`, chama `triggerEvaluate`); **validação no frontend** dos controles de ack/resolve espelhando o backend, bloqueando envio inválido **e** exibindo mensagem pt-BR (única condição de bloqueio); refetch em `STALE_VERSION`, toast neutro em `_SKIPPED`; sem `<h1>`
    - _Requirements: 8.8, 9.1, 9.2, 9.5, 9.6, 9.7, 15.1, 15.2_

  - [ ] 6.5 `OperacaoLogsPage` (somente-leitura + filtros popover + paginação)
    - `src/pages/admin/operacao/OperacaoLogsPage.tsx`: tabela **somente-leitura** ordenada por `compareLogs`, rótulos pt-BR de `LOG_EVENT_LABEL`, filtros em popover (tipo de evento/intervalo de datas/ator/tipo de alvo) com "Aplicar", paginação `10/50/100` (default `10`), estado vazio `Nenhum registro encontrado.`, erro isolado com "Tentar novamente"; **nenhum** controle de criação/edição/remoção; sem `<h1>`
    - _Requirements: 1.9, 10.1, 10.3, 10.5, 10.6, 10.7, 10.8, 11.5_

  - [ ] 6.6 Rotas, `AdminGuard`/`Stealth_404` e sidebar (wiring)
    - registrar `/admin/operacao` (Operations_Dashboard, gated `DASHBOARD_VIEW`), `/admin/operacao/alertas` (Alerts_Center, gated `ALERT_VIEW`) e `/admin/operacao/logs` (Logs_Viewer, gated `LOG_VIEW`) sob `AdminGuard` ⇒ senão `Stealth_404`; item `Operação` em `AdminSidebar` → `/admin/operacao`, gated por `DASHBOARD_VIEW`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ] 6.7 Testes de UI (render gated e comportamento)
    - render gated (`Stealth_404` sem permissão nas três rotas, item `Operação` na sidebar, ausência de `<h1>`, popover `SlidersHorizontal`, paginação default 10), `USERS_ONLINE` exibindo `indisponível` (nunca `0`), `DashboardBlockError` isolado por grupo, controles ack/resolve ocultos sem `ALERT_ACK`/`ALERT_RESOLVE`, logs somente-leitura + estado vazio, formulário de filtro/ação inválido bloqueado **e** mensagem pt-BR
    - _Requirements: 1.3, 1.5, 1.7, 1.8, 1.9, 3.8, 4.8, 9.1, 9.2, 10.6, 10.7, 15.2_

- [ ] 7. Testes de integração (`tests/`, branch Supabase efêmero — CI)
  - [ ] 7.1 RLS de `system_alerts` e isolamento de escrita
    - `tests/security/`: admin com `ALERT_VIEW` lê linhas; `anon`/`authenticated` não-admin/Cliente recebem **0 linhas**; INSERT/UPDATE/DELETE direto bloqueado para qualquer role `authenticated` (escrita só via RPC)
    - _Requirements: 6.6, 6.7_

  - [ ] 7.2 Gating das RPCs, log negativo persistido e paridade da matriz
    - `DASHBOARD_VIEW_DENIED`/`ALERT_VIEW_DENIED`/`LOG_VIEW_DENIED` **persistidos** em `admin_audit_logs` (`before=NULL`, `after={user_id,reason}`) via `auditAssertions.expectViewDenied`; precedência de `permission_denied`; paridade `is_admin_with_permission` ↔ Permission_Matrix para as 4 ações novas; caller anônimo (`auth.uid()` nulo) ⇒ `permission_denied`
    - _Requirements: 1.10, 2.4, 2.5, 5.1, 5.2, 9.9, 12.1, 12.2, 13.1, 13.2_

  - [ ] 7.3 `pg_cron`, deduplicação e auto-resolução end-to-end
    - `admin_alerts_evaluate` por service-role (`pg_cron`) e sob demanda (`ALERT_VIEW`); segunda execução sobre o mesmo estado não cria 2º ativo (índice único parcial) e só atualiza `last_seen_at`; situação extinta vira `RESOLVED` (`resolved_by=NULL`); falha de uma fonte grava `ALERT_SOURCE_FAILED` e não aborta as demais
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ] 7.4 Ack/resolve — audit persistido, idempotência e versionamento
    - audit positivo `ALERT_ACK`/`ALERT_RESOLVE` **persistido** (`auditAssertions.expectAuditPersisted`); `_SKIPPED` grava `ALERT_ACK_SKIPPED`/`ALERT_RESOLVE_SKIPPED`; `STALE_VERSION` não muta; ack de `RESOLVED` ⇒ `INVALID_STATE_TRANSITION`; falha de audit não bloqueia a mutação
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ] 7.5 Isolamento entre contas e não-vazamento de PII/segredos
    - Cliente nunca acessa métricas/alertas/logs (gating/RLS); `Operations_Metrics_Bundle` (só agregados), `system_alerts.detail` e `Log_Entry.summary` sem PII (e-mail/telefone/CPF/CNPJ), conteúdo de mensagens nem segredos; `USERS_ONLINE` expõe apenas contagem
    - _Requirements: 5.4, 5.6, 6.8, 12.4, 12.6, 13.3, 13.4_

  - [ ] 7.6 Idempotência da migration 117, `DO $check$` e ausência de destruição de dados
    - reaplicar `117` não falha nem duplica objetos/índice único parcial; o `DO $check$` falha com mensagem clara sem as dependências duras; não reescreve/destrói `users`/`support_tickets`/`subscriptions`/`admin_audit_logs`/`whatsapp_*`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.8_

  - [ ] 7.7 Master `Nexus_Vortex99` imutável
    - mutações de alerta (ack/resolve) **não** tocam `users`; a proteção do Master (`users_protect_master` + `assertNotMasterNorSelf`) permanece a autoridade; qualquer toque a `users` aborta antes do touch
    - _Requirements: 13.6_

  - [ ]* 7.8 Smoke da migration (opcional)
    - presença/forma de `117` + par rollback; bloco `DO $check$`; `GRANT/REVOKE` sem `anon` (e `service_role` só na `admin_alerts_evaluate`); domínios fechados (`CHECK`) de `alert_type`/`severity`/`state`; índice único parcial presente; postura §10 das RPCs
    - _Requirements: 14.1, 14.4, 14.7, 14.8_

- [ ] 8. Regression_Suite, cobertura e documentação técnica
  - [ ] 8.1 Incorporar à Regression_Suite e manter cobertura
    - registrar os testes unit/property/falha/integração desta spec na suíte; atualizar `tests/coverage.config.ts` (Critical_Modules de `operacao/`: `metricsShape`, `realtimeRefresh`, `alertEvaluator`, `alertLifecycle`, `ordering`, `logEventMap`) mantendo o threshold; verificar com `scripts/check-coverage.ts`; JSDoc técnico nos módulos puros e nas RPCs
    - _Requirements: 15.6, 15.7, 15.8_

  - [ ]* 8.2 Roteiro de verificação E2E manual (opcional)
    - documentar um roteiro manual (gating/Stealth_404 nas três rotas, `Realtime_Refresh` pausa/retoma, ack→resolve, auto-resolve via reavaliação, logs filtrados) como artefato de QA, sem substituir os testes automatizados
    - _Requirements: 15.6_

- [ ] 9. Checkpoint final — suíte completa verde
  - Rodar `npx tsc --noEmit`, `npm run test:run`, `npm run lint` e `npx tsx scripts/check-coverage.ts`. Garantir o checklist de `testing-governance` completo (unit + property CP1–CP10 + cenários de falha + validações frontend/backend + Regression_Suite + documentação). Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são **opcionais** e podem ser puladas para um MVP mais rápido. **CP1–CP10
  não são opcionais** (obrigatórias em spec do painel, `project-conventions`/`testing-governance`) e
  por isso não levam `*`; os únicos itens `*` são **CP11\*** (2.16), o **smoke da migration** (7.8) e o
  **roteiro E2E manual** (8.2).
- Cada tarefa referencia cláusulas granulares de Requirements; tarefas de propriedade citam o número
  da Property/CP e a linha `**Validates: Requirements ...**` exatamente como no design.
- Property tests em `src/__tests__/admin/operacao/cp<N>_<nome>.property.test.ts`, `numRuns >= 100`,
  tag `// Feature: admin-central-operacao, Property N`, reusando os helpers canônicos de
  `src/__tests__/_helpers/` (`generators`, `authAssertions`, `logAssertions`, `auditAssertions`,
  `antiEnumeration`) e geradores de domínio em `src/__tests__/admin/operacao/_generators.ts`
  (`fc.constantFrom` para PII/status; `fc.string({...}).filter` — nunca `fc.stringOf`). Integração e
  smoke ficam em `tests/`.
- Reuso explícito (não recriar): `executeAdminMutation`, `is_admin_with_permission`,
  `AdminGuard`/`Stealth_404`/`useAdminPermission`, `DashboardKpiCard`/`DashboardBlockError`/
  `formatNumber` e o padrão `getMetrics`/`Partial_Degradation` de `admin-dashboard`, versionamento
  otimista (`STALE_VERSION`), idempotência `_SKIPPED` e o master `Nexus_Vortex99` imutável.
- Cobertura do checklist `testing-governance`: **unit** (2.17) + **property CP1–CP10** (2.2, 2.4, 2.6,
  2.7, 2.8, 2.10, 2.12, 2.14, 4.3, 4.4); **cenários de falha** `STALE_VERSION`/`INVALID_STATE_TRANSITION`/
  `_SKIPPED`/degradação/`permission_denied` com precedência (4.5, 7.2, 7.3, 7.4); **validações
  frontend E backend** (1.3/1.4 backend, 6.4/6.5 frontend); **Regression_Suite + cobertura** (8.1);
  **documentação técnica** (8.1).
- Migration conforme o design: **117** concentra schema/RBAC/RLS/trigger + as 6 RPCs + `pg_cron`
  (Req 14.4), com par `_rollback` documentado e não auto-aplicado; `117b_...` é apenas reserva de
  sufixo, e o `118` permanece reservado para a quarta spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "2.5", "2.9", "2.11", "2.13", "2.15"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.4", "2.6", "2.7", "2.8", "2.10", "2.12", "2.14", "2.16", "2.17", "4.1"] },
    { "id": 2, "tasks": ["1.3", "4.2", "4.4"] },
    { "id": 3, "tasks": ["1.4", "4.3", "4.5", "6.1", "6.3"] },
    { "id": 4, "tasks": ["1.5", "6.2", "6.4", "6.5", "7.1", "7.2", "7.3", "7.4", "7.5", "7.7"] },
    { "id": 5, "tasks": ["6.6", "7.6", "7.8"] },
    { "id": 6, "tasks": ["6.7"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2"] }
  ]
}
```
