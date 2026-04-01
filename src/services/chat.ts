/**
 * Chat Service - Suporte ao usuário
 */

import { supabase } from './supabase';

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

  if (error) throw new Error(`Erro ao criar conversa: ${error.message}`);
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

  if (error) throw new Error(`Erro ao enviar mensagem: ${error.message}`);
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

  if (error) throw new Error(`Erro ao buscar mensagens: ${error.message}`);
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

  if (error) throw new Error(`Erro ao marcar como lidas: ${error.message}`);
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

  if (error) throw new Error(`Erro ao atualizar status: ${error.message}`);
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
