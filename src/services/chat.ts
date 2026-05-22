/**
 * Chat Service - Suporte ao usuário
 */

import { supabase } from './supabase';

// ============================================================================
// ChatError tipada (Bug 15)
// ============================================================================

export type ChatErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN';

export class ChatError extends Error {
  constructor(
    message: string,
    public code: ChatErrorCode,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

/**
 * Mapeia um erro do Supabase (PostgrestError-like) para uma ChatError
 * com código discriminado e mensagem em pt-BR. Permite que a UI distinga
 * problemas recuperáveis (rede) de problemas de permissão ou validação.
 */
export function mapSupabaseError(error: { code?: string; message: string }): ChatError {
  const msg = error.message ?? '';
  if (error.code === 'PGRST301' || /permission|denied|forbidden/i.test(msg)) {
    return new ChatError('Sem permissão para esta operação', 'PERMISSION_DENIED', 403);
  }
  if (error.code === 'PGRST116' || /not\s*found/i.test(msg)) {
    return new ChatError('Recurso não encontrado', 'NOT_FOUND', 404);
  }
  if (/network|fetch|connection|timeout/i.test(msg)) {
    return new ChatError('Falha de rede ao acessar o chat', 'NETWORK_ERROR', 503);
  }
  if (/check|constraint|invalid|missing/i.test(msg)) {
    return new ChatError(`Dados inválidos: ${msg}`, 'VALIDATION_ERROR', 400);
  }
  return new ChatError(`Erro no chat: ${msg}`, 'UNKNOWN', 500);
}

export interface ChatConversation {
  id: string;
  userId: string;
  status: 'aberta' | 'em_andamento' | 'resolvida';
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  message: string;
  isAdmin: boolean;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Criar ou buscar conversa do usuário
 */
export async function getOrCreateConversation(userId: string): Promise<ChatConversation> {
  // Tenta buscar conversa existente
  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return mapConversation(existing);
  }

  // Cria nova
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ user_id: userId, status: 'aberta' })
    .select()
    .single();

  if (error) throw mapSupabaseError(error);
  return mapConversation(data);
}

/**
 * Enviar mensagem
 */
export async function sendMessage(
  conversationId: string,
  senderId: string,
  message: string,
  isAdmin: boolean = false
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      message,
      is_admin: isAdmin,
    })
    .select()
    .single();

  if (error) throw mapSupabaseError(error);
  return mapMessage(data);
}

/**
 * Buscar mensagens de uma conversa
 */
export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw mapSupabaseError(error);
  return data.map(mapMessage);
}

/**
 * Marcar mensagens como lidas
 */
export async function markMessagesAsRead(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);

  if (error) throw mapSupabaseError(error);
}

/**
 * Atualizar status da conversa
 */
export async function updateConversationStatus(
  conversationId: string,
  status: 'aberta' | 'em_andamento' | 'resolvida'
): Promise<void> {
  const { error } = await supabase
    .from('chat_conversations')
    .update({ status })
    .eq('id', conversationId);

  if (error) throw mapSupabaseError(error);
}

/**
 * Contar mensagens não lidas
 */
export async function getUnreadCount(conversationId: string, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);

  if (error) return 0;
  return data.length;
}

/**
 * Escutar novas mensagens em tempo real
 */
export function subscribeToMessages(
  conversationId: string,
  onMessage: (message: ChatMessage) => void
) {
  const channel = supabase
    .channel(`chat-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onMessage(mapMessage(payload.new));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConversation(data: any): ChatConversation {
  return {
    id: data.id,
    userId: data.user_id,
    status: data.status,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMessage(data: any): ChatMessage {
  return {
    id: data.id,
    conversationId: data.conversation_id,
    senderId: data.sender_id,
    message: data.message,
    isAdmin: data.is_admin,
    readAt: data.read_at ? new Date(data.read_at) : null,
    createdAt: new Date(data.created_at),
  };
}
