/**
 * services/admin/tickets.ts
 *
 * Service do módulo Support Tickets.
 *
 * Spec: .kiro/specs/notifications-hub/{requirements,design,tasks}.md
 *
 * Cobertura:
 *   - 2.2: tipos públicos (SupportTicket, TicketMessage, TicketStatus, TicketPriority).
 *   - 2.4: helper mapPostgresError.
 *   - 3.4-3.7: leituras (listMyTickets, getMyTicket, listAdminTickets,
 *     getAdminTicketDetail).
 *   - 4.2-4.6: mutações (submit_user, submit_public, postMyReply,
 *     replyToTicket, resolveTicket).
 *
 * Tickets logados (user_id NOT NULL) e tickets públicos anônimos
 * (user_id NULL + guest_name + guest_email) compartilham a mesma tabela
 * `support_tickets`. RLS distingue o caller. Visitante anônimo cria via
 * RPC `submit_public_ticket` chamável pelo role `anon`.
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'resolved';
export type TicketPriority = 'low' | 'normal' | 'high';

/**
 * Ticket de suporte. Pode ser de usuário logado (user_id NOT NULL) ou
 * de visitante anônimo (user_id NULL + guest_name + guest_email).
 */
export interface SupportTicket {
  id: string;
  /** UUID do usuário logado, ou NULL para tickets públicos. */
  userId: string | null;
  /** Nome do visitante. NULL se userId NOT NULL. */
  guestName: string | null;
  /** Email do visitante. NULL se userId NOT NULL. */
  guestEmail: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mensagem dentro de um ticket. `authorId` NULL = mensagem do visitante
 * anônimo (apenas a mensagem inicial de tickets públicos). `isAdmin` true
 * = resposta do admin. `emailSentAt` preenchido apenas em respostas a
 * tickets públicos (após sucesso da Edge Function `send-public-ticket-reply`).
 */
export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  body: string;
  isAdmin: boolean;
  emailSentAt: string | null;
  createdAt: string;
}

// ─── Erros tipados ──────────────────────────────────────────────────────────

export type TicketErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'INVALID_INPUT'
  | 'INVALID_SUBJECT'
  | 'INVALID_BODY'
  | 'INVALID_PRIORITY'
  | 'PUBLIC_TICKET_RATE_LIMITED'
  | 'UNKNOWN';

const TICKET_ERROR_MESSAGES: Record<TicketErrorCode, string> = {
  PERMISSION_DENIED: 'Voce nao tem permissao para acessar esta area.',
  NOT_FOUND: 'Ticket nao encontrado.',
  STALE_VERSION: 'Outro admin atualizou este ticket. Recarregando.',
  INVALID_INPUT: 'Dados invalidos. Verifique os campos.',
  INVALID_SUBJECT: 'Assunto invalido. Use entre 3 e 120 caracteres.',
  INVALID_BODY: 'Mensagem invalida. Use entre 10 e 5000 caracteres.',
  INVALID_PRIORITY: 'Prioridade invalida.',
  PUBLIC_TICKET_RATE_LIMITED: 'Nao foi possivel enviar agora. Tente novamente mais tarde.',
  UNKNOWN: 'Nao foi possivel concluir.',
};

export class TicketError extends Error {
  readonly code: TicketErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: TicketErrorCode, details?: Record<string, unknown>, cause?: unknown) {
    super(TICKET_ERROR_MESSAGES[code]);
    this.name = 'TicketError';
    this.code = code;
    this.details = details;
    if (cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = cause;
    }
  }
}

/**
 * Mapeia erros do Postgres/Supabase para `TicketError` tipado.
 *
 * Códigos esperados:
 * - ERRCODE 42501 ⇒ PERMISSION_DENIED
 * - ERRCODE P0001 / 'STALE_VERSION' ⇒ STALE_VERSION
 * - ERRCODE P0001 / 'NOT_FOUND' ⇒ NOT_FOUND
 * - ERRCODE P0001 / 'INVALID_*' ⇒ código específico
 * - ERRCODE P0001 / 'PUBLIC_TICKET_RATE_LIMITED' ⇒ PUBLIC_TICKET_RATE_LIMITED
 * - Outros ⇒ UNKNOWN (preserva anti-enumeration).
 */
export function mapPostgresError(err: unknown): TicketError {
  if (err instanceof TicketError) return err;

  const msg =
    (err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)) || '';
  const code =
    (err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '') || '';

  const wrap = (c: TicketErrorCode) => new TicketError(c, { original: msg }, err);

  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  if (msg.includes('PUBLIC_TICKET_RATE_LIMITED')) return wrap('PUBLIC_TICKET_RATE_LIMITED');
  if (msg.includes('INVALID_SUBJECT')) return wrap('INVALID_SUBJECT');
  if (msg.includes('INVALID_BODY')) return wrap('INVALID_BODY');
  if (msg.includes('INVALID_PRIORITY')) return wrap('INVALID_PRIORITY');
  if (msg.includes('INVALID_INPUT')) return wrap('INVALID_INPUT');

  return wrap('UNKNOWN');
}

// ─── Mapeadores de DB row ───────────────────────────────────────────────────

interface SupportTicketRow {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  subject: string;
  status: string;
  priority: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SupportTicketMessageRow {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  is_admin: boolean;
  email_sent_at: string | null;
  created_at: string;
}

function rowToTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    userId: row.user_id,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    subject: row.subject,
    status: row.status as TicketStatus,
    priority: row.priority as TicketPriority,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: SupportTicketMessageRow): TicketMessage {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    body: row.body,
    isAdmin: row.is_admin,
    emailSentAt: row.email_sent_at,
    createdAt: row.created_at,
  };
}

// ─── Leituras (user logado) ─────────────────────────────────────────────────

/**
 * Lista tickets do usuário autenticado. RLS garante que só linhas do
 * próprio user retornem.
 */
export async function listMyTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw mapPostgresError(error);
  return (data ?? []).map((r) => rowToTicket(r as SupportTicketRow));
}

/**
 * Detalhe de um ticket próprio do user, com mensagens. RLS bloqueia
 * tickets de outros users.
 */
export async function getMyTicket(
  id: string
): Promise<{ ticket: SupportTicket; messages: TicketMessage[] }> {
  const [ticketRes, messagesRes] = await Promise.all([
    supabase.from('support_tickets').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (ticketRes.error) throw mapPostgresError(ticketRes.error);
  if (!ticketRes.data) throw new TicketError('NOT_FOUND');
  if (messagesRes.error) throw mapPostgresError(messagesRes.error);

  return {
    ticket: rowToTicket(ticketRes.data as SupportTicketRow),
    messages: (messagesRes.data ?? []).map((r) => rowToMessage(r as SupportTicketMessageRow)),
  };
}

// ─── Leituras (admin) ───────────────────────────────────────────────────────

/**
 * Lista admin de tickets com filtros e paginação. Requer SUPORTE_VIEW.
 */
export async function listAdminTickets(filters: {
  status?: TicketStatus;
  priority?: TicketPriority;
  /** Apenas tickets de visitantes anônimos (user_id NULL). */
  guestOnly?: boolean;
  /** Busca textual em subject. */
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: SupportTicket[]; total: number }> {
  const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);

  let query = supabase
    .from('support_tickets')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.guestOnly) query = query.is('user_id', null);
  if (filters.q && filters.q.trim()) query = query.ilike('subject', `%${filters.q.trim()}%`);

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw mapPostgresError(error);

  return {
    items: (data ?? []).map((r) => rowToTicket(r as SupportTicketRow)),
    total: count ?? 0,
  };
}

/**
 * Detalhe admin de um ticket arbitrário (independente de owner). RLS
 * filtra por SUPORTE_VIEW.
 */
export async function getAdminTicketDetail(
  id: string
): Promise<{ ticket: SupportTicket; messages: TicketMessage[] }> {
  // Mesmo SQL, RLS é diferente para admin.
  return getMyTicket(id);
}

// ─── Mutações (user logado) ─────────────────────────────────────────────────

/**
 * Cria ticket pelo usuário autenticado. Chama RPC `submit_user_ticket` que
 * insere ticket + primeira mensagem em transação.
 */
export async function submitUserTicket(input: {
  subject: string;
  body: string;
  priority?: TicketPriority;
}): Promise<SupportTicket> {
  const { data, error } = await supabase.rpc('submit_user_ticket', {
    p_subject: input.subject,
    p_body: input.body,
    p_priority: input.priority ?? 'normal',
  });
  if (error) throw mapPostgresError(error);

  const row = (data ?? {}) as Partial<SupportTicketRow>;
  if (!row.id) throw new TicketError('UNKNOWN', { reason: 'rpc_response_malformed' });
  return rowToTicket(row as SupportTicketRow);
}

/**
 * Posta resposta do usuário em ticket próprio. INSERT direto via RLS
 * (`ticket_msgs_insert` permite ao dono inserir com `is_admin=false`).
 *
 * NÃO requer `executeAdminMutation` — não é mutação admin.
 */
export async function postMyTicketReply(ticketId: string, body: string): Promise<TicketMessage> {
  const { data: userResp } = await supabase.auth.getUser();
  const authorId = userResp.user?.id;
  if (!authorId) throw new TicketError('PERMISSION_DENIED');

  const { data, error } = await supabase
    .from('support_ticket_messages')
    .insert({
      ticket_id: ticketId,
      author_id: authorId,
      body,
      is_admin: false,
    })
    .select()
    .single();

  if (error) throw mapPostgresError(error);
  return rowToMessage(data as SupportTicketMessageRow);
}

// ─── Mutações (visitante anônimo) ───────────────────────────────────────────

/**
 * Submete ticket público sem autenticação. RPC `submit_public_ticket`
 * roda como `anon, authenticated` e implementa honeypot + rate-limit
 * por IP (ver migration 041).
 *
 * Resposta opaca por design: sempre retorna `{ submitted: true }` em
 * sucesso, honeypot detectado, ou erro interno (anti-enumeration).
 *
 * @param input.websiteUrl honeypot — sempre vazio em uso real. Bots tendem
 *   a preencher campos ocultos automaticamente.
 */
export async function submitPublicTicket(input: {
  guestName: string;
  guestEmail: string;
  subject: string;
  body: string;
  websiteUrl?: string;
}): Promise<{ submitted: true }> {
  const { error } = await supabase.rpc('submit_public_ticket', {
    p_guest_name: input.guestName,
    p_guest_email: input.guestEmail,
    p_subject: input.subject,
    p_body: input.body,
    p_website_url: input.websiteUrl ?? null,
  });

  // Resposta opaca: até em rate-limit retornamos { submitted: true } na UI
  // para não dar pista a bots/spammers. O RPC RAISE em rate-limit, então
  // aqui mapeamos para uma mensagem genérica que a UI pode optar por mostrar.
  if (error) {
    const mapped = mapPostgresError(error);
    if (mapped.code === 'PUBLIC_TICKET_RATE_LIMITED') {
      // Mostra ao user a mensagem genérica (sem revelar bot detection).
      throw mapped;
    }
    if (mapped.code === 'INVALID_INPUT') throw mapped;
    // Outros erros: traduz para INVALID_INPUT genérico (anti-enumeration).
    throw new TicketError('INVALID_INPUT', { original: error });
  }

  return { submitted: true };
}

// ─── Mutações (admin) ───────────────────────────────────────────────────────

/**
 * Resposta do admin a um ticket. Envolto em `executeAdminMutation` com
 * action `SUPORTE_REPLY`. RPC valida `SUPORTE_REPLY` e versionamento
 * otimista via `expected_updated_at`.
 *
 * Para tickets públicos (`isPublic` na resposta): o caller é responsável
 * por chamar a Edge Function `send-public-ticket-reply` em seguida e
 * depois `markEmailSent(messageId, sentAt)`.
 */
export async function replyToTicket(
  ticketId: string,
  body: string,
  expectedUpdatedAt: string
): Promise<{
  messageId: string;
  ticketId: string;
  updatedAt: string;
  isPublic: boolean;
  guestName: string | null;
  guestEmail: string | null;
  subject: string;
}> {
  return executeAdminMutation(
    {
      action: 'SUPORTE_REPLY',
      targetType: 'support_tickets',
      targetId: ticketId,
      before: { expected_updated_at: expectedUpdatedAt },
      after: { body_length: body.length },
    },
    async () => {
      const { data, error } = await supabase.rpc('reply_to_ticket', {
        p_ticket_id: ticketId,
        p_body: body,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapPostgresError(error);

      const raw = (data ?? {}) as {
        message_id?: string;
        ticket_id?: string;
        updated_at?: string;
        is_public?: boolean;
        guest_name?: string | null;
        guest_email?: string | null;
        subject?: string;
      };

      if (!raw.message_id || !raw.updated_at) {
        throw new TicketError('UNKNOWN', { reason: 'rpc_response_malformed' });
      }

      return {
        messageId: raw.message_id,
        ticketId: raw.ticket_id ?? ticketId,
        updatedAt: raw.updated_at,
        isPublic: raw.is_public ?? false,
        guestName: raw.guest_name ?? null,
        guestEmail: raw.guest_email ?? null,
        subject: raw.subject ?? '',
      };
    }
  );
}

/**
 * Marca um ticket como resolvido. Idempotente: se já está resolvido,
 * retorna `{ skipped: true, reason: 'ALREADY_RESOLVED' }` e grava audit
 * `_SKIPPED` sem mutar.
 */
export async function resolveTicket(
  ticketId: string,
  expectedUpdatedAt: string
): Promise<
  { ok: true; ticketId: string } | { skipped: true; reason: 'ALREADY_RESOLVED'; ticketId: string }
> {
  return executeAdminMutation(
    {
      action: 'SUPORTE_TICKET_RESOLVE',
      targetType: 'support_tickets',
      targetId: ticketId,
      before: { expected_updated_at: expectedUpdatedAt },
      after: null,
    },
    async () => {
      const { data, error } = await supabase.rpc('resolve_ticket', {
        p_ticket_id: ticketId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapPostgresError(error);

      const raw = (data ?? {}) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: string;
        ticket_id?: string;
      };

      if (raw.skipped) {
        return {
          skipped: true as const,
          reason: 'ALREADY_RESOLVED' as const,
          ticketId: raw.ticket_id ?? ticketId,
        };
      }
      return { ok: true as const, ticketId: raw.ticket_id ?? ticketId };
    }
  );
}

/**
 * Marca `email_sent_at` em uma mensagem após sucesso da Edge Function
 * `send-public-ticket-reply`. RPC valida SUPORTE_REPLY.
 */
export async function markEmailSent(messageId: string, sentAt: string): Promise<{ ok: true }> {
  const { data, error } = await supabase.rpc('mark_email_sent', {
    p_message_id: messageId,
    p_sent_at: sentAt,
  });
  if (error) throw mapPostgresError(error);
  void data;
  return { ok: true };
}

// ─── Edge Function: envio de email para tickets publicos ───────────────────

/**
 * Resultado da chamada à Edge Function `send-public-ticket-reply`.
 */
export interface SendPublicTicketReplyEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Invoca a Edge Function `send-public-ticket-reply` para enviar a resposta
 * do admin a um ticket público por email. Retorna o `messageId` em sucesso
 * ou erro descritivo (que o caller pode optar por exibir ou só logar).
 *
 * Convenção de uso:
 * 1. Chamar `replyToTicket(...)` primeiro — persiste a mensagem no banco
 *    com `email_sent_at = NULL`.
 * 2. Se `result.isPublic === true`, chamar esta função.
 * 3. Em sucesso: chamar `markEmailSent(messageId, NOW())` para marcar a
 *    mensagem como entregue.
 * 4. Em falha: deixa `email_sent_at = NULL` e exibe toast ao admin
 *    "Resposta salva, mas falha ao enviar email."
 *
 * A Edge Function é configurada com `verify_jwt: true`, então o JWT do
 * admin autenticado é injetado automaticamente por `supabase.functions.invoke`.
 * A função valida internamente que o caller tem permissão `SUPORTE_REPLY`.
 */
export async function sendPublicTicketReplyEmail(input: {
  ticketId: string;
  guestName: string;
  guestEmail: string;
  subject: string;
  body: string;
  adminName: string;
  /** URL absoluta opcional para "Continuar conversa" no email. */
  replyLink?: string;
}): Promise<SendPublicTicketReplyEmailResult> {
  const { data, error } = await supabase.functions.invoke('send-public-ticket-reply', {
    body: {
      ticket_id: input.ticketId,
      guest_name: input.guestName,
      guest_email: input.guestEmail,
      subject: input.subject,
      body: input.body,
      admin_name: input.adminName,
      reply_link: input.replyLink ?? null,
    },
  });

  if (error) {
    return { ok: false, error: error.message ?? 'Falha ao enviar email' };
  }

  const raw = (data ?? {}) as { ok?: boolean; message_id?: string; error?: string };
  if (raw.ok) {
    return { ok: true, messageId: raw.message_id ?? '' };
  }
  return { ok: false, error: raw.error ?? 'Falha desconhecida' };
}
