# Design Document — IA Supervisora (`admin-ia-supervisora`)

## Visão geral (Overview)

A `Supervisor_AI` é a quarta e última spec do documento do dono. Ela entrega o `Supervisor_Console`
em `/admin/supervisor`, composto por quatro superfícies que andam juntas:

1. **Painel Inteligente** (`Supervisor_Chat`) — chat read-only em linguagem natural fundamentado em
   agregados não sensíveis (`Supervisor_Context`) + provider de IA (`Provider_Abstraction` de
   `admin-assistant`).
2. **Central de Diagnóstico** (`Diagnostic_Center`) — registro técnico admin-only de erros/eventos
   (`supervisor_diagnostics`), idempotente por `dedup_key`, nunca exposto ao cliente.
3. **Insights** (`supervisor_insights`) — autoanálise: **anomalias** (regra determinística sobre
   diagnósticos + alertas de 117), **sugestões** e **alertas de segurança**, com ciclo de vida
   `OPEN → ACKNOWLEDGED → DISMISSED`.
4. **Resumo periódico** (`Periodic_Summary`) — `SUMMARY` gerado por pg_cron a partir de agregados.

As notificações proativas (in-app, via `notifications-hub`) são governadas pelo `Notification_Router`:
`CRITICAL` ⇒ imediato; `WARNING`/`INFO` ⇒ agrupados no resumo.

### O que esta spec NÃO faz (não-objetivos)

- **Não executa ações de negócio/destrutivas** (read-only): nunca pausa campanha, bane usuário ou
  muta dados de cliente. Só observa, registra, sugere, responde e notifica.
- **Não recria** 117 (métricas/alertas/logs), `admin-assistant` (provider) nem `notifications-hub`.
- **Não coleta métricas de recurso de infra** (CPU/memória) — `Future_Signal`.
- **Não usa WhatsApp/Telegram/e-mail** nas notificações do v1 — `Future_Channel` (só in-app).

### Princípios de reuso (não duplicar, não quebrar)

| Origem | Reuso |
| --- | --- |
| `admin-central-operacao` (117) | `admin_operations_metrics` (agregados), `system_alerts` (sinais), `admin_logs_list` (eventos). Padrões: índice único parcial de dedup, `is_admin_with_permission` re-assert, RLS admin-only + `no_dml`, RPC gating + log negativo, pg_cron defensivo, `OperacaoKpiCard`/`DashboardBlockError`. |
| `admin-assistant` (047) | `Provider_Abstraction` (multi-provider, chave no Vault) para o `Supervisor_Chat`. |
| `notifications-hub` (041) | canal in-app das notificações proativas. |
| `admin-foundation` (030) + `admin-patterns` | AdminGuard/Stealth_404, `useAdminPermission`, `is_admin_with_permission`, `executeAdminMutation`/`logAdminAction`, versionamento otimista, `_SKIPPED`, master imutável, UI compacta. |
| `src/__tests__/_helpers/` | `generators`, `authAssertions`, `logAssertions`, `auditAssertions` — reusados, nunca reimplementados. |

---

## Arquitetura (Architecture)

### Camadas

```
Página (/admin/supervisor/*) 
  → service (src/services/admin/supervisor.ts)         [wrappers finos + tipos pt-BR]
    → RPC SECURITY DEFINER (migration 118)             [gating is_admin_with_permission + audit]
      → tabelas supervisor_diagnostics / supervisor_insights (RLS admin-only)
      → leitura agregada de 117 / 092 / 055 / 115 (sem PII)
  → edge function ia-supervisor (chat)                 [contexto agregado + Provider_Abstraction]
Núcleo puro (src/services/admin/supervisor/*)          [alvo das Correctness Properties]
```

### Fluxo do `Supervisor_Chat` (read-only, sem PII)

1. Admin digita a pergunta → o front classifica a **intenção** com `Question_Context_Plan` (puro) e
   chama a edge function `ia-supervisor` com `{ question, intents }` + JWT do admin.
2. A edge function valida o gating (`SUPERVISOR_VIEW` via `is_admin_with_permission` no contexto do
   caller), chama `supervisor_chat_context(intents)` (RPC gated) que devolve **apenas agregados não
   sensíveis**, monta o prompt (system + contexto JSON + pergunta) e chama o `Provider_Abstraction`.
3. Devolve a resposta pt-BR; grava `SUPERVISOR_CHAT_QUERY` (metadados, sem o texto cru). Provider
   ausente/falho ⇒ resposta de indisponibilidade (degradação controlada). **Nenhuma PII** trafega.

### Fluxo de monitoramento / anomalias / resumo

1. `supervisor_record_diagnostic` (service-role/monitor/admin) grava/atualiza um `Supervisor_Diagnostic`
   idempotente (`ON CONFLICT (dedup_key)` ⇒ `occurrence_count++`, `last_seen_at`), com `detail`
   sanitizado (sem PII/segredos).
2. `supervisor_evaluate` (pg_cron a cada N min **ou** sob demanda por `SUPERVISOR_VIEW`) roda o
   `Anomaly_Detector` (regra): diagnósticos com `occurrence_count ≥ threshold` na janela + alertas
   `CRITICAL` abertos de 117 ⇒ reconcilia `supervisor_insights` (`INSERT ON CONFLICT (dedup_key)
   WHERE state IN ('OPEN','ACKNOWLEDGED') DO UPDATE last_seen_at`; auto-dismiss das situações
   extintas, `dismissed_by NULL`). `CRITICAL` ⇒ notificação imediata via hub.
3. `supervisor_generate_summary` (pg_cron diário) monta o `Periodic_Summary` (idempotente por
   `dedup_key = 'SUMMARY:<period>:<bucket>'`) agregando 117 + contagens; agrupa os `WARNING`/`INFO`.

### Matriz de gating (RLS + RPC)

| Caller | chat/listas/evaluate | ack/dismiss | system_alerts/diagnostics/insights (SELECT direto) |
| --- | --- | --- | --- |
| `anon` (uid nulo) | `permission_denied` (42501) | `permission_denied` | 0 linhas |
| Cliente / não-admin | `permission_denied` + `SUPERVISOR_VIEW_DENIED` | `permission_denied` | 0 linhas (RLS) |
| `FINANCEIRO`/`SUPORTE`/`MODERADOR` | negado | negado | 0 linhas |
| `ADMIN`/`SUPER_ADMIN` | permitido | permitido | linhas visíveis |
| `service_role` (cron) | `evaluate`/`generate_summary`/`record_diagnostic` permitidos (uid nulo = confiável) | — | bypassa RLS |

---

## Modelo de dados (Data Models) — migration 118

### 1. Bloco defensivo `DO $check$`

Verifica dependências DURAS: `is_admin_with_permission` e `admin_audit_logs` (030),
`admin_operations_metrics`/`system_alerts` (117). `notifications-hub` (041) e `admin-assistant` (047)
são dependências MACIAS (ausência degrada notificação/chat, não aborta a migration — `RAISE NOTICE`).

### 2. Tabela `supervisor_diagnostics` (Req 3) — rolling record idempotente

```sql
CREATE TABLE IF NOT EXISTS supervisor_diagnostics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module           text NOT NULL,                 -- 'whatsapp'/'suporte'/'financeiro'/'auth'/'system'/...
  operation        text NOT NULL,                 -- operação executada
  severity         text NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  error_code       text,                          -- opcional (dedup/anomalia)
  description      text NOT NULL,                 -- pt-BR, sanitizado (sem PII)
  probable_cause   text,                          -- pt-BR
  suggested_fix    text,                          -- pt-BR
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb, -- contexto não sensível
  dedup_key        text NOT NULL,                 -- module:operation:error_code (Diagnostic_Dedup_Key)
  occurrence_count int  NOT NULL DEFAULT 1,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supervisor_diagnostics_dedup UNIQUE (dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_supervisor_diag_list ON supervisor_diagnostics (severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervisor_diag_module ON supervisor_diagnostics (module, last_seen_at DESC);
-- trigger supervisor_touch_updated_at (BEFORE UPDATE)
```

### 3. Tabela `supervisor_insights` (Req 5, 6, 8, 9)

```sql
CREATE TABLE IF NOT EXISTS supervisor_insights (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type     text NOT NULL CHECK (insight_type IN ('ANOMALY','SUGGESTION','SUMMARY','SECURITY')),
  severity         text NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  state            text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','ACKNOWLEDGED','DISMISSED')),
  title            text NOT NULL,                 -- pt-BR, sem PII
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key        text NOT NULL,                 -- insight_type:scope:subject (Insight_Dedup_Key)
  source           text NOT NULL DEFAULT 'anomaly_detector', -- anomaly_detector/summary_builder/security_scan/ai
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz, acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at     timestamptz, dismissed_by     uuid REFERENCES users(id) ON DELETE SET NULL, -- NULL = automático
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- <= 1 insight ATIVO por situação (Insight_Dedup_Key) — CP3
CREATE UNIQUE INDEX IF NOT EXISTS uq_supervisor_insights_active_dedup
  ON supervisor_insights (dedup_key) WHERE state IN ('OPEN','ACKNOWLEDGED');
CREATE INDEX IF NOT EXISTS idx_supervisor_insights_list ON supervisor_insights (state, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervisor_insights_type ON supervisor_insights (insight_type, created_at DESC);
-- trigger supervisor_touch_updated_at (BEFORE UPDATE)
```

### 4. RLS (Req 11) — admin-only, escrita só por RPC

Para ambas as tabelas: `ENABLE ROW LEVEL SECURITY`; `*_select_admin` (`FOR SELECT TO authenticated
USING (is_admin_with_permission('SUPERVISOR_VIEW'))`) + `*_no_dml` (`FOR ALL TO authenticated USING
(false) WITH CHECK (false)`). Escrita só via RPC `SECURITY DEFINER` (roda como owner, ignora RLS).

### 5. RBAC — re-asserção de `is_admin_with_permission` (Req 12)

PRESERVA INTEGRALMENTE o corpo vigente on-disk (030 + deny-list 048 + `FAQ_VIEW` de 115 +
`USER_NOTE_*` de 116 + `ALERT_*`/`LOG_VIEW` de 117). `SUPERVISOR_VIEW`/`SUPERVISOR_MANAGE` são
reconhecidas **por construção**: `SUPER_ADMIN` (wildcard) e `ADMIN` (allow-all menos deny-list) as
recebem; `FINANCEIRO`/`SUPORTE`/`MODERADOR` (allowlists fechadas) as negam. Sem ramo dedicado.

### 6. RPCs `SECURITY DEFINER` (postura `admin-patterns` §10)

| RPC | Gating | Retorno | Log |
| --- | --- | --- | --- |
| `supervisor_record_diagnostic(p_module, p_operation, p_severity, p_error_code, p_description, p_probable_cause, p_suggested_fix, p_detail, p_dedup_key)` | service-role (uid nulo) **ou** `SUPERVISOR_VIEW` | `{ id, occurrence_count }` | `SUPERVISOR_DIAGNOSTIC_RECORDED` (se `v_caller` não nulo) |
| `supervisor_diagnostics_list(p_module, p_severity, p_from, p_to, p_limit, p_offset)` | `SUPERVISOR_VIEW` | `{ items[], total }` | `SUPERVISOR_VIEW_DENIED` (negativo) |
| `supervisor_insights_list(p_type, p_severity, p_state, p_limit, p_offset)` | `SUPERVISOR_VIEW` | `{ items[], total }` | `SUPERVISOR_VIEW_DENIED` |
| `supervisor_chat_context(p_intents text[])` | `SUPERVISOR_VIEW` | `jsonb` (agregados sem PII) | — |
| `supervisor_evaluate(p_error_threshold int DEFAULT 5, p_window_minutes int DEFAULT 60)` | service-role **ou** `SUPERVISOR_VIEW` | `{ opened, touched, dismissed }` | `SUPERVISOR_INSIGHT_GENERATED` (se `v_caller` não nulo) |
| `supervisor_generate_summary(p_period text DEFAULT 'daily')` | service-role **ou** `SUPERVISOR_VIEW` | `{ id, skipped? }` | — |
| `supervisor_insight_acknowledge(p_id uuid, p_expected_updated_at timestamptz)` | `SUPERVISOR_MANAGE` | `{ ok, updated_at }` \| `{ skipped, reason }` | `SUPERVISOR_INSIGHT_ACK_SKIPPED` na RPC; positivo `SUPERVISOR_INSIGHT_ACK` no service |
| `supervisor_insight_dismiss(p_id uuid, p_expected_updated_at timestamptz)` | `SUPERVISOR_MANAGE` | `{ ok, updated_at }` \| `{ skipped, reason }` | `SUPERVISOR_INSIGHT_DISMISS_SKIPPED` na RPC; positivo no service |

Notas (espelham 117): `auth.uid()` nulo em `evaluate`/`generate_summary`/`record_diagnostic` ⇒
contexto confiável (cron/service_role; `anon` não tem EXECUTE) ⇒ prossegue; não nulo ⇒ exige
permissão (log negativo). Audits do caminho cron são guardados por `IF v_caller IS NOT NULL`
(`admin_audit_logs.admin_id` é NOT NULL). Versionamento otimista (`ROW_COUNT=0` ⇒ `STALE_VERSION`),
`DISMISSED` terminal (ack de `DISMISSED` ⇒ `INVALID_STATE_TRANSITION`).

### 7. Agendamento pg_cron (defensivo, espelha 092/117)

`DO $cron$` checa `pg_extension pg_cron`; ausente ⇒ `RAISE NOTICE` + `RETURN`. Presente ⇒ agenda
`supervisor-evaluate-tick` (`*/5 * * * *` → `SELECT public.supervisor_evaluate();`) e
`supervisor-daily-summary` (`5 0 * * *` → `SELECT public.supervisor_generate_summary('daily');`).

### 8. `-- VERIFY` comentado + par rollback `118_admin_ia_supervisora_rollback.sql` (não auto-aplicado).

---

## Componentes e interfaces

### A. Núcleo de lógica pura — `src/services/admin/supervisor/` (alvo das propriedades)

#### A.1 `severityClassifier.ts` (alvo de **CP1**)

```ts
export type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type DiagnosticInput = { module: string; severity?: InsightSeverity; errorCode?: string; occurrenceCount: number };
export const CRITICAL_MODULES_SET: ReadonlySet<string>; // 'financeiro','auth','integration','queue'
export function classifySeverity(input: DiagnosticInput): InsightSeverity; // total, determinística
export function notifyImmediately(sev: InsightSeverity): boolean;          // CRITICAL => true
```

#### A.2 `anomalyDetector.ts` (alvo de **CP2/CP3**)

```ts
export interface AnomalySnapshot {
  diagnostics?: ReadonlyArray<{ dedupKey: string; module: string; errorCode?: string; occurrenceCount: number; severity: InsightSeverity }>;
  openCriticalAlerts?: ReadonlyArray<{ dedupKey: string; alertType: string }>; // de 117
  config: { errorThreshold: number };
}
export interface ActiveAnomaly { dedupKey: string; insightType: 'ANOMALY'|'SECURITY'; severity: InsightSeverity; title: string }
export function detectAnomalies(s: AnomalySnapshot): ActiveAnomaly[];        // determinística, ordenada por dedupKey; fonte ausente => omite
export interface ExistingActiveInsight { dedupKey: string; state: 'OPEN'|'ACKNOWLEDGED' }
export interface ReconcilePlan { toOpen: ActiveAnomaly[]; toTouch: string[]; toDismiss: string[] }
export function reconcileInsights(existing: ReadonlyArray<ExistingActiveInsight>, anomalies: ReadonlyArray<ActiveAnomaly>): ReconcilePlan; // idempotente (CP3)
```

#### A.3 `insightLifecycle.ts` (alvo de **CP4**)

```ts
export type InsightState = 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED';
export type InsightOpKind = 'ack' | 'dismiss';
export interface InsightLifecycleState { state: InsightState; updatedAt: string }
export interface InsightOp { kind: InsightOpKind; expectedUpdatedAt: string; nextUpdatedAt: string }
export type InsightOpEffect = 'transition' | 'skipped' | 'stale' | 'invalid_transition';
export interface InsightOpResult { effect: InsightOpEffect; state: InsightLifecycleState; reason?: 'ALREADY_ACKNOWLEDGED'|'ALREADY_DISMISSED' }
export function applyInsightOp(cur: InsightLifecycleState, op: InsightOp): InsightOpResult;
// ack de ACKNOWLEDGED => skipped; dismiss de DISMISSED => skipped; ack de DISMISSED => invalid_transition (terminal);
// expected divergente => stale; checagem de estado precede versão (igual à RPC).
```

#### A.4 `summaryBuilder.ts` (alvo de **CP5**)

```ts
export interface SummaryInput { signups: number; subscriptions: number; campaignsDone: number; campaignsFailed: number; alertsOpen: number; /* ... agregados */ }
export function buildSummaryText(input: SummaryInput): string;  // pt-BR determinístico, sem PII
export function summaryDedupKey(period: 'daily'|'weekly'|'monthly', bucket: string): string; // 'SUMMARY:daily:2026-06-19'
```

#### A.5 `ordering.ts` (alvo de **CP8**)

```ts
export const SEVERITY_RANK: Record<InsightSeverity, number>;            // CRITICAL 0, WARNING 1, INFO 2
export interface InsightRow { id: string; severity: InsightSeverity; createdAt: string }
export interface DiagnosticRow { id: string; lastSeenAt: string }
export function compareInsights(a: InsightRow, b: InsightRow): number;  // severidade ↑, created_at ↓, id
export function compareDiagnostics(a: DiagnosticRow, b: DiagnosticRow): number; // last_seen_at ↓, id
```

#### A.6 `questionContextPlan.ts` (alvo de **CP9**)

```ts
export type ContextIntent = 'USERS' | 'SUBSCRIPTIONS' | 'TICKETS' | 'MESSAGES' | 'ALERTS' | 'DIAGNOSTICS' | 'OVERVIEW';
export const CONTEXT_INTENTS: readonly ContextIntent[];
export function planIntents(question: string): ContextIntent[]; // mapeia palavras-chave pt-BR -> intents; default ['OVERVIEW']; total/determinística
```

#### A.7 `sanitize.ts` (alvo de **CP7**) — reusa o padrão de `operacao.sanitizeAlertDetailView`

```ts
export function sanitizeSupervisorDetail(detail: unknown): Record<string, unknown>; // drop chaves sensíveis + redige valores PII/segredo
```

### B. RPCs — ver tabela §6. Skeleton de `supervisor_insight_acknowledge` espelha
`admin_alert_acknowledge` (117): auth guard → gating + log negativo → SELECT state (NOT_FOUND/
SKIPPED/INVALID) → UPDATE otimista (`ROW_COUNT=0` ⇒ `STALE_VERSION`).

### C. Service layer — `src/services/admin/supervisor.ts`

Espelha `operacao.ts`: `SupervisorError`/`SupervisorErrorCode` (`PERMISSION_DENIED`/`STALE_VERSION`/
`NOT_FOUND`/`INVALID_STATE_TRANSITION`/`INVALID_INPUT`/`TIMEOUT`/`NETWORK`/`UNKNOWN`) +
`SUPERVISOR_ERROR_MESSAGES` (pt-BR) + `mapSupervisorError` (42501 PRIMEIRO; precedência). Leituras:
`listDiagnostics`/`listInsights` (`{items,total}`, detail sanitizado); `getSupervisorContext(intents)`
(via `supervisor_chat_context`); `askSupervisor(question)` (chama a edge function `ia-supervisor`).
Mutações via `runSkippableMutation` (mirror suporte): `acknowledgeInsight`/`dismissInsight`
(`_SKIPPED` da RPC; audit positivo best-effort `.catch`). `triggerEvaluate`/`generateSummary`.
`recordDiagnostic` (wrapper de `supervisor_record_diagnostic`). EXPORTA puros `buildSummaryText`/
`sanitizeSupervisorDetail` reusados. Tipos `SupervisorDiagnostic`/`SupervisorInsight` em snake_case.

### D. Edge function — `supabase/functions/ia-supervisor/index.ts`

Recebe `{ question, intents }` + JWT. Valida `SUPERVISOR_VIEW`; chama `supervisor_chat_context`;
monta prompt (system pt-BR: "você é a IA supervisora, read-only, responda só com base no contexto") +
contexto JSON + pergunta; chama `Provider_Abstraction` (chave no Vault). Retorna `{ answer }`.
Provider ausente/erro ⇒ `{ answer: 'IA indisponível no momento.' , degraded: true }`. Loga
`SUPERVISOR_CHAT_QUERY` (metadados). **Nunca** envia PII ao provider.

### E. UI — `src/components/admin/supervisor/` + páginas `src/pages/admin/supervisor/`

Padrão compacto (`project-conventions`): sem `<h1>`; filtros em popover; paginação `10/50/100`; botões
`text-xs px-2.5 py-1`. `SupervisorNav` (sub-nav Painel/Diagnóstico/Insights/Resumo, gated). Páginas:

| Página | Papel | Gating |
| --- | --- | --- |
| `SupervisorChatPage` (`/admin/supervisor`) | chat read-only; bolhas pergunta/resposta; estado "IA indisponível" | `SUPERVISOR_VIEW` ⇒ Stealth_404 |
| `SupervisorDiagnosticsPage` (`/admin/supervisor/diagnostico`) | tabela read-only (`compareDiagnostics`), filtros (módulo/severidade/datas) | `SUPERVISOR_VIEW` |
| `SupervisorInsightsPage` (`/admin/supervisor/insights`) | lista (`compareInsights`), filtros (tipo/severidade/estado), Reconhecer/Descartar gated, "Avaliar agora" | `SUPERVISOR_VIEW` (+ `SUPERVISOR_MANAGE` p/ ações) |
| `SupervisorSummaryPage` (`/admin/supervisor/resumo`) | último `Periodic_Summary` + "Gerar agora" | `SUPERVISOR_VIEW` |
| `AdminSidebar` | item "Supervisor" → `/admin/supervisor` | `SUPERVISOR_VIEW` |

Reusa `OperacaoKpiCard`-style? Não: usa badges próprios (`InsightSeverityBadge`/`InsightStateBadge`)
+ `DashboardBlockError` (reuso). Notificação proativa in-app aparece no sino existente do hub.

---

## Correctness Properties

*Uma propriedade é uma afirmação formal sobre o que o software deve fazer em todas as execuções
válidas — a ponte entre os critérios EARS e garantias verificáveis por fast-check.* CP1–CP9 são
**obrigatórias** (sem asterisco); cada uma é **um** teste de propriedade (mín. **100** iterações),
tag `// Feature: admin-ia-supervisora, Property N`, em `src/__tests__/admin/supervisor/`.

### Property 1 (CP1): Determinismo do `Severity_Classifier`
*Para qualquer* entrada de diagnóstico, `classifySeverity` é total e determinística (mesma entrada ⇒
mesma severidade) e respeita o mapa fixo (módulos críticos / `occurrenceCount ≥ threshold` ⇒
`CRITICAL`); `notifyImmediately` ⇔ `CRITICAL`. **Validates:** Req 4.1–4.3.

### Property 2 (CP2): Determinismo do `Anomaly_Detector` + omissão sem fonte
*Para qualquer* snapshot, `detectAnomalies` produz o **mesmo** conjunto; toda anomalia tem severidade
do mapa; campo de fonte ausente ⇒ zero anomalias daquele tipo (sem fabricar). **Validates:** Req
5.1–5.3.

### Property 3 (CP3): Dedup/idempotência da reconciliação de insights
*Para quaisquer* anomalias ativas e insights existentes, `reconcileInsights` não reabre `dedup_key`
ativo (≤ 1 ativo por situação) e é idempotente (reaplicar ⇒ `toOpen` vazio); chaves extintas vão
para `toDismiss`. **Validates:** Req 5.4, 3.6.

### Property 4 (CP4): Idempotência/versionamento de ack/dismiss
*Para qualquer* insight e sequência de operações, `applyInsightOp`: ack de `ACKNOWLEDGED`/dismiss de
`DISMISSED` ⇒ `_SKIPPED` sem mutar; `expected_updated_at` divergente ⇒ `stale`; `DISMISSED` terminal
(ack ⇒ `invalid_transition`); N acks ⇒ 1 transição + N−1 skips. **Validates:** Req 9.1–9.4.

### Property 5 (CP5): Determinismo do `Summary_Builder` + sem PII
*Para qualquer* agregado, `buildSummaryText` é determinística e a saída não contém PII/segredos;
`summaryDedupKey` é estável por período/bucket (idempotência do resumo). **Validates:** Req 8.

### Property 6 (CP6): Precedência de `permission_denied`
*Para qualquer* RPC e caller sem permissão, o resultado é `permission_denied` **mesmo** com erro de
validação simultâneo, independentemente do papel. **Validates:** Req 9.5, 1.4, 12.1.

### Property 7 (CP7): Isolamento e não-vazamento
*Para qualquer* `Supervisor_Context`, `detail` de diagnóstico/insight ou `Periodic_Summary`, a saída
não contém PII (e-mail/telefone/CPF/CNPJ), conteúdo de mensagens nem segredos (`expectNoSecrets`); e
caller sem permissão não recebe dados. **Validates:** Req 2.3, 3.5, 11.2.

### Property 8 (CP8): Ordenação determinística
*Para qualquer* conjunto, `compareInsights`/`compareDiagnostics` definem ordem total (antissimétrica,
transitiva, estável); ordenar qualquer permutação dá a mesma sequência. **Validates:** Req 10.1.

### Property 9 (CP9): Totalidade do `Question_Context_Plan`
*Para qualquer* pergunta, `planIntents` é total/determinística e retorna ao menos um intent (default
`OVERVIEW`); palavras-chave conhecidas mapeiam para os intents corretos. **Validates:** Req 2.1.

---

## Error Handling

| Cenário | Tratamento |
| --- | --- |
| `auth.uid()` nulo em RPC gated | `RAISE permission_denied` (42501) |
| Sem permissão | log `SUPERVISOR_VIEW_DENIED` (na RPC) → `permission_denied`; **precedência** sobre validação (CP6). O log negativo é revertido pelo `RAISE` (1 txn/PostgREST) — integração assere o 42501, não a persistência |
| `expected_updated_at` divergente | `STALE_VERSION` → toast + refetch |
| ack/dismiss repetido | `_SKIPPED` + `*_SKIPPED` gravado **na RPC**; toast neutro |
| ack de insight `DISMISSED` | `INVALID_STATE_TRANSITION` (terminal) |
| Provider de IA ausente/erro | resposta pt-BR de indisponibilidade (degradação); diagnóstico/anomalia/resumo seguem |
| Fonte de monitoramento ausente | `Anomaly_Detector` omite o tipo (sem fabricar); sub-bloco `BEGIN..EXCEPTION` no `evaluate` loga e prossegue |
| Falha de audit logging | **não** bloqueia a mutação (testing-governance) |
| Master `Nexus_Vortex99` | mutações desta spec não tocam `users` (imutável por construção) |
| Filtro inválido (front) | bloqueia envio **e** exibe mensagem pt-BR; backend revalida |

Mensagens user-facing em pt-BR (`SUPERVISOR_ERROR_MESSAGES`); error codes em inglês.

---

## Testing Strategy

**Property-based** (fast-check, mín. 100 iterações) para os invariantes do núcleo puro; **exemplo/
edge/integração/smoke** para o resto. Convenções do projeto: `vi.mock` hoisted (spies via
`globalThis`); `fc.stringOf` não existe; PII via `fc.constantFrom`. Helpers canônicos reusados.

### Mapa Propriedade → arquivo (`src/__tests__/admin/supervisor/`)
| CP | Arquivo | Alvo |
| --- | --- | --- |
| CP1 | `cp1_severity_classifier.property.test.ts` | `severityClassifier.classifySeverity` |
| CP2 | `cp2_anomaly_detector.property.test.ts` | `anomalyDetector.detectAnomalies` |
| CP3 | `cp3_reconcile_dedup.property.test.ts` | `anomalyDetector.reconcileInsights` |
| CP4 | `cp4_insight_lifecycle.property.test.ts` | `insightLifecycle.applyInsightOp` |
| CP5 | `cp5_summary_builder.property.test.ts` | `summaryBuilder` |
| CP6 | `cp6_permission_precedence.property.test.ts` | service/guard + `mapSupervisorError` |
| CP7 | `cp7_isolation_no_leak.property.test.ts` | `sanitizeSupervisorDetail`/context/summary + `expectNoSecrets` |
| CP8 | `cp8_ordering.property.test.ts` | `ordering.compareInsights/compareDiagnostics` |
| CP9 | `cp9_question_context_plan.property.test.ts` | `questionContextPlan.planIntents` |

### Unit/serviço/UI
`pureFunctions.unit.test.ts`; `permissions_supervisor.unit.test.ts` (delta `SUPERVISOR_*`);
`supervisor_service.test.ts` (mapSupervisorError, list+sanitize, ack/dismiss `_SKIPPED`/`STALE`/
`INVALID`, audit-fail-não-bloqueia, askSupervisor degradação); `supervisorUI.test.tsx` (Stealth_404,
chat indisponível, diagnóstico read-only, ack/dismiss gated, filtro inválido + pt-BR, default 10,
sem `<h1>`, item sidebar).

### Cenários de falha
`STALE_VERSION`; `INVALID_STATE_TRANSITION`; `_SKIPPED`; `permission_denied` com validação simultânea
(CP6); provider ausente ⇒ degradação; fonte ausente ⇒ anomalia omitida; audit-fail-não-bloqueia
(`expectMutationSucceedsDespiteAuditFailure`).

### Integração (`tests/admin/supervisor/`, só CI — branch efêmero, `describeIntegration`)
RLS de `supervisor_diagnostics`/`supervisor_insights` (anon/Cliente/não-admin ⇒ 0; ADMIN lê; DML
direto negado); gating das RPCs (Cliente ⇒ 42501); paridade `is_admin_with_permission`
(`SUPERVISOR_VIEW`/`SUPERVISOR_MANAGE` só SUPER_ADMIN/ADMIN); `record_diagnostic` idempotente
(`occurrence_count++`); `supervisor_evaluate` abre/dedup/auto-dismiss + `SUPERVISOR_INSIGHT_GENERATED`
persistido; ack/dismiss audit (`_SKIPPED` + positivo via service two-step); `generate_summary`
idempotente por janela; migration 118 idempotência; master imutável.

### Smoke
Presença/forma da migration 118 + rollback; `DO $check$`; `GRANT/REVOKE` sem `anon`; `SET search_path
= public`; CHECK domains; índice único parcial.

### Validação em duas pontas e Regression_Suite
Validação no frontend **e** backend. Os testes unit/property/falha entram na Regression_Suite
(qualquer falha bloqueia merge/deploy). Núcleo puro vira `Critical_Module` em
`tests/coverage.config.ts`.

---

## Segurança e observabilidade

- **Isolamento/RLS**: `supervisor_diagnostics`/`supervisor_insights` admin-only (`SUPERVISOR_VIEW`;
  DML direto bloqueado). Leituras agregadas server-side em RPC `SECURITY DEFINER` expõem só
  contagens/estados — nenhum Cliente acessa.
- **Gating em duas camadas** + precedência de `permission_denied` (CP6).
- **Não-vazamento**: `Supervisor_Context` (só agregados), `detail` (sanitizado),
  `Periodic_Summary`/notificações **nunca** carregam PII nem segredos (CP7); o prompt ao provider não
  inclui PII. A chave do provider mora no Vault.
- **Master imutável**: ack/dismiss não tocam `users`.
- **Audit-by-construction**: positivos `SUPERVISOR_INSIGHT_ACK`/`_DISMISS` (service); na RPC:
  `SUPERVISOR_DIAGNOSTIC_RECORDED`, `SUPERVISOR_INSIGHT_GENERATED`, `*_SKIPPED`; negativo
  `SUPERVISOR_VIEW_DENIED`; `SUPERVISOR_CHAT_QUERY` (metadados). Audit guardado por
  `IF v_caller IS NOT NULL` no caminho cron.
- **Estabilidade**: falha de provider/fonte/insight é tratada e registrada; o sistema segue
  (degradação controlada), nunca expõe erro técnico ao cliente.
- **RPC posture (§10)**: `SET search_path = public`; `auth.uid()` checado; `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO authenticated` (+ `service_role` em `evaluate`/`generate_summary`/
  `record_diagnostic`); nunca exposta ao `anon`.
