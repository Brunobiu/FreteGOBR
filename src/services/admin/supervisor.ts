/**
 * services/admin/supervisor.ts — service da IA Supervisora.
 *
 * Wrappers finos sobre as RPCs SECURITY DEFINER da migration 118 + a edge
 * function `ia-supervisor` (chat). Reusa o estilo de `operacao.ts`: erro tipado
 * pt-BR com PRECEDÊNCIA de `permission_denied` (CP6), mutações idempotentes via
 * `runSkippableMutation` (audit positivo só em mutação real; `_SKIPPED` gravado
 * na própria RPC), e não-vazamento (detail sanitizado, contexto sem PII — CP7).
 *
 * A IA é READ-ONLY: nunca executa ação destrutiva. `askSupervisor` degrada para
 * "IA indisponível" quando o provider falha (não lança).
 *
 * Spec: .kiro/specs/admin-ia-supervisora/{requirements,design,tasks}.md (Tasks 4).
 */

import { supabase } from '../supabase';
import { logAdminAction } from './audit';
import { sanitizeSupervisorDetail, sanitizeSupervisorText } from './supervisor/sanitize';
import { planIntents } from './supervisor/questionContextPlan';
import {
  deriveTitle,
  validateMessage,
  CHAT_LIMITS,
  type ChatRole,
} from './supervisor/chatHistory';
import type { InsightSeverity } from './supervisor/severityClassifier';
import type { InsightState } from './supervisor/insightLifecycle';
import type { InsightType } from './supervisor/anomalyDetector';
import type { ContextIntent } from './supervisor/questionContextPlan';

// Superfície única de tipos para a UI.
export type { InsightSeverity } from './supervisor/severityClassifier';
export type { InsightState } from './supervisor/insightLifecycle';
export type { InsightType } from './supervisor/anomalyDetector';
export type { ContextIntent } from './supervisor/questionContextPlan';
export { sanitizeSupervisorDetail } from './supervisor/sanitize';
export { buildSummaryText } from './supervisor/summaryBuilder';

// ─── Tipos públicos (snake_case: vêm de to_jsonb das RPCs) ───────────────────

export interface SupervisorDiagnostic {
  id: string;
  module: string;
  operation: string;
  severity: InsightSeverity;
  error_code: string | null;
  description: string;
  probable_cause: string | null;
  suggested_fix: string | null;
  detail: Record<string, unknown>;
  dedup_key: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface SupervisorInsight {
  id: string;
  insight_type: InsightType;
  severity: InsightSeverity;
  state: InsightState;
  title: string;
  detail: Record<string, unknown>;
  dedup_key: string;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupervisorContext {
  intents: string[];
  metrics: unknown;
  alerts_open: number | null;
  insights_open: number | null;
  diagnostics_recent: number | null;
  generated_at: string;
}

export interface SupervisorChatResult {
  answer: string;
  degraded: boolean;
}

export interface DiagnosticFilters {
  module?: string;
  severity?: InsightSeverity;
  from?: string;
  to?: string;
}

export interface InsightFilters {
  type?: InsightType;
  severity?: InsightSeverity;
  state?: InsightState;
}

export interface EvaluateResult {
  opened: number;
  touched: number;
  dismissed: number;
}

export type GenerateSummaryResult = { id: string; skipped: false } | { skipped: true; reason: string };

/** Resultado de mutação idempotente (admin-patterns §4). */
export type MutationResult =
  | { ok: true; updated_at: string }
  | { skipped: true; reason: 'ALREADY_ACKNOWLEDGED' | 'ALREADY_DISMISSED' };

export type PageSize = 10 | 50 | 100;

// ─── Erros tipados ───────────────────────────────────────────────────────────

export type SupervisorErrorCode =
  | 'PERMISSION_DENIED'
  | 'STALE_VERSION'
  | 'NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNKNOWN';

export const SUPERVISOR_ERROR_MESSAGES: Record<SupervisorErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para esta operação.',
  STALE_VERSION: 'Outro admin atualizou este insight. Recarregando.',
  NOT_FOUND: 'Insight não encontrado.',
  INVALID_STATE_TRANSITION: 'Este insight não pode mudar para esse estado.',
  INVALID_INPUT: 'Dados inválidos.',
  TIMEOUT: 'A consulta demorou demais. Tente novamente.',
  NETWORK: 'Falha de conexão. Verifique sua internet e tente novamente.',
  UNKNOWN: 'Não foi possível concluir a operação.',
};

export class SupervisorError extends Error {
  constructor(
    public code: SupervisorErrorCode,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SupervisorError';
  }
}

/**
 * Mapeia erros do Postgres/Supabase para `SupervisorError`. A PRECEDÊNCIA de
 * `permission_denied` (ERRCODE 42501) é preservada: checada PRIMEIRO, antes de
 * qualquer erro de validação simultâneo (CP6). Mensagem user-facing sempre
 * canônica pt-BR — nunca o erro cru.
 */
export function mapSupervisorError(err: unknown): SupervisorError {
  if (err instanceof SupervisorError) return err;

  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  const wrap = (c: SupervisorErrorCode) =>
    new SupervisorError(c, SUPERVISOR_ERROR_MESSAGES[c], { original: msg });

  // Precedência: permission_denied PRIMEIRO (CP6).
  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  if (msg.includes('INVALID_STATE_TRANSITION')) return wrap('INVALID_STATE_TRANSITION');
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  if (msg.includes('INVALID_INPUT') || msg.includes('invalid_input')) return wrap('INVALID_INPUT');
  return wrap('UNKNOWN');
}

// ─── Adaptadores de linha (snake_case da RPC → tipos públicos) ───────────────

function rowToDiagnostic(row: unknown): SupervisorDiagnostic {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    module: String(r.module ?? ''),
    operation: String(r.operation ?? ''),
    severity: r.severity as InsightSeverity,
    error_code: (r.error_code as string | null) ?? null,
    description: String(r.description ?? ''),
    probable_cause: (r.probable_cause as string | null) ?? null,
    suggested_fix: (r.suggested_fix as string | null) ?? null,
    detail: sanitizeSupervisorDetail(r.detail),
    dedup_key: String(r.dedup_key ?? ''),
    occurrence_count: Number(r.occurrence_count ?? 0),
    first_seen_at: String(r.first_seen_at ?? ''),
    last_seen_at: String(r.last_seen_at ?? ''),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

function rowToInsight(row: unknown): SupervisorInsight {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    insight_type: r.insight_type as InsightType,
    severity: r.severity as InsightSeverity,
    state: r.state as InsightState,
    title: String(r.title ?? ''),
    detail: sanitizeSupervisorDetail(r.detail),
    dedup_key: String(r.dedup_key ?? ''),
    source: String(r.source ?? ''),
    first_seen_at: String(r.first_seen_at ?? ''),
    last_seen_at: String(r.last_seen_at ?? ''),
    acknowledged_at: (r.acknowledged_at as string | null) ?? null,
    acknowledged_by: (r.acknowledged_by as string | null) ?? null,
    dismissed_at: (r.dismissed_at as string | null) ?? null,
    dismissed_by: (r.dismissed_by as string | null) ?? null,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

// ─── Leituras ─────────────────────────────────────────────────────────────

/** Lista diagnósticos via RPC gated (SUPERVISOR_VIEW), detail sanitizado. */
export async function listDiagnostics(
  filters: DiagnosticFilters = {},
  page = 0,
  pageSize: PageSize = 10
): Promise<{ items: SupervisorDiagnostic[]; total: number }> {
  const { data, error } = await supabase.rpc('supervisor_diagnostics_list', {
    p_module: filters.module ?? null,
    p_severity: filters.severity ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as { items?: unknown[]; total?: number };
  return { items: (raw.items ?? []).map(rowToDiagnostic), total: raw.total ?? 0 };
}

/** Lista insights via RPC gated (SUPERVISOR_VIEW), detail sanitizado. */
export async function listInsights(
  filters: InsightFilters = {},
  page = 0,
  pageSize: PageSize = 10
): Promise<{ items: SupervisorInsight[]; total: number }> {
  const { data, error } = await supabase.rpc('supervisor_insights_list', {
    p_type: filters.type ?? null,
    p_severity: filters.severity ?? null,
    p_state: filters.state ?? null,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as { items?: unknown[]; total?: number };
  return { items: (raw.items ?? []).map(rowToInsight), total: raw.total ?? 0 };
}

/** Lê o Supervisor_Context (agregados, sem PII) via RPC gated (SUPERVISOR_VIEW). */
export async function getSupervisorContext(intents?: ContextIntent[]): Promise<SupervisorContext> {
  const { data, error } = await supabase.rpc('supervisor_chat_context', {
    p_intents: intents && intents.length ? intents : null,
  });
  if (error) throw mapSupervisorError(error);
  const r = (data ?? {}) as Partial<SupervisorContext>;
  return {
    intents: (r.intents as string[]) ?? [],
    metrics: r.metrics ?? {},
    alerts_open: (r.alerts_open as number | null) ?? null,
    insights_open: (r.insights_open as number | null) ?? null,
    diagnostics_recent: (r.diagnostics_recent as number | null) ?? null,
    generated_at: String(r.generated_at ?? ''),
  };
}

/**
 * Painel Inteligente (chat): pergunta NL → edge function `ia-supervisor`. A IA é
 * READ-ONLY. Degradação controlada: qualquer falha (provider ausente/erro/rede)
 * NÃO lança — retorna uma resposta pt-BR de indisponibilidade.
 */
export async function askSupervisor(question: string): Promise<SupervisorChatResult> {
  const intents = planIntents(question);
  try {
    const { data, error } = await supabase.functions.invoke('ia-supervisor', {
      body: { question, intents },
    });
    if (error) throw error;
    const raw = (data ?? {}) as { answer?: string; degraded?: boolean };
    return {
      answer: raw.answer && raw.answer.trim() ? raw.answer : 'IA indisponível no momento.',
      degraded: raw.degraded ?? false,
    };
  } catch {
    return {
      answer: 'IA indisponível no momento. Tente novamente em instantes.',
      degraded: true,
    };
  }
}

// ─── Mutações de insight (idempotentes; _SKIPPED não passa pelo wrapper) ─────

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
      reason: raw.reason === 'ALREADY_DISMISSED' ? 'ALREADY_DISMISSED' : 'ALREADY_ACKNOWLEDGED',
    };
  }
  return { ok: true, updated_at: raw.updated_at ?? '' };
}

/**
 * Executa uma RPC de mutação idempotente de insight: mapeia erro (precedência de
 * permission_denied) e, quando a operação foi REAL (não `_SKIPPED`), grava o
 * audit positivo best-effort — falha de audit NÃO bloqueia a mutação
 * (testing-governance). O `_SKIPPED` é gravado pela própria RPC.
 */
async function runSkippableMutation(
  audit: { action: 'SUPERVISOR_INSIGHT_ACK' | 'SUPERVISOR_INSIGHT_DISMISS'; targetId: string; after: unknown },
  rpc: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<MutationResult> {
  const { data, error } = await rpc();
  if (error) throw mapSupervisorError(error);
  const result = unwrapMutation(data);
  if ('ok' in result) {
    await logAdminAction({
      action: audit.action,
      targetType: 'supervisor_insights',
      targetId: audit.targetId,
      before: null,
      after: audit.after,
    }).catch(() => null);
  }
  return result;
}

/** Reconhece um insight (OPEN → ACKNOWLEDGED) com versionamento otimista. */
export async function acknowledgeInsight(
  id: string,
  expectedUpdatedAt: string
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'SUPERVISOR_INSIGHT_ACK', targetId: id, after: { state: 'ACKNOWLEDGED' } },
    () =>
      supabase.rpc('supervisor_insight_acknowledge', {
        p_id: id,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

/** Descarta um insight (OPEN/ACKNOWLEDGED → DISMISSED, terminal). */
export async function dismissInsight(
  id: string,
  expectedUpdatedAt: string
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'SUPERVISOR_INSIGHT_DISMISS', targetId: id, after: { state: 'DISMISSED' } },
    () =>
      supabase.rpc('supervisor_insight_dismiss', {
        p_id: id,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

/** Avaliação sob demanda das anomalias (gated SUPERVISOR_VIEW server-side). */
export async function triggerEvaluate(
  errorThreshold = 5,
  windowMinutes = 60
): Promise<EvaluateResult> {
  const { data, error } = await supabase.rpc('supervisor_evaluate', {
    p_error_threshold: errorThreshold,
    p_window_minutes: windowMinutes,
  });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as Partial<EvaluateResult>;
  return { opened: raw.opened ?? 0, touched: raw.touched ?? 0, dismissed: raw.dismissed ?? 0 };
}

/** Geração sob demanda do resumo periódico (idempotente por janela). */
export async function generateSummary(
  period: 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<GenerateSummaryResult> {
  const { data, error } = await supabase.rpc('supervisor_generate_summary', { p_period: period });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as { id?: string; skipped?: boolean; reason?: string };
  if (raw.skipped) return { skipped: true, reason: raw.reason ?? 'ALREADY_GENERATED' };
  return { id: raw.id ?? '', skipped: false };
}

/**
 * Registra um diagnóstico técnico. O `detail` é SANITIZADO no cliente antes de
 * enviar (defesa-em-profundidade; sem PII/segredos). Invocável por admin/monitor.
 */
export async function recordDiagnostic(input: {
  module: string;
  operation: string;
  severity?: InsightSeverity;
  errorCode?: string;
  description?: string;
  probableCause?: string;
  suggestedFix?: string;
  detail?: Record<string, unknown>;
  dedupKey?: string;
}): Promise<{ id: string; occurrence_count: number }> {
  const { data, error } = await supabase.rpc('supervisor_record_diagnostic', {
    p_module: input.module,
    p_operation: input.operation,
    p_severity: input.severity ?? 'WARNING',
    p_error_code: input.errorCode ?? null,
    p_description: input.description ?? '',
    p_probable_cause: input.probableCause ?? null,
    p_suggested_fix: input.suggestedFix ?? null,
    p_detail: sanitizeSupervisorDetail(input.detail ?? {}),
    p_dedup_key: input.dedupKey ?? null,
  });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as { id?: string; occurrence_count?: number };
  return { id: raw.id ?? '', occurrence_count: raw.occurrence_count ?? 0 };
}


// ─── Histórico de conversas do chat (supervisor-chat-history / 119) ─────────

export type { ChatRole } from './supervisor/chatHistory';
export { deriveTitle, CHAT_LIMITS } from './supervisor/chatHistory';

export interface SupervisorChatSession {
  id: string;
  admin_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SupervisorChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

/** Resultado de mutação idempotente de sessão (rename/delete). */
export type ChatMutationResult = { ok: true } | { skipped: true; reason: string };

function rowToChatSession(row: unknown): SupervisorChatSession {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    admin_id: String(r.admin_id ?? ''),
    title: String(r.title ?? ''),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

function rowToChatMessage(row: unknown): SupervisorChatMessage {
  const r = (row ?? {}) as Record<string, unknown>;
  // content é sanitizado também na leitura (defesa-em-profundidade; sem PII).
  return {
    id: String(r.id ?? ''),
    session_id: String(r.session_id ?? ''),
    role: (r.role === 'ai' ? 'ai' : 'user') as ChatRole,
    content: sanitizeSupervisorText(String(r.content ?? '')),
    created_at: String(r.created_at ?? ''),
  };
}

/** Cria uma conversa. Deriva o título da 1ª mensagem (puro, sem PII). */
export async function createChatSession(firstMessage?: string): Promise<{ id: string; title: string }> {
  const title = deriveTitle(firstMessage ?? '');
  const { data, error } = await supabase.rpc('supervisor_chat_session_create', { p_title: title });
  if (error) throw mapSupervisorError(error);
  const r = (data ?? {}) as { id?: string; title?: string };
  return { id: r.id ?? '', title: r.title ?? title };
}

/** Lista as conversas do admin (gated SUPERVISOR_VIEW; só do dono). */
export async function listChatSessions(): Promise<SupervisorChatSession[]> {
  const { data, error } = await supabase.rpc('supervisor_chat_sessions_list', {
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as { items?: unknown[] };
  return (raw.items ?? []).map(rowToChatSession);
}

/** Lista as mensagens de uma conversa (do dono; vazio se não for dono). */
export async function listChatMessages(sessionId: string): Promise<SupervisorChatMessage[]> {
  const { data, error } = await supabase.rpc('supervisor_chat_messages_list', {
    p_session: sessionId,
  });
  if (error) throw mapSupervisorError(error);
  const raw = (data ?? {}) as { items?: unknown[] };
  return (raw.items ?? []).map(rowToChatMessage);
}

/**
 * Anexa uma mensagem (user/ai) à conversa. O content é SANITIZADO (sem PII) e
 * validado antes de enviar. Best-effort: falha de persistência NÃO lança ao
 * chamador do chat (Req 6.2) — retorna null. Retorna `{ id }` em sucesso.
 */
export async function appendChatMessage(
  sessionId: string,
  role: ChatRole,
  content: string
): Promise<{ id: string } | null> {
  const sanitized = sanitizeSupervisorText(content).slice(0, CHAT_LIMITS.CONTENT_MAX);
  const v = validateMessage(role, sanitized);
  if (!v.ok) return null;
  try {
    const { data, error } = await supabase.rpc('supervisor_chat_message_append', {
      p_session: sessionId,
      p_role: role,
      p_content: sanitized,
    });
    if (error) throw mapSupervisorError(error);
    const r = (data ?? {}) as { id?: string };
    return { id: r.id ?? '' };
  } catch {
    // Persistência do histórico não pode quebrar o chat.
    return null;
  }
}

function unwrapChatMutation(data: unknown): ChatMutationResult {
  const raw = (data ?? {}) as { ok?: boolean; skipped?: boolean; reason?: string };
  if (raw.skipped) return { skipped: true, reason: raw.reason ?? 'SKIPPED' };
  return { ok: true };
}

/** Renomeia uma conversa do dono (1..TITLE_MAX). */
export async function renameChatSession(
  sessionId: string,
  title: string
): Promise<ChatMutationResult> {
  const { data, error } = await supabase.rpc('supervisor_chat_session_rename', {
    p_session: sessionId,
    p_title: title.slice(0, CHAT_LIMITS.TITLE_MAX),
  });
  if (error) throw mapSupervisorError(error);
  return unwrapChatMutation(data);
}

/** Exclui uma conversa do dono (idempotente; CASCADE nas mensagens). */
export async function deleteChatSession(sessionId: string): Promise<ChatMutationResult> {
  const { data, error } = await supabase.rpc('supervisor_chat_session_delete', {
    p_session: sessionId,
  });
  if (error) throw mapSupervisorError(error);
  return unwrapChatMutation(data);
}
