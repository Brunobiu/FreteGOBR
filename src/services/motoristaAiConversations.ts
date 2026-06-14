/**
 * motoristaAiConversations.ts — CRUD de conversas do assistente IA do motorista.
 *
 * Substitui o antigo serviço localStorage (aiConversations.ts) por persistência
 * no Supabase. As tabelas usam RLS por motorista_id = auth.uid().
 */

import { supabase } from './supabase';

export interface MotoristaConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MotoristaMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Lista conversas do motorista autenticado (ordenadas por updated_at DESC).
 */
export async function listMotoristaConversations(): Promise<MotoristaConversation[]> {
  const { data, error } = await supabase
    .from('motorista_ai_conversations')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Cria uma nova conversa para o motorista autenticado.
 */
export async function createMotoristaConversation(
  title: string = 'Nova conversa'
): Promise<MotoristaConversation> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const { data, error } = await supabase
    .from('motorista_ai_conversations')
    .insert({ motorista_id: user.id, title })
    .select('id, title, created_at, updated_at')
    .single();

  if (error) throw error;
  return {
    id: data.id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Carrega mensagens de uma conversa (ordenadas cronologicamente ASC).
 */
export async function getConversationMessages(conversationId: string): Promise<MotoristaMessage[]> {
  const { data, error } = await supabase
    .from('motorista_ai_messages')
    .select('id, conversation_id, role, content, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}

/**
 * Adiciona uma mensagem a uma conversa existente.
 * Também atualiza o updated_at da conversa.
 */
export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown> | null
): Promise<MotoristaMessage> {
  const { data, error } = await supabase
    .from('motorista_ai_messages')
    .insert({ conversation_id: conversationId, role, content, metadata })
    .select('id, conversation_id, role, content, metadata, created_at')
    .single();

  if (error) throw error;

  // Touch updated_at da conversa (fire-and-forget)
  supabase
    .from('motorista_ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .then(() => {});

  return {
    id: data.id,
    conversationId: data.conversation_id,
    role: data.role as 'user' | 'assistant',
    content: data.content,
    metadata: data.metadata,
    createdAt: data.created_at,
  };
}

/**
 * Atualiza o título de uma conversa.
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  const { error } = await supabase
    .from('motorista_ai_conversations')
    .update({ title })
    .eq('id', conversationId);

  if (error) throw error;
}

/**
 * Exclui uma conversa e todas as suas mensagens (CASCADE).
 */
export async function deleteMotoristaConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('motorista_ai_conversations')
    .delete()
    .eq('id', conversationId);

  if (error) throw error;
}
