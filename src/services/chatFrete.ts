/**
 * Chat Service - Conversas entre motoristas e embarcadores
 * Diferente do chat.ts (suporte), este serviço gerencia conversas de frete.
 */

import { supabase } from './supabase';
import { mapSupabaseError } from './chat';
export { ChatError } from './chat';

export interface FreteConversation {
  id: string;
  freteId: string | null;
  motoristaId: string;
  embarcadorId: string;
  createdAt: Date;
  // Joined data
  frete?: { origin: string; destination: string };
  otherUser?: { name: string };
  lastMessage?: string;
  unreadCount?: number;
}

export interface FreteMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
  // Joined
  senderName?: string;
}

/**
 * Busca ou cria conversa para um frete específico
 */
export async function getOrCreateFreteConversation(
  freteId: string,
  motoristaId: string,
  embarcadorId: string
): Promise<FreteConversation> {
  // Tenta buscar conversa existente
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('frete_id', freteId)
    .eq('motorista_id', motoristaId)
    .single();

  if (existing) return mapConversation(existing);

  // Cria nova conversa
  const { data, error } = await supabase
    .from('conversations')
    .insert({ frete_id: freteId, motorista_id: motoristaId, embarcador_id: embarcadorId })
    .select()
    .single();

  if (error) throw mapSupabaseError(error);
  return mapConversation(data);
}

/**
 * Busca todas as conversas de um usuário (como motorista ou embarcador)
 */
export async function getUserConversations(userId: string): Promise<FreteConversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(
      `
      *,
      frete:fretes(origin, destination),
      motorista:users!conversations_motorista_id_fkey(name),
      embarcador:users!conversations_embarcador_id_fkey(name)
    `
    )
    .or(`motorista_id.eq.${userId},embarcador_id.eq.${userId}`)
    .order('updated_at', { ascending: false });

  if (error) throw mapSupabaseError(error);

  // Para cada conversa, busca última mensagem e contagem de não lidas
  const conversations = await Promise.all(
    (data || []).map(async (row) => {
      const conv = mapConversation(row);

      // Determina o outro usuário
      if (row.motorista_id === userId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conv.otherUser = { name: (row.embarcador as any)?.name || 'Embarcador' };
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conv.otherUser = { name: (row.motorista as any)?.name || 'Motorista' };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (row.frete) conv.frete = row.frete as any;

      // Última mensagem
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMsg) conv.lastMessage = lastMsg.content;

      // Não lidas
      const { data: unread } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conv.id)
        .neq('sender_id', userId)
        .is('read_at', null);

      conv.unreadCount = unread?.length || 0;

      return conv;
    })
  );

  return conversations;
}

/**
 * Busca mensagens de uma conversa
 */
export async function getFreteMessages(conversationId: string): Promise<FreteMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(`*, sender:users!messages_sender_id_fkey(name)`)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw mapSupabaseError(error);
  return (data || []).map(mapMessage);
}

/**
 * Envia uma mensagem
 */
export async function sendFreteMessage(
  conversationId: string,
  senderId: string,
  content: string
): Promise<FreteMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content })
    .select(`*, sender:users!messages_sender_id_fkey(name)`)
    .single();

  if (error) throw mapSupabaseError(error);

  // Atualiza updated_at da conversa
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return mapMessage(data);
}

/**
 * Marca mensagens como lidas
 */
export async function markFreteMessagesAsRead(
  conversationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);

  if (error) throw mapSupabaseError(error);
}

/**
 * Total de mensagens não lidas para um usuário
 */
export async function getTotalUnreadCount(userId: string): Promise<number> {
  // Busca todas as conversas do usuário
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .or(`motorista_id.eq.${userId},embarcador_id.eq.${userId}`);

  if (!convs || convs.length === 0) return 0;

  const ids = convs.map((c) => c.id);
  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .in('conversation_id', ids)
    .neq('sender_id', userId)
    .is('read_at', null);

  if (error) return 0;
  return data?.length || 0;
}

/**
 * Inscreve para receber novas mensagens em tempo real
 */
export function subscribeToFreteMessages(
  conversationId: string,
  callback: (msg: FreteMessage) => void
): () => void {
  const channel = supabase
    .channel(`frete-chat-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        callback(mapMessage(payload.new));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConversation(data: any): FreteConversation {
  return {
    id: data.id,
    freteId: data.frete_id,
    motoristaId: data.motorista_id,
    embarcadorId: data.embarcador_id,
    createdAt: new Date(data.created_at),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMessage(data: any): FreteMessage {
  return {
    id: data.id,
    conversationId: data.conversation_id,
    senderId: data.sender_id,
    content: data.content,
    readAt: data.read_at ? new Date(data.read_at) : null,
    createdAt: new Date(data.created_at),
    senderName: data.sender?.name,
  };
}
