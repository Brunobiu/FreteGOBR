/**
 * services/admin/supportChat.ts
 *
 * Service do chat de suporte (usuário ↔ admin pool).
 *
 * Spec: .kiro/specs/notifications-hub/{requirements,design,tasks}.md
 *
 * Cobertura:
 *   - 2.3: tipos públicos (SupportConversation, SupportChatMessage).
 *   - 2.4: helper mapPostgresError.
 *   - 3.8-3.10: leituras (listSupportConversations, getMessages,
 *     openMySupportConversation).
 *   - 4.7-4.9: mutações (postSupportMessage, postAdminReply,
 *     resolveSupportConversation).
 *
 * Reusa as tabelas `chat_conversations` e `chat_messages` (migrations
 * 001/008/009). Cada usuário tem 1 única conversa de suporte (UNIQUE
 * constraint em chat_conversations.user_id). Triggers da migration 041
 * disparam notificações automáticas em cada mensagem.
 *
 * IMPORTANTE: tabela `chat_messages` é DIFERENTE de `messages` (chat
 * de frete). Não confundir.
 */

import { supabase } from '../supabase';
import { executeAdminMutation } from './audit';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type SupportConversationStatus = 'aberta' | 'em_andamento' | 'resolvida';

/**
 * Conversa de suporte de um usuário com o pool de admins.
 */
export interface SupportConversation {
  id: string;
  /** UUID do usuário dono da conversa. */
  userId: string;
  status: SupportConversationStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Contagem de mensagens não-lidas do ponto de vista do caller.
   * Para admin: count de mensagens com is_admin=false e read_at=NULL.
   * Para user: count de mensagens com is_admin=true e read_at=NULL.
   * Preenchido apenas em `listSupportConversations`.
   */
  unreadCount?: number;
  /**
   * Última mensagem da conversa (para preview na lista admin).
   * Preenchido apenas em `listSupportConversations`.
   */
  lastMessage?: {
    body: string;
    isAdmin: boolean;
    createdAt: string;
  };
  /**
   * Nome do usuário dono da conversa. Preenchido apenas na listagem
   * admin (usa JOIN).
   */
  userName?: string;
}

/**
 * Mensagem dentro de uma Support_Conversation.
 */
export interface SupportChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  message: string;
  isAdmin: boolean;
  readAt: string | null;
  createdAt: string;
}

// ─── Erros tipados ──────────────────────────────────────────────────────────

export type SupportChatErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'INVALID_BODY'
  | 'UNKNOWN';

const SUPPORT_CHAT_ERROR_MESSAGES: Record<SupportChatErrorCode, string> = {
  PERMISSION_DENIED: 'Voce nao tem permissao para acessar esta area.',
  NOT_FOUND: 'Conversa nao encontrada.',
  STALE_VERSION: 'Outro admin atualizou esta conversa. Recarregando.',
  INVALID_BODY: 'Mensagem invalida.',
  UNKNOWN: 'Nao foi possivel concluir.',
};

export class SupportChatError extends Error {
  readonly code: SupportChatErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: SupportChatErrorCode, details?: Record<string, unknown>, cause?: unknown) {
    super(SUPPORT_CHAT_ERROR_MESSAGES[code]);
    this.name = 'SupportChatError';
    this.code = code;
    this.details = details;
    if (cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = cause;
    }
  }
}

export function mapPostgresError(err: unknown): SupportChatError {
  if (err instanceof SupportChatError) return err;

  const msg =
    (err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)) || '';
  const code =
    (err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '') || '';

  const wrap = (c: SupportChatErrorCode) => new SupportChatError(c, { original: msg }, err);

  if (code === '42501' || msg.includes('permission_denied')) return wrap('PERMISSION_DENIED');
  if (msg.includes('STALE_VERSION')) return wrap('STALE_VERSION');
  if (msg.includes('NOT_FOUND')) return wrap('NOT_FOUND');
  if (msg.includes('INVALID_BODY')) return wrap('INVALID_BODY');

  return wrap('UNKNOWN');
}

// ─── Mapeadores de DB row ───────────────────────────────────────────────────

interface ChatConversationRow {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  message: string;
  is_admin: boolean;
  read_at: string | null;
  created_at: string;
}

function rowToConversation(row: ChatConversationRow): SupportConversation {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status as SupportConversationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: ChatMessageRow): SupportChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    message: row.message,
    isAdmin: row.is_admin,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// ─── Leituras (user logado) ─────────────────────────────────────────────────

/**
 * Abre (ou cria) a conversa de suporte do usuário autenticado.
 *
 * Tabela `chat_conversations` tem UNIQUE em `user_id`, então a função é
 * idempotente: chamar múltiplas vezes retorna sempre a mesma conversa.
 *
 * Estratégia: SELECT primeiro; se não existe, INSERT. RLS garante
 * isolamento.
 */
export async function openMySupportConversation(): Promise<SupportConversation> {
  const { data: userResp } = await supabase.auth.getUser();
  const userId = userResp.user?.id;
  if (!userId) throw new SupportChatError('PERMISSION_DENIED');

  // Tenta buscar existente
  const { data: existing, error: selErr } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (selErr) throw mapPostgresError(selErr);
  if (existing) return rowToConversation(existing as ChatConversationRow);

  // Cria nova
  const { data: created, error: insErr } = await supabase
    .from('chat_conversations')
    .insert({ user_id: userId, status: 'aberta' })
    .select()
    .single();

  if (insErr) throw mapPostgresError(insErr);
  return rowToConversation(created as ChatConversationRow);
}

/**
 * Lista mensagens da conversa de suporte do usuário autenticado.
 */
export async function getMySupportMessages(): Promise<SupportChatMessage[]> {
  const conversation = await openMySupportConversation();
  return getSupportConversationMessages(conversation.id);
}

// ─── Leituras (admin) ───────────────────────────────────────────────────────

/**
 * Lista todas as conversas de suporte para admin com SUPORTE_VIEW.
 *
 * Inclui nome do user (via JOIN) e contagem de não-lidas do ponto de
 * vista do admin (mensagens com is_admin=false e read_at=NULL).
 */
export async function listSupportConversations(filters: {
  status?: SupportConversationStatus;
  limit?: number;
  offset?: number;
}): Promise<{ items: SupportConversation[]; total: number }> {
  const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);

  let query = supabase
    .from('chat_conversations')
    .select('*, users!inner(name)', { count: 'exact' })
    .order('updated_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw mapPostgresError(error);

  const conversations: SupportConversation[] = (data ?? []).map((r) => {
    const row = r as ChatConversationRow & { users: { name: string } | { name: string }[] | null };
    const conv = rowToConversation(row);
    const u = row.users;
    const userName = Array.isArray(u) ? u[0]?.name : u?.name;
    if (userName) conv.userName = userName;
    return conv;
  });

  // Hidrata unreadCount e lastMessage por conversation_id em paralelo
  if (conversations.length > 0) {
    const ids = conversations.map((c) => c.id);
    const [unreadRes, lastMsgRes] = await Promise.all([
      supabase
        .from('chat_messages')
        .select('conversation_id, id', { count: 'exact' })
        .in('conversation_id', ids)
        .eq('is_admin', false)
        .is('read_at', null),
      supabase
        .from('chat_messages')
        .select('conversation_id, message, is_admin, created_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false }),
    ]);

    if (!unreadRes.error && unreadRes.data) {
      const unreadByConv: Record<string, number> = {};
      for (const row of unreadRes.data) {
        const r = row as { conversation_id: string };
        unreadByConv[r.conversation_id] = (unreadByConv[r.conversation_id] ?? 0) + 1;
      }
      conversations.forEach((c) => {
        c.unreadCount = unreadByConv[c.id] ?? 0;
      });
    }

    if (!lastMsgRes.error && lastMsgRes.data) {
      const lastByConv: Record<string, SupportConversation['lastMessage']> = {};
      for (const row of lastMsgRes.data) {
        const r = row as {
          conversation_id: string;
          message: string;
          is_admin: boolean;
          created_at: string;
        };
        if (!lastByConv[r.conversation_id]) {
          lastByConv[r.conversation_id] = {
            body: r.message,
            isAdmin: r.is_admin,
            createdAt: r.created_at,
          };
        }
      }
      conversations.forEach((c) => {
        if (lastByConv[c.id]) c.lastMessage = lastByConv[c.id];
      });
    }
  }

  return { items: conversations, total: count ?? 0 };
}

/**
 * Lista mensagens de uma conversa (user lê só a sua, admin lê todas via
 * RLS de SUPORTE_VIEW).
 */
export async function getSupportConversationMessages(
  conversationId: string
): Promise<SupportChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw mapPostgresError(error);
  return (data ?? []).map((r) => rowToMessage(r as ChatMessageRow));
}

// ─── Mutações (user logado) ─────────────────────────────────────────────────

/**
 * Posta mensagem do user na sua conversa de suporte. Cria a conversa
 * se ainda não existir. Trigger SQL dispara notificação para admins.
 */
export async function postSupportMessage(message: string): Promise<SupportChatMessage> {
  const { data: userResp } = await supabase.auth.getUser();
  const senderId = userResp.user?.id;
  if (!senderId) throw new SupportChatError('PERMISSION_DENIED');

  if (!message || message.trim().length === 0) {
    throw new SupportChatError('INVALID_BODY');
  }

  const conversation = await openMySupportConversation();

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversation.id,
      sender_id: senderId,
      message: message.trim(),
      is_admin: false,
    })
    .select()
    .single();

  if (error) throw mapPostgresError(error);
  return rowToMessage(data as ChatMessageRow);
}

// ─── Mutações (admin) ───────────────────────────────────────────────────────

/**
 * Resposta do admin numa conversa de suporte. Envolto em
 * `executeAdminMutation` com action `SUPORTE_CHAT_REPLY`.
 *
 * Versionamento otimista contra `chat_conversations.updated_at`: se
 * outra resposta foi inserida entre o load e o submit, lança STALE_VERSION.
 */
export async function postAdminReply(
  conversationId: string,
  message: string,
  expectedUpdatedAt: string
): Promise<SupportChatMessage> {
  return executeAdminMutation(
    {
      action: 'SUPORTE_CHAT_REPLY',
      targetType: 'chat_conversations',
      targetId: conversationId,
      before: { expected_updated_at: expectedUpdatedAt },
      after: { body_length: message.length },
    },
    async () => {
      if (!message || message.trim().length === 0) {
        throw new SupportChatError('INVALID_BODY');
      }

      const { data: userResp } = await supabase.auth.getUser();
      const senderId = userResp.user?.id;
      if (!senderId) throw new SupportChatError('PERMISSION_DENIED');

      // Versionamento otimista: UPDATE só se updated_at bate
      const { data: convRow, error: convErr } = await supabase
        .from('chat_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('updated_at', expectedUpdatedAt)
        .select('id, updated_at')
        .maybeSingle();

      if (convErr) throw mapPostgresError(convErr);
      if (!convRow) throw new SupportChatError('STALE_VERSION');

      // Insert mensagem (RLS valida SUPORTE_REPLY)
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          message: message.trim(),
          is_admin: true,
        })
        .select()
        .single();

      if (error) throw mapPostgresError(error);
      return rowToMessage(data as ChatMessageRow);
    }
  );
}

/**
 * Marca uma conversa de suporte como resolvida. Idempotente: se já
 * resolvida, retorna `{ skipped: true, reason: 'ALREADY_RESOLVED' }`.
 */
export async function resolveSupportConversation(
  conversationId: string,
  expectedUpdatedAt: string
): Promise<{ ok: true } | { skipped: true; reason: 'ALREADY_RESOLVED' }> {
  return executeAdminMutation(
    {
      action: 'SUPORTE_CHAT_RESOLVE',
      targetType: 'chat_conversations',
      targetId: conversationId,
      before: { expected_updated_at: expectedUpdatedAt },
      after: null,
    },
    async () => {
      const { data, error } = await supabase.rpc('resolve_support_conversation', {
        p_conversation_id: conversationId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw mapPostgresError(error);

      const raw = (data ?? {}) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: string;
      };

      if (raw.skipped) {
        return { skipped: true as const, reason: 'ALREADY_RESOLVED' as const };
      }
      return { ok: true as const };
    }
  );
}
