/**
 * services/admin/operacao.ts — service da Central de Operação.
 *
 * Wrappers finos sobre as RPCs SECURITY DEFINER da migration 117, reusando o
 * estilo de `dashboard.ts` (adaptação de bundle agregado + timeout + erro
 * tipado pt-BR) para as leituras e o padrão skippable de `suporte.ts`
 * (`runSkippableMutation`) para as mutações de alerta.
 *
 * Decisão de auditoria (admin-patterns §1, §4 + testing-governance): o ack/
 * resolve grava o audit POSITIVO (`ALERT_ACK`/`ALERT_RESOLVE`) por construção,
 * mas SOMENTE quando a operação foi real — o caminho `_SKIPPED` NÃO passa pelo
 * wrapper positivo (a própria RPC grava `ALERT_ACK_SKIPPED`/`ALERT_RESOLVE_
 * SKIPPED`). A gravação do log positivo é best-effort: falha de audit NÃO
 * bloqueia a mutação.
 *
 * Funções puras exportadas (`buildLogSummary`, `sanitizeAlertDetailView`) são
 * alvo de CP8 (isolamento e não-vazamento de PII/segredos). Mapeamento de erros
 * tipado com PRECEDÊNCIA de `permission_denied` (CP7).
 *
 * Spec: .kiro/specs/admin-central-operacao/{requirements,design,tasks}.md (Task 4).
 */

import { supabase } from '../supabase';
import { logAdminAction } from './audit';
import { adaptOperationsBundle } from './operacao/metricsShape';
import type { AlertType, AlertSeverity, AlertState } from './operacao/alertEvaluator';
import { LOG_EVENT_LABEL, type LogEventType } from './operacao/logEventMap';

// Re-export dos tipos do núcleo puro para a UI consumir por uma única superfície.
export type {
  OperationsMetricsBundle,
  DashboardKpi,
  OperationsKpiKey,
  OperationsGroupKey,
} from './operacao/metricsShape';
export type { AlertType, AlertSeverity, AlertState } from './operacao/alertEvaluator';
export type { LogEventType } from './operacao/logEventMap';

import type { OperationsMetricsBundle } from './operacao/metricsShape';

// ─── Tipos públicos (snake_case: vêm de to_jsonb/row_to_json das RPCs) ───────

/** Linha de `system_alerts` (saída de `admin_alerts_list`, via `to_jsonb`). */
export interface SystemAlert {
  id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  state: AlertState;
  source_type: string;
  source_id: string;
  dedup_key: string;
  title: string;
  detail: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Entrada de log resolvida pela RPC `admin_logs_list` (Log_Event_Map + rótulo). */
export interface LogEntry {
  occurred_at: string;
  event_type: LogEventType;
  actor: string | null;
  target_type: string | null;
  target_id: string | null;
  summary: string;
}

export interface AlertFilters {
  state?: AlertState;
  type?: AlertType;
  severity?: AlertSeverity;
}

export interface LogFilters {
  eventTypes?: LogEventType[];
  from?: string;
  to?: string;
  actor?: string;
  targetType?: string;
}

export interface EvaluateResult {
  opened: number;
  touched: number;
  resolved: number;
}

/** Resultado de mutação idempotente (admin-patterns §4). */
export type MutationResult =
  | { ok: true; updated_at: string }
  | { skipped: true; reason: 'ALREADY_ACKNOWLEDGED' | 'ALREADY_RESOLVED' };

/** Tamanhos de página suportados (Req 10.5). */
export type PageSize = 10 | 50 | 100;

// ─── Erros tipados ───────────────────────────────────────────────────────────

export type OperacaoErrorCode =
  | 'PERMISSION_DENIED'
  | 'STALE_VERSION'
  | 'NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNKNOWN';

export const OPERACAO_ERROR_MESSAGES: Record<OperacaoErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para esta operação.',
  STALE_VERSION: 'Outro admin atualizou este alerta. Recarregando.',
  NOT_FOUND: 'Alerta não encontrado.',
  INVALID_STATE_TRANSITION: 'Este alerta não pode mudar para esse estado.',
  INVALID_INPUT: 'Dados inválidos.',
  TIMEOUT: 'A consulta demorou demais. Tente novamente.',
  NETWORK: 'Falha de conexão. Verifique sua internet e tente novamente.',
  UNKNOWN: 'Não foi possível concluir a operação.',
};

export class OperacaoError extends Error {
  constructor(
    public code: OperacaoErrorCode,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OperacaoError';
  }
}

/**
 * Mapeia erros do Postgres/Supabase para `OperacaoError`. A PRECEDÊNCIA de
 * `permission_denied` (ERRCODE 42501) é preservada: é checada PRIMEIRO, antes de
 * qualquer erro de validação simultâneo (CP7). A mensagem user-facing é sempre
 * o texto canônico pt-BR — nunca o erro cru (sem vazar detalhes técnicos).
 */
export function mapOperacaoError(err: unknown): OperacaoError {
  if (err instanceof OperacaoError) return err;

  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  const wrap = (c: OperacaoErrorCode) =>
    new OperacaoError(c, OPERACAO_ERROR_MESSAGES[c], { original: msg });

  // Precedência: permission_denied PRIMEIRO (CP7, Req 9.10/12.5/13.1).
  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  if (msg.includes('INVALID_STATE_TRANSITION')) return wrap('INVALID_STATE_TRANSITION');
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  if (msg.includes('INVALID_INPUT') || msg.includes('invalid_input')) return wrap('INVALID_INPUT');
  return wrap('UNKNOWN');
}

// ─── Não-vazamento de PII/segredos (puro — alvo de CP8) ──────────────────────

/**
 * Padrões de PII/segredo que NUNCA podem aparecer no `detail` de um alerta nem
 * em qualquer saída exibível. Conservador por design: prefere super-redigir a
 * deixar vazar (Req 5.5, 6.8, 12.4, 13.4).
 */
const PII_SECRET_PATTERNS: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // e-mail
  /\(?\d{2}\)?[\s-]?9?\d{4}-?\d{4}/, // telefone BR (10-11 dígitos)
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/, // bcrypt
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\b(?:sb_secret_|sbp_|re_)[A-Za-z0-9_-]{10,}/, // chaves de serviço (Supabase/Resend)
  /AKIA[0-9A-Z]{16}/, // AWS access key
];

/** Nomes de campo sensíveis: a chave inteira é DESCARTADA (não só o valor). */
const SENSITIVE_KEY_RE =
  /(?:^|_)(?:password|senha|secret|token|api[_-]?key|authorization|cookie|email|e[_-]?mail|phone|telefone|cpf|cnpj)(?:_|$)/i;

const REDACTED = '[oculto]';

function looksSensitive(value: string): boolean {
  return PII_SECRET_PATTERNS.some((re) => re.test(value));
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return looksSensitive(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') return sanitizeObject(value as Record<string, unknown>);
  return value; // number | boolean | null | undefined: nunca carregam PII
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) continue; // chave sensível: descarta por completo
    out[k] = sanitizeValue(v);
  }
  return out;
}

/**
 * Sanitiza o `detail` de um `System_Alert` para exibição, removendo qualquer
 * PII/segredo (e-mail, telefone, CPF, CNPJ, hashes, tokens). PURO e total.
 * Por construção a RPC já só grava contexto não sensível; esta função é a
 * defesa-em-profundidade do client (alvo de CP8).
 */
export function sanitizeAlertDetailView(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  return sanitizeObject(detail as Record<string, unknown>);
}

/**
 * Resumo pt-BR fixo por `Log_Event_Type` (espelha o CASE da RPC `admin_logs_list`).
 * PURO e total: sempre um rótulo canônico, sem PII nem detalhes livres (CP8).
 * Tipos fora do domínio (defensivo) caem em 'Evento'.
 */
export function buildLogSummary(eventType: LogEventType): string {
  return LOG_EVENT_LABEL[eventType] ?? 'Evento';
}

// ─── Adaptadores de linha (snake_case da RPC → tipos públicos) ───────────────

function rowToSystemAlert(row: unknown): SystemAlert {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    alert_type: r.alert_type as AlertType,
    severity: r.severity as AlertSeverity,
    state: r.state as AlertState,
    source_type: String(r.source_type ?? ''),
    source_id: String(r.source_id ?? ''),
    dedup_key: String(r.dedup_key ?? ''),
    title: String(r.title ?? ''),
    detail: sanitizeAlertDetailView(r.detail),
    first_seen_at: String(r.first_seen_at ?? ''),
    last_seen_at: String(r.last_seen_at ?? ''),
    acknowledged_at: (r.acknowledged_at as string | null) ?? null,
    acknowledged_by: (r.acknowledged_by as string | null) ?? null,
    resolved_at: (r.resolved_at as string | null) ?? null,
    resolved_by: (r.resolved_by as string | null) ?? null,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

function rowToLogEntry(row: unknown): LogEntry {
  const r = (row ?? {}) as Record<string, unknown>;
  const eventType = r.event_type as LogEventType;
  return {
    occurred_at: String(r.occurred_at ?? ''),
    event_type: eventType,
    actor: (r.actor as string | null) ?? null,
    target_type: (r.target_type as string | null) ?? null,
    target_id: (r.target_id as string | null) ?? null,
    // Reforça o rótulo canônico (defesa-em-profundidade; a RPC já o fornece).
    summary: buildLogSummary(eventType),
  };
}

// ─── Leituras ─────────────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 10_000;

/**
 * Métricas operacionais (Operations_Metrics_Bundle) via RPC gated (DASHBOARD_VIEW),
 * com timeout de 10s e adaptação determinística (Partial_Degradation). Reusa o
 * estilo de `dashboard.ts`: timeout vira `OperacaoError('TIMEOUT')`; falha de
 * transporte vira `NETWORK`; `permission_denied` é preservado pela precedência.
 */
export async function getOperationsMetrics(
  onlineWindowSec = 300
): Promise<OperationsMetricsBundle> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new OperacaoError('TIMEOUT', OPERACAO_ERROR_MESSAGES.TIMEOUT)),
      RPC_TIMEOUT_MS
    );
  });
  try {
    const result = (await Promise.race([
      supabase.rpc('admin_operations_metrics', { p_online_window_sec: onlineWindowSec }),
      timeout,
    ])) as { data: unknown; error: unknown };
    if (result.error) throw mapOperacaoError(result.error);
    return adaptOperationsBundle(
      (result.data ?? {}) as Parameters<typeof adaptOperationsBundle>[0]
    );
  } catch (err) {
    if (err instanceof OperacaoError) throw err;
    throw new OperacaoError('NETWORK', (err as Error)?.message ?? OPERACAO_ERROR_MESSAGES.NETWORK);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Lista alertas via RPC gated (ALERT_VIEW), ordenada e paginada server-side. */
export async function listAlerts(
  filters: AlertFilters = {},
  page = 0,
  pageSize: PageSize = 10
): Promise<{ items: SystemAlert[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_alerts_list', {
    p_state: filters.state ?? null,
    p_type: filters.type ?? null,
    p_severity: filters.severity ?? null,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw mapOperacaoError(error);
  const raw = (data ?? {}) as { items?: unknown[]; total?: number };
  return { items: (raw.items ?? []).map(rowToSystemAlert), total: raw.total ?? 0 };
}

/** Lista logs via RPC gated (LOG_VIEW), somente-leitura, paginada server-side. */
export async function listLogs(
  filters: LogFilters = {},
  page = 0,
  pageSize: PageSize = 10
): Promise<{ items: LogEntry[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_logs_list', {
    p_event_types: filters.eventTypes && filters.eventTypes.length ? filters.eventTypes : null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_actor: filters.actor ?? null,
    p_target_type: filters.targetType ?? null,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw mapOperacaoError(error);
  const raw = (data ?? {}) as { items?: unknown[]; total?: number };
  return { items: (raw.items ?? []).map(rowToLogEntry), total: raw.total ?? 0 };
}

// ─── Mutações de alerta (idempotentes; _SKIPPED não passa pelo wrapper) ──────

function unwrapMutation(data: unknown): MutationResult {
  const raw = (data ?? {}) as {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    updated_at?: string;
  };
  if (raw.skipped) {
    return {
      skipped: true,
      reason: raw.reason === 'ALREADY_RESOLVED' ? 'ALREADY_RESOLVED' : 'ALREADY_ACKNOWLEDGED',
    };
  }
  return { ok: true, updated_at: raw.updated_at ?? '' };
}

/**
 * Executa uma RPC de mutação idempotente de alerta: mapeia erro (precedência de
 * permission_denied) e, quando a operação foi REAL (não `_SKIPPED`), grava o
 * audit positivo (`ALERT_ACK`/`ALERT_RESOLVE`) best-effort — falha de audit NÃO
 * bloqueia a mutação (testing-governance). O `_SKIPPED` é gravado pela própria
 * RPC e não passa pelo audit positivo.
 */
async function runSkippableMutation(
  audit: { action: 'ALERT_ACK' | 'ALERT_RESOLVE'; targetId: string; before: unknown; after: unknown },
  rpc: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<MutationResult> {
  const { data, error } = await rpc();
  if (error) throw mapOperacaoError(error);
  const result = unwrapMutation(data);
  if ('ok' in result) {
    await logAdminAction({
      action: audit.action,
      targetType: 'system_alerts',
      targetId: audit.targetId,
      before: audit.before,
      after: audit.after,
    }).catch(() => null);
  }
  return result;
}

/**
 * Reconhece um alerta (OPEN → ACKNOWLEDGED) com versionamento otimista. Ack de
 * alerta já `ACKNOWLEDGED` retorna `_SKIPPED`; `RESOLVED` retorna
 * `INVALID_STATE_TRANSITION`; `expected_updated_at` divergente, `STALE_VERSION`.
 */
export async function acknowledgeAlert(
  id: string,
  expectedUpdatedAt: string
): Promise<MutationResult> {
  return runSkippableMutation(
    {
      action: 'ALERT_ACK',
      targetId: id,
      before: { state: 'OPEN' },
      after: { state: 'ACKNOWLEDGED' },
    },
    () =>
      supabase.rpc('admin_alert_acknowledge', {
        p_id: id,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

/**
 * Resolve um alerta (OPEN/ACKNOWLEDGED → RESOLVED) com versionamento otimista.
 * Resolve de alerta já `RESOLVED` retorna `_SKIPPED`; `expected_updated_at`
 * divergente, `STALE_VERSION`. RESOLVED é terminal.
 */
export async function resolveAlert(
  id: string,
  expectedUpdatedAt: string
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'ALERT_RESOLVE', targetId: id, before: null, after: { state: 'RESOLVED' } },
    () =>
      supabase.rpc('admin_alert_resolve', {
        p_id: id,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

/**
 * Avaliação manual de alertas sob demanda (gated ALERT_VIEW server-side; o
 * caminho pg_cron usa service_role). Reconciliação idempotente: retorna o
 * número de alertas abertos/tocados/resolvidos.
 */
export async function triggerEvaluate(
  expiringWindowDays = 3,
  awaitingThresholdMin = 30
): Promise<EvaluateResult> {
  const { data, error } = await supabase.rpc('admin_alerts_evaluate', {
    p_expiring_window_days: expiringWindowDays,
    p_awaiting_threshold_min: awaitingThresholdMin,
  });
  if (error) throw mapOperacaoError(error);
  const raw = (data ?? {}) as Partial<EvaluateResult>;
  return { opened: raw.opened ?? 0, touched: raw.touched ?? 0, resolved: raw.resolved ?? 0 };
}
