/**
 * services/admin/suporte.ts — service da Central de Suporte Inteligente.
 *
 * Wrappers finos sobre as RPCs SECURITY DEFINER (migration 115b). Mutações
 * reais via `executeAdminMutation` (audit-by-construction); operações
 * idempotentes (_SKIPPED) NÃO geram audit positivo (a própria RPC grava o
 * log _SKIPPED). Mapeamento de erros tipado (pt-BR) no padrão de `tickets.ts`.
 *
 * Spec: .kiro/specs/suporte-inteligente/{requirements,design,tasks}.md (Task 6).
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';
import type { TicketStatus } from './suporte/statusMachine';
import type { ResponderMode } from './suporte/responderModeReducer';
import type { PriorityLevel } from './suporte/priorityClassifier';
import type { FaqCategory, FaqPublicationState } from './suporte/validation';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export interface SupportConsoleTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  priorityLevel: PriorityLevel;
  responderMode: ResponderMode;
  createdAt: string;
  updatedAt: string;
  /** Nome do cliente (logado) ou do visitante (guest). */
  clientName: string | null;
  clientEmail: string | null;
  /** WhatsApp do cliente logado; null para visitante. */
  clientWhatsapp: string | null;
  /** Rótulo do plano contratado; "Sem plano" para visitante. */
  planoLabel: string;
  isGuest: boolean;
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  category: FaqCategory;
  publicationState: FaqPublicationState;
  createdAt: string;
  updatedAt: string;
}

export interface SupportAiConfig {
  enabled: boolean;
  confidenceThreshold: number;
  supportModel: string;
  updatedAt: string;
}

/** Resultado de mutação (admin-patterns §4). */
export type MutationResult =
  | { ok: true; updatedAt: string | null; messageId?: string }
  | { skipped: true; reason: string };

// ─── Erros tipados ──────────────────────────────────────────────────────────

export type SuporteErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'INVALID_STATUS_TRANSITION'
  | 'AI_LOCKED'
  | 'INVALID_INPUT'
  | 'UNKNOWN';

const SUPORTE_ERROR_MESSAGES: Record<SuporteErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Atendimento não encontrado.',
  STALE_VERSION: 'Outro admin atualizou. Recarregando.',
  INVALID_STATUS_TRANSITION: 'Transição de status inválida.',
  AI_LOCKED: 'A IA está bloqueada: um atendente humano assumiu este atendimento.',
  INVALID_INPUT: 'Dados inválidos. Verifique os campos.',
  UNKNOWN: 'Não foi possível concluir.',
};

export class SuporteError extends Error {
  readonly code: SuporteErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: SuporteErrorCode, details?: Record<string, unknown>, cause?: unknown) {
    super(SUPORTE_ERROR_MESSAGES[code]);
    this.name = 'SuporteError';
    this.code = code;
    this.details = details;
    if (cause !== undefined) (this as unknown as { cause: unknown }).cause = cause;
  }
}

/**
 * Mapeia erros do Postgres/Supabase para `SuporteError`. A precedência de
 * `permission_denied` (ERRCODE 42501) é preservada: é checada PRIMEIRO, antes
 * de qualquer erro de validação (Req 11.3).
 */
export function mapPostgresError(err: unknown): SuporteError {
  if (err instanceof SuporteError) return err;

  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  const wrap = (c: SuporteErrorCode) => new SuporteError(c, { original: msg }, err);

  // Precedência: permission_denied PRIMEIRO (Req 11.3).
  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  if (msg.includes('INVALID_STATUS_TRANSITION')) return wrap('INVALID_STATUS_TRANSITION');
  if (msg.includes('AI_LOCKED')) return wrap('AI_LOCKED');
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  if (msg.includes('INVALID_INPUT')) return wrap('INVALID_INPUT');
  return wrap('UNKNOWN');
}

// ─── Derivação de display do cliente ────────────────────────────────────────

interface TicketListRow {
  id: string;
  subject: string;
  status: string;
  priority_level: number;
  responder_mode: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  user_name: string | null;
  user_email: string | null;
  user_phone: string | null;
  subscription_status: string | null;
  is_subscribed: boolean | null;
  trial_ends_at: string | null;
}

/** Rótulo pt-BR do plano contratado a partir dos campos de `users`. */
export function derivePlanoLabel(row: {
  is_subscribed: boolean | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
}): string {
  if (row.is_subscribed) return 'Assinante';
  if (row.trial_ends_at && new Date(row.trial_ends_at).getTime() > Date.now()) return 'Em teste';
  if (row.subscription_status && row.subscription_status !== 'none') {
    return `Plano: ${row.subscription_status}`;
  }
  return 'Sem plano';
}

function rowToConsoleTicket(row: TicketListRow): SupportConsoleTicket {
  const isGuest = row.user_id === null;
  return {
    id: row.id,
    subject: row.subject,
    status: row.status as TicketStatus,
    priorityLevel: (row.priority_level as PriorityLevel) ?? 1,
    responderMode: row.responder_mode as ResponderMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientName: isGuest ? row.guest_name : row.user_name,
    clientEmail: isGuest ? row.guest_email : row.user_email,
    clientWhatsapp: isGuest ? null : row.user_phone,
    planoLabel: isGuest
      ? 'Sem plano'
      : derivePlanoLabel({
          is_subscribed: row.is_subscribed,
          subscription_status: row.subscription_status,
          trial_ends_at: row.trial_ends_at,
        }),
    isGuest,
  };
}

// ─── Leituras ───────────────────────────────────────────────────────────────

export interface ListTicketsFilters {
  status?: TicketStatus;
  priorityLevel?: PriorityLevel;
  responderMode?: ResponderMode;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

/** Lista atendimentos via RPC gated (SUPORTE_VIEW), com filtros server-side. */
export async function listTickets(
  filters: ListTicketsFilters = {},
  page = 0,
  pageSize = 10
): Promise<{ items: SupportConsoleTicket[]; total: number }> {
  const p_filters: Record<string, unknown> = {};
  if (filters.status) p_filters.status = filters.status;
  if (filters.priorityLevel != null) p_filters.priority_level = filters.priorityLevel;
  if (filters.responderMode) p_filters.responder_mode = filters.responderMode;
  if (filters.dateFrom) p_filters.date_from = filters.dateFrom;
  if (filters.dateTo) p_filters.date_to = filters.dateTo;
  if (filters.search && filters.search.trim()) p_filters.search = filters.search.trim();

  const { data, error } = await supabase.rpc('support_admin_list_tickets', {
    p_filters,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw mapPostgresError(error);

  const raw = (data ?? {}) as { items?: TicketListRow[]; total?: number };
  return {
    items: (raw.items ?? []).map(rowToConsoleTicket),
    total: raw.total ?? 0,
  };
}

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string;
  publication_state: string;
  created_at: string;
  updated_at: string;
}

function rowToFaq(row: FaqRow): FaqEntry {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category as FaqCategory,
    publicationState: row.publication_state as FaqPublicationState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lista FAQ via RPC gated (FAQ_VIEW). */
export async function listFaq(
  filters: { category?: FaqCategory; publicationState?: FaqPublicationState; search?: string } = {},
  page = 0,
  pageSize = 10
): Promise<{ items: FaqEntry[]; total: number }> {
  const p_filters: Record<string, unknown> = {};
  if (filters.category) p_filters.category = filters.category;
  if (filters.publicationState) p_filters.publication_state = filters.publicationState;
  if (filters.search && filters.search.trim()) p_filters.search = filters.search.trim();

  const { data, error } = await supabase.rpc('support_list_faq', {
    p_filters,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw mapPostgresError(error);

  const raw = (data ?? {}) as { items?: FaqRow[]; total?: number };
  return { items: (raw.items ?? []).map(rowToFaq), total: raw.total ?? 0 };
}

/** Lê a config singleton da Support_AI (RLS gated SUPORTE_VIEW). */
export async function getAiConfig(): Promise<SupportAiConfig | null> {
  const { data, error } = await supabase
    .from('support_ai_config')
    .select('enabled, confidence_threshold, support_model, updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) throw mapPostgresError(error);
  if (!data) return null;
  const r = data as {
    enabled: boolean;
    confidence_threshold: number | string;
    support_model: string;
    updated_at: string;
  };
  return {
    enabled: r.enabled,
    confidenceThreshold: typeof r.confidence_threshold === 'string'
      ? Number(r.confidence_threshold)
      : r.confidence_threshold,
    supportModel: r.support_model,
    updatedAt: r.updated_at,
  };
}

// ─── Helper interno: mutação idempotente (skip não gera audit positivo) ─────

function unwrapMutation(data: unknown): MutationResult {
  const raw = (data ?? {}) as {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    updated_at?: string;
    message_id?: string;
  };
  if (raw.skipped) return { skipped: true, reason: raw.reason ?? 'SKIPPED' };
  return { ok: true, updatedAt: raw.updated_at ?? null, messageId: raw.message_id };
}

/**
 * Executa uma RPC de mutação idempotente: mapeia erro, e quando a operação foi
 * REAL (não _SKIPPED) grava o audit positivo (best-effort — falha de audit não
 * bloqueia a mutação, decisão `testing-governance`). O _SKIPPED é gravado pela
 * própria RPC e NÃO passa pelo audit positivo.
 */
async function runSkippableMutation(
  audit: { action: string; targetId: string; before?: unknown; after?: unknown },
  rpc: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<MutationResult> {
  const { data, error } = await rpc();
  if (error) throw mapPostgresError(error);
  const result = unwrapMutation(data);
  if ('ok' in result) {
    await logAdminAction({
      action: audit.action,
      targetType: 'support_tickets',
      targetId: audit.targetId,
      before: audit.before ?? null,
      after: audit.after ?? null,
    });
  }
  return result;
}

// ─── Mutações de atendimento ────────────────────────────────────────────────

export async function changeStatus(
  ticketId: string,
  target: TicketStatus,
  expectedUpdatedAt: string | null
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'SUPORTE_STATUS_CHANGE', targetId: ticketId, after: { target } },
    () =>
      supabase.rpc('support_change_status', {
        p_ticket_id: ticketId,
        p_target_status: target,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

export async function setPriority(
  ticketId: string,
  level: PriorityLevel,
  expectedUpdatedAt: string | null
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'SUPORTE_PRIORITY_CHANGE', targetId: ticketId, after: { level } },
    () =>
      supabase.rpc('support_set_priority', {
        p_ticket_id: ticketId,
        p_level: level,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

export async function handoffToHuman(
  ticketId: string,
  expectedUpdatedAt: string | null
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'SUPORTE_HANDOFF', targetId: ticketId },
    () =>
      supabase.rpc('support_handoff_to_human', {
        p_ticket_id: ticketId,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

export async function returnToAi(
  ticketId: string,
  expectedUpdatedAt: string | null
): Promise<MutationResult> {
  return runSkippableMutation(
    { action: 'SUPORTE_RETURN_TO_AI', targetId: ticketId },
    () =>
      supabase.rpc('support_return_to_ai', {
        p_ticket_id: ticketId,
        p_expected_updated_at: expectedUpdatedAt,
      })
  );
}

/**
 * Resposta humana: a RPC faz o flip atômico ai→human quando necessário.
 * Grava audit SUPORTE_HANDOFF apenas quando houve flip (handed_off).
 */
export async function insertHumanReply(
  ticketId: string,
  body: string,
  expectedUpdatedAt: string | null
): Promise<{ ok: true; messageId: string; updatedAt: string | null; handedOff: boolean }> {
  const { data, error } = await supabase.rpc('support_insert_human_reply', {
    p_ticket_id: ticketId,
    p_body: body,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw mapPostgresError(error);
  const raw = (data ?? {}) as {
    ok?: boolean;
    message_id?: string;
    updated_at?: string;
    handed_off?: boolean;
  };
  if (!raw.message_id) throw new SuporteError('UNKNOWN', { reason: 'rpc_response_malformed' });
  if (raw.handed_off) {
    await logAdminAction({ action: 'SUPORTE_HANDOFF', targetType: 'support_tickets', targetId: ticketId });
  }
  return {
    ok: true,
    messageId: raw.message_id,
    updatedAt: raw.updated_at ?? null,
    handedOff: raw.handed_off ?? false,
  };
}

// ─── Mutações da FAQ ──────────────────────────────────────────────────────

export async function createFaq(input: {
  question: string;
  answer: string;
  category: FaqCategory;
  publicationState?: FaqPublicationState;
}): Promise<{ id: string; updatedAt: string }> {
  return executeAdminMutation(
    { action: 'FAQ_CREATE', targetType: 'support_kb_entries', after: { category: input.category } },
    async () => {
      const { data, error } = await supabase.rpc('support_create_faq', {
        p_question: input.question,
        p_answer: input.answer,
        p_category: input.category,
        p_publication_state: input.publicationState ?? 'rascunho',
      });
      if (error) throw mapPostgresError(error);
      const raw = (data ?? {}) as { id?: string; updated_at?: string };
      if (!raw.id) throw new SuporteError('UNKNOWN', { reason: 'rpc_response_malformed' });
      return { id: raw.id, updatedAt: raw.updated_at ?? '' };
    }
  );
}

export async function updateFaq(
  id: string,
  patch: Partial<{
    question: string;
    answer: string;
    category: FaqCategory;
    publicationState: FaqPublicationState;
  }>,
  expectedUpdatedAt: string | null
): Promise<{ ok: true; updatedAt: string }> {
  const p_patch: Record<string, unknown> = {};
  if (patch.question !== undefined) p_patch.question = patch.question;
  if (patch.answer !== undefined) p_patch.answer = patch.answer;
  if (patch.category !== undefined) p_patch.category = patch.category;
  if (patch.publicationState !== undefined) p_patch.publication_state = patch.publicationState;

  return executeAdminMutation(
    { action: 'FAQ_UPDATE', targetType: 'support_kb_entries', targetId: id },
    async () => {
      const { data, error } = await supabase.rpc('support_update_faq', {
        p_id: id,
        p_patch,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapPostgresError(error);
      const raw = (data ?? {}) as { updated_at?: string };
      return { ok: true as const, updatedAt: raw.updated_at ?? '' };
    }
  );
}

export async function deleteFaq(id: string): Promise<MutationResult> {
  const { data, error } = await supabase.rpc('support_delete_faq', { p_id: id });
  if (error) throw mapPostgresError(error);
  const result = unwrapMutation(data);
  if ('ok' in result) {
    await logAdminAction({ action: 'FAQ_DELETE', targetType: 'support_kb_entries', targetId: id });
  }
  return result;
}

// ─── Config da Support_AI ─────────────────────────────────────────────────

export async function updateAiConfig(
  patch: Partial<{ enabled: boolean; confidenceThreshold: number; supportModel: string }>,
  expectedUpdatedAt: string | null
): Promise<{ ok: true; updatedAt: string }> {
  const p_patch: Record<string, unknown> = {};
  if (patch.enabled !== undefined) p_patch.enabled = patch.enabled;
  if (patch.confidenceThreshold !== undefined) p_patch.confidence_threshold = patch.confidenceThreshold;
  if (patch.supportModel !== undefined) p_patch.support_model = patch.supportModel;

  return executeAdminMutation(
    { action: 'SUPORTE_AI_CONFIG_UPDATE', targetType: 'support_ai_config' },
    async () => {
      const { data, error } = await supabase.rpc('support_update_ai_config', {
        p_patch,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapPostgresError(error);
      const raw = (data ?? {}) as { updated_at?: string };
      return { ok: true as const, updatedAt: raw.updated_at ?? '' };
    }
  );
}

// ─── Detalhe do atendimento (thread) ────────────────────────────────────────

export interface SupportConsoleMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorKind: 'user' | 'admin' | 'ai';
  body: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface SupportTicketDetail {
  id: string;
  subject: string;
  status: TicketStatus;
  priorityLevel: PriorityLevel;
  responderMode: ResponderMode;
  createdAt: string;
  updatedAt: string;
  clientName: string | null;
  clientEmail: string | null;
  clientWhatsapp: string | null;
  isGuest: boolean;
  messages: SupportConsoleMessage[];
}

interface TicketDetailRow {
  id: string;
  subject: string;
  status: string;
  priority_level: number;
  responder_mode: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
}

interface TicketMessageRow {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_kind: string;
  body: string;
  is_admin: boolean;
  created_at: string;
}

/**
 * Detalhe de um atendimento + thread de mensagens. RLS gateia por SUPORTE_VIEW.
 * Quando o atendimento é de cliente logado, busca nome/e-mail/telefone (USER_VIEW);
 * a falha dessa busca degrada de forma controlada (mantém o atendimento).
 */
export async function getTicketDetail(id: string): Promise<SupportTicketDetail> {
  const [ticketRes, msgsRes] = await Promise.all([
    supabase
      .from('support_tickets')
      .select(
        'id, subject, status, priority_level, responder_mode, created_at, updated_at, user_id, guest_name, guest_email'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('support_ticket_messages')
      .select('id, ticket_id, author_id, author_kind, body, is_admin, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (ticketRes.error) throw mapPostgresError(ticketRes.error);
  if (!ticketRes.data) throw new SuporteError('NOT_FOUND');
  if (msgsRes.error) throw mapPostgresError(msgsRes.error);

  const t = ticketRes.data as TicketDetailRow;
  const isGuest = t.user_id === null;

  let clientName: string | null = t.guest_name;
  let clientEmail: string | null = t.guest_email;
  let clientWhatsapp: string | null = null;

  if (!isGuest && t.user_id) {
    // Degradação controlada: falha ao buscar o cliente não derruba o detalhe.
    const userRes = await supabase
      .from('users')
      .select('name, email, phone')
      .eq('id', t.user_id)
      .maybeSingle();
    if (!userRes.error && userRes.data) {
      const u = userRes.data as { name: string | null; email: string | null; phone: string | null };
      clientName = u.name;
      clientEmail = u.email;
      clientWhatsapp = u.phone;
    }
  }

  return {
    id: t.id,
    subject: t.subject,
    status: t.status as TicketStatus,
    priorityLevel: (t.priority_level as PriorityLevel) ?? 1,
    responderMode: t.responder_mode as ResponderMode,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    clientName,
    clientEmail,
    clientWhatsapp,
    isGuest,
    messages: (msgsRes.data ?? []).map((r) => {
      const m = r as TicketMessageRow;
      return {
        id: m.id,
        ticketId: m.ticket_id,
        authorId: m.author_id,
        authorKind: (m.author_kind as 'user' | 'admin' | 'ai') ?? 'user',
        body: m.body,
        isAdmin: m.is_admin,
        createdAt: m.created_at,
      };
    }),
  };
}
