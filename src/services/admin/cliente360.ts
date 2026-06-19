/**
 * services/admin/cliente360.ts — Cliente_360_Service.
 *
 * AMPLIA getUserDetail (admin-users) com os blocos plano/financeiro/suporte/
 * mensagens/login/notas, mantendo a degradacao parcial (Promise.allSettled +
 * mapa `errors`). O Source_Block (cadastrais, de getUserDetail) e o UNICO que
 * pode lancar NOT_FOUND. Blocos gated (financeiro/suporte/notas) sao OMITIDOS
 * do bundle quando o caller nao tem a permissao (sem PII parcial). Mutacoes de
 * Internal_Note via executeAdminMutation (audit-by-construction); o _SKIPPED da
 * remocao vem do retorno da RPC.
 *
 * Wrappers finos sobre as RPCs SECURITY DEFINER da migration 116. Mapeamento de
 * erros tipado (pt-BR) no padrao de tickets.ts/suporte.ts, com PRECEDENCIA de
 * permission_denied. Nunca loga PII bruta nem segredos.
 *
 * Spec: .kiro/specs/admin-cliente-360/{requirements,design,tasks}.md (Task 6).
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';
import {
  getUserDetail,
  UsersServiceError,
  type UserDetailBundle,
  type UserChatMetadata,
} from './users';
import { compareSearchResults, type SearchResult } from './cliente360/ranking';

export type { SearchResult } from './cliente360/ranking';

// ─── Permissoes resolvidas no componente (useAdminPermission) ────────────────

export interface Cliente360Caps {
  financeiro: boolean; // FINANCEIRO_VIEW
  suporte: boolean; // SUPORTE_VIEW
  notas: boolean; // USER_NOTE_VIEW
  suporteReply: boolean; // SUPORTE_REPLY (link "abrir conversa")
}

// ─── Tipos de bloco ──────────────────────────────────────────────────────────

export interface PlanoLabel {
  subscription_status: string;
  is_subscribed: boolean;
  trial_ends_at: string | null;
  // enriquecido pela Financial_History_RPC quando caps.financeiro:
  plan?: string | null;
  payment_method?: string | null;
  status?: string | null;
  next_charge_at?: string | null;
  grace_ends_at?: string | null;
}

export interface SubscriptionPlan {
  plan: string;
  payment_method: string;
  status: string;
  started_at: string | null;
  next_charge_at: string | null;
  grace_ends_at: string | null;
  [k: string]: unknown;
}

export interface ChargeRow {
  id: string;
  amount: number;
  payment_method: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface RepasseRow {
  id: string;
  valor_bruto: number;
  commission_value: number;
  valor_liquido: number;
  status: string;
  closed_at: string | null;
  paid_at: string | null;
  role: 'embarcador' | 'motorista';
}

export interface FinancialHistory {
  plan: SubscriptionPlan | null;
  charges: ChargeRow[];
  repasses: RepasseRow[];
}

export interface SupportTicketMeta {
  id: string;
  subject: string;
  status: string;
  priority_level: number;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface SupportHistory {
  tickets: SupportTicketMeta[];
}

export interface ConversationMeta {
  conversation_id: string;
  total_messages: number;
  last_message_at: string | null;
  counterpart: 'motorista' | 'embarcador';
}

export interface MessageHistory {
  frete: ConversationMeta[];
  suporteChat: UserChatMetadata[];
}

export interface LoginAttemptRow {
  created_at: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

export interface LoginHistory {
  attempts: LoginAttemptRow[];
  retentionDays: number;
  hasPhone: boolean;
}

export interface InternalNote {
  id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Bundle 360: estende UserDetailBundle. Blocos gated AUSENTES (chave undefined)
 * quando o caller nao tem permissao (CP-8: omissao sem PII parcial).
 */
export interface Cliente360Bundle extends UserDetailBundle {
  plano: PlanoLabel | null;
  financeiro?: FinancialHistory; // omitido sem FINANCEIRO_VIEW
  suporte?: SupportHistory; // omitido sem SUPORTE_VIEW
  mensagens: MessageHistory | null; // sempre presente (USER_VIEW); vazio != omitido
  login: LoginHistory | null; // sempre presente (USER_VIEW)
  notas?: InternalNote[]; // omitido sem USER_NOTE_VIEW
  errors: UserDetailBundle['errors'] &
    Partial<Record<'plano' | 'financeiro' | 'suporte' | 'mensagens' | 'login' | 'notas', string>>;
}

// ─── Erros tipados ────────────────────────────────────────────────────────────

export type Cliente360ErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'ALREADY_REMOVED'
  | 'INVALID_INPUT'
  | 'MASTER_ADMIN_IMMUTABLE'
  | 'BLOCK_UNAVAILABLE'
  | 'UNKNOWN';

const CLIENTE360_ERROR_MESSAGES: Record<Cliente360ErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Cliente não encontrado.',
  STALE_VERSION: 'Outro admin atualizou. Recarregando.',
  ALREADY_REMOVED: 'Esta nota já estava removida.',
  INVALID_INPUT: 'A observação deve ter entre 1 e 5000 caracteres.',
  MASTER_ADMIN_IMMUTABLE: 'Master_Admin é imutável.',
  BLOCK_UNAVAILABLE: 'Bloco indisponível.',
  UNKNOWN: 'Não foi possível concluir.',
};

export class Cliente360Error extends Error {
  readonly code: Cliente360ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: Cliente360ErrorCode, details?: Record<string, unknown>, cause?: unknown) {
    super(CLIENTE360_ERROR_MESSAGES[code]);
    this.name = 'Cliente360Error';
    this.code = code;
    this.details = details;
    if (cause !== undefined) (this as unknown as { cause: unknown }).cause = cause;
  }
}

/**
 * Mapeia erros do Postgres/Supabase para Cliente360Error. A PRECEDENCIA de
 * permission_denied (ERRCODE 42501) e preservada: e checada PRIMEIRO, antes de
 * qualquer erro de validacao simultaneo (CP-5). Nunca inclui PII bruta.
 */
export function mapPostgresError(err: unknown): Cliente360Error {
  if (err instanceof Cliente360Error) return err;
  if (err instanceof UsersServiceError) {
    if (err.code === 'NOT_FOUND') return new Cliente360Error('NOT_FOUND', undefined, err);
    if (err.code === 'PERMISSION_DENIED') return new Cliente360Error('PERMISSION_DENIED', undefined, err);
    if (err.code === 'STALE_VERSION') return new Cliente360Error('STALE_VERSION', undefined, err);
    if (err.code === 'MASTER_ADMIN_IMMUTABLE')
      return new Cliente360Error('MASTER_ADMIN_IMMUTABLE', undefined, err);
  }

  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  const wrap = (c: Cliente360ErrorCode) => new Cliente360Error(c, undefined, err);

  // Precedencia: permission_denied PRIMEIRO (CP-5).
  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  if (msg.includes('master_admin_immutable')) return wrap('MASTER_ADMIN_IMMUTABLE');
  if (msg.includes('ALREADY_REMOVED')) return wrap('ALREADY_REMOVED');
  if (msg.includes('invalid_input')) return wrap('INVALID_INPUT');
  if (msg.includes('not_found') || msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  return wrap('UNKNOWN');
}

// ─── Validacao de body (espelho frontend; backend revalida na RPC) ───────────

export const NOTE_BODY_MIN = 1;
export const NOTE_BODY_MAX = 5000;

/**
 * Valida o corpo de uma Internal_Note (1..5000, trim). Retorna a mensagem de
 * erro em pt-BR ou null se valido. NAO e chamada dentro de createNote/updateNote
 * (a RPC valida no servidor, APOS o gating — preservando a precedencia CP-5); e
 * usada pela UI para bloquear o envio e exibir a mensagem (testing-governance).
 */
export function validateNoteBody(body: string): string | null {
  const trimmed = (body ?? '').trim();
  if (trimmed.length < NOTE_BODY_MIN) return 'A observação não pode ficar vazia.';
  if ((body ?? '').length > NOTE_BODY_MAX)
    return `A observação deve ter no máximo ${NOTE_BODY_MAX} caracteres.`;
  return null;
}

// ─── Montagem do bundle (PURO — alvo de CP-4 e CP-8) ─────────────────────────

export type Settled<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason?: unknown };

export interface Cliente360Parts {
  plano: Settled<PlanoLabel>;
  financeiro: Settled<FinancialHistory | undefined>;
  suporte: Settled<SupportHistory | undefined>;
  mensagensFrete: Settled<ConversationMeta[]>;
  login: Settled<LoginHistory>;
  notas: Settled<InternalNote[] | undefined>;
}

const BLOCK_UNAVAILABLE_MSG = 'Bloco indisponível.';

/**
 * Combina o Source_Block (base) com os resultados (allSettled) dos blocos novos
 * aplicando o gating por bloco e a degradacao parcial. NUNCA lanca: a falha de
 * um bloco != Source_Block vira errors[bloco]; blocos gated sem permissao sao
 * OMITIDOS (chave undefined, sem entrada em errors). Funcao PURA. (CP-4, CP-8)
 */
export function assembleCliente360Bundle(
  base: UserDetailBundle,
  caps: Cliente360Caps,
  parts: Cliente360Parts
): Cliente360Bundle {
  const errors: Cliente360Bundle['errors'] = { ...base.errors };
  const bundle: Cliente360Bundle = { ...base, plano: null, mensagens: null, login: null, errors };

  // plano: sempre solicitado (USER_VIEW)
  if (parts.plano.status === 'fulfilled') bundle.plano = parts.plano.value;
  else errors.plano = BLOCK_UNAVAILABLE_MSG;

  // financeiro: gated FINANCEIRO_VIEW
  if (caps.financeiro) {
    if (parts.financeiro.status === 'fulfilled') {
      bundle.financeiro = parts.financeiro.value ?? { plan: null, charges: [], repasses: [] };
    } else {
      errors.financeiro = BLOCK_UNAVAILABLE_MSG;
    }
  }

  // suporte: gated SUPORTE_VIEW
  if (caps.suporte) {
    if (parts.suporte.status === 'fulfilled') {
      bundle.suporte = parts.suporte.value ?? { tickets: [] };
    } else {
      errors.suporte = BLOCK_UNAVAILABLE_MSG;
    }
  }

  // mensagens: SEMPRE presente. O frete pode falhar (errors.mensagens); o
  // suporteChat vem do base (ja carregado por getUserDetail).
  let frete: ConversationMeta[] = [];
  if (parts.mensagensFrete.status === 'fulfilled') frete = parts.mensagensFrete.value;
  else errors.mensagens = BLOCK_UNAVAILABLE_MSG;
  bundle.mensagens = { frete, suporteChat: base.chat };

  // login: sempre presente (USER_VIEW)
  if (parts.login.status === 'fulfilled') bundle.login = parts.login.value;
  else errors.login = BLOCK_UNAVAILABLE_MSG;

  // enriquece o plano com o detalhe de subscriptions quando o financeiro veio
  if (bundle.plano && bundle.financeiro?.plan) {
    const p = bundle.financeiro.plan;
    bundle.plano = {
      ...bundle.plano,
      plan: (p.plan as string | null) ?? null,
      payment_method: (p.payment_method as string | null) ?? null,
      status: (p.status as string | null) ?? null,
      next_charge_at: (p.next_charge_at as string | null) ?? null,
      grace_ends_at: (p.grace_ends_at as string | null) ?? null,
    };
  }

  // notas: gated USER_NOTE_VIEW
  if (caps.notas) {
    if (parts.notas.status === 'fulfilled') bundle.notas = parts.notas.value ?? [];
    else errors.notas = BLOCK_UNAVAILABLE_MSG;
  }

  return bundle;
}

// ─── Fetchers privados dos blocos ────────────────────────────────────────────

async function fetchPlanoLabel(id: string): Promise<PlanoLabel> {
  const { data, error } = await supabase
    .from('users')
    .select('subscription_status, is_subscribed, trial_ends_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPostgresError(error);
  const r = (data ?? {}) as {
    subscription_status?: string;
    is_subscribed?: boolean;
    trial_ends_at?: string | null;
  };
  return {
    subscription_status: r.subscription_status ?? 'trial',
    is_subscribed: r.is_subscribed ?? false,
    trial_ends_at: r.trial_ends_at ?? null,
  };
}

async function fetchFinancialHistory(id: string): Promise<FinancialHistory> {
  const { data, error } = await supabase.rpc('admin_user_financial_history', {
    p_user_id: id,
    p_limit: 50,
  });
  if (error) throw mapPostgresError(error);
  const raw = (data ?? {}) as {
    plan?: SubscriptionPlan | null;
    charges?: ChargeRow[];
    repasses?: RepasseRow[];
  };
  return { plan: raw.plan ?? null, charges: raw.charges ?? [], repasses: raw.repasses ?? [] };
}

async function fetchSupportHistory(id: string): Promise<SupportHistory> {
  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('id, subject, status, priority_level, created_at, updated_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw mapPostgresError(error);
  const list = (tickets ?? []) as Array<{
    id: string;
    subject: string;
    status: string;
    priority_level: number | null;
    created_at: string;
    updated_at: string;
  }>;

  const counts = new Map<string, number>();
  if (list.length > 0) {
    const ids = list.map((t) => t.id);
    const { data: msgs } = await supabase
      .from('support_ticket_messages')
      .select('ticket_id')
      .in('ticket_id', ids);
    for (const m of (msgs ?? []) as Array<{ ticket_id: string }>) {
      counts.set(m.ticket_id, (counts.get(m.ticket_id) ?? 0) + 1);
    }
  }

  return {
    tickets: list.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority_level: t.priority_level ?? 1,
      created_at: t.created_at,
      updated_at: t.updated_at,
      message_count: counts.get(t.id) ?? 0,
    })),
  };
}

async function fetchFreteConversations(id: string): Promise<ConversationMeta[]> {
  // id ja foi validado como UUID por getUserDetail (Source_Block).
  const { data: convos, error } = await supabase
    .from('conversations')
    .select('id, motorista_id, embarcador_id')
    .or(`motorista_id.eq.${id},embarcador_id.eq.${id}`)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw mapPostgresError(error);
  const list = (convos ?? []) as Array<{
    id: string;
    motorista_id: string;
    embarcador_id: string;
  }>;

  const result: ConversationMeta[] = [];
  for (const c of list) {
    const { data: msgs, count } = await supabase
      .from('messages')
      .select('created_at', { count: 'exact' })
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1);
    const last = msgs && msgs[0] ? (msgs[0] as { created_at: string }).created_at : null;
    result.push({
      conversation_id: c.id,
      total_messages: count ?? 0,
      last_message_at: last,
      counterpart: c.motorista_id === id ? 'embarcador' : 'motorista',
    });
  }
  return result;
}

async function fetchLoginHistory(id: string): Promise<LoginHistory> {
  const { data, error } = await supabase.rpc('admin_user_login_history', {
    p_user_id: id,
    p_limit: 50,
  });
  if (error) throw mapPostgresError(error);
  const raw = (data ?? {}) as {
    attempts?: LoginAttemptRow[];
    retention_days?: number;
    has_phone?: boolean;
  };
  return {
    attempts: raw.attempts ?? [],
    retentionDays: raw.retention_days ?? 30,
    hasPhone: raw.has_phone ?? false,
  };
}

async function fetchInternalNotes(id: string): Promise<InternalNote[]> {
  const { data, error } = await supabase
    .from('admin_user_notes')
    .select('id, body, author_id, created_at, updated_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw mapPostgresError(error);
  const rows = (data ?? []) as Array<{
    id: string;
    body: string;
    author_id: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const authorIds = Array.from(
    new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))
  );
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: us } = await supabase.from('users').select('id, name').in('id', authorIds);
    for (const u of (us ?? []) as Array<{ id: string; name: string }>) names.set(u.id, u.name);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    author_id: r.author_id,
    author_name: r.author_id ? (names.get(r.author_id) ?? null) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

// ─── Leitura agregada (Visao 360) ────────────────────────────────────────────

/**
 * Monta o Cliente_360_Bundle. getUserDetail e o Source_Block (unica fonte de
 * NOT_FOUND, propagado para a UI virar Stealth_404). Blocos gated so sao
 * SOLICITADOS quando ha permissao (CP-8); as RPCs ainda self-gate server-side.
 */
export async function getCliente360Detail(
  id: string,
  caps: Cliente360Caps
): Promise<Cliente360Bundle> {
  const base = await getUserDetail(id); // throws UsersServiceError('NOT_FOUND')

  const settled = await Promise.allSettled([
    fetchPlanoLabel(id),
    caps.financeiro ? fetchFinancialHistory(id) : Promise.resolve(undefined),
    caps.suporte ? fetchSupportHistory(id) : Promise.resolve(undefined),
    fetchFreteConversations(id),
    fetchLoginHistory(id),
    caps.notas ? fetchInternalNotes(id) : Promise.resolve(undefined),
  ]);

  const [planoR, finR, supR, msgR, loginR, notasR] = settled;
  return assembleCliente360Bundle(base, caps, {
    plano: planoR as Settled<PlanoLabel>,
    financeiro: finR as Settled<FinancialHistory | undefined>,
    suporte: supR as Settled<SupportHistory | undefined>,
    mensagensFrete: msgR as Settled<ConversationMeta[]>,
    login: loginR as Settled<LoginHistory>,
    notas: notasR as Settled<InternalNote[] | undefined>,
  });
}

// ─── Pesquisa Global ──────────────────────────────────────────────────────────

/** Executa a Pesquisa Global via RPC gated (USER_VIEW). */
export async function globalSearch(
  query: string,
  opts?: { limit?: number }
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('admin_global_search', {
    p_query: query,
    p_limit: opts?.limit ?? 20,
  });
  if (error) throw mapPostgresError(error);
  const rows = (data ?? []) as SearchResult[];
  // A RPC ja ordena; reforco determinismo no cliente (fallback de reordenacao).
  return [...rows].sort(compareSearchResults);
}

// ─── CRUD de Internal_Note ────────────────────────────────────────────────────

export type DeleteNoteResult = { ok: true } | { skipped: true; reason: 'ALREADY_REMOVED' };

/**
 * Cria uma Internal_Note. NAO pre-valida o body no cliente: a RPC checa o
 * gating ANTES da validacao (precedencia CP-5). audit-by-construction.
 */
export async function createNote(
  userId: string,
  body: string
): Promise<{ id: string; updated_at: string }> {
  return executeAdminMutation(
    {
      action: 'USER_NOTE_CREATE',
      targetType: 'admin_user_notes',
      targetId: userId,
      after: { body_length: (body ?? '').length },
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_user_note_create', {
        p_user_id: userId,
        p_body: body,
      });
      if (error) throw mapPostgresError(error);
      const raw = (data ?? {}) as { id?: string; updated_at?: string };
      if (!raw.id) throw new Cliente360Error('UNKNOWN', { reason: 'rpc_response_malformed' });
      return { id: raw.id, updated_at: raw.updated_at ?? '' };
    }
  );
}

/** Edita uma Internal_Note com versionamento otimista (expected_updated_at). */
export async function updateNote(
  noteId: string,
  body: string,
  expectedUpdatedAt: string
): Promise<{ updated_at: string }> {
  return executeAdminMutation(
    { action: 'USER_NOTE_UPDATE', targetType: 'admin_user_notes', targetId: noteId },
    async () => {
      const { data, error } = await supabase.rpc('admin_user_note_update', {
        p_note_id: noteId,
        p_body: body,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapPostgresError(error);
      const raw = (data ?? {}) as { updated_at?: string };
      return { updated_at: raw.updated_at ?? '' };
    }
  );
}

/**
 * Remove uma Internal_Note. Idempotente SOMENTE na inexistencia: a RPC retorna
 * { skipped, reason:'ALREADY_REMOVED' } e grava USER_NOTE_DELETE_SKIPPED ela
 * mesma (sem mutacao real => sem executeAdminMutation). Quando remove de fato,
 * grava o audit positivo USER_NOTE_DELETE (best-effort).
 */
export async function deleteNote(noteId: string): Promise<DeleteNoteResult> {
  const { data, error } = await supabase.rpc('admin_user_note_delete', { p_note_id: noteId });
  if (error) throw mapPostgresError(error);
  const raw = (data ?? {}) as { ok?: boolean; skipped?: boolean; reason?: string };
  if (raw.skipped) return { skipped: true, reason: 'ALREADY_REMOVED' };
  await logAdminAction({
    action: 'USER_NOTE_DELETE',
    targetType: 'admin_user_notes',
    targetId: noteId,
  }).catch(() => null);
  return { ok: true };
}
