/**
 * Chat Service - Conversas entre motoristas e embarcadores
 * Diferente do chat.ts (suporte), este serviço gerencia conversas de frete.
 */

import { supabase } from './supabase';
import { mapSupabaseError } from './chat';
import type { FreteStatus, FreteSource } from './fretes';
export { ChatError } from './chat';

export interface FreteConversation {
  id: string;
  freteId: string | null;
  motoristaId: string;
  embarcadorId: string;
  createdAt: Date;
  // Joined data
  frete?: { origin: string; destination: string };
  otherUser?: {
    id: string;
    name: string;
    photo: string | null;
    userType: 'motorista' | 'embarcador';
  };
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
  // Anexo (Migration 025)
  attachmentPath?: string | null;
  attachmentType?: 'image' | 'audio' | 'file' | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  attachmentMime?: string | null;
  /** Signed URL resolvida no client (não persistida). */
  attachmentUrl?: string | null;
}

export interface ConversationPeer {
  userId: string;
  name: string;
  userType: 'motorista' | 'embarcador' | 'admin';
  profilePhoto: string | null;
  companyName: string | null;
  companyLogo: string | null;
  vehicleModel: string | null;
  vehiclePlate: string | null;
  trailerAxles: number | null;
  cargoCapacity: number | null;
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
      motorista:users!conversations_motorista_id_fkey(id, name, profile_photo_url),
      embarcador:users!conversations_embarcador_id_fkey(id, name, profile_photo_url)
    `
    )
    .or(`motorista_id.eq.${userId},embarcador_id.eq.${userId}`)
    .order('updated_at', { ascending: false });

  if (error) throw mapSupabaseError(error);

  // Coleta IDs de embarcadores únicos pra buscar logo/nome da empresa em batch.
  const embarcadorIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => row.embarcador_id as string)
        .filter((id): id is string => !!id && id !== userId)
    )
  );

  let embarcadorMeta: Record<string, { logo: string | null; name: string | null }> = {};
  if (embarcadorIds.length > 0) {
    const { data: emps } = await supabase
      .from('embarcadores')
      .select('id, company_logo_url, company_name')
      .in('id', embarcadorIds);
    embarcadorMeta = Object.fromEntries(
      (emps ?? []).map((e) => [
        e.id as string,
        {
          logo: (e.company_logo_url as string) ?? null,
          name: (e.company_name as string) ?? null,
        },
      ])
    );
  }

  // Para cada conversa, busca última mensagem e contagem de não lidas
  const conversations = await Promise.all(
    (data || []).map(async (row) => {
      const conv = mapConversation(row);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      if (row.motorista_id === userId) {
        const meta = embarcadorMeta[row.embarcador_id] ?? { logo: null, name: null };
        const photo = meta.logo ?? r.embarcador?.profile_photo_url ?? null;
        const displayName = meta.name ?? r.embarcador?.name ?? 'Embarcador';
        conv.otherUser = {
          id: r.embarcador?.id ?? row.embarcador_id,
          name: displayName,
          photo,
          userType: 'embarcador',
        };
      } else {
        const photo = r.motorista?.profile_photo_url ?? null;
        conv.otherUser = {
          id: r.motorista?.id ?? row.motorista_id,
          name: r.motorista?.name ?? 'Motorista',
          photo,
          userType: 'motorista',
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (row.frete) conv.frete = row.frete as any;

      // Última mensagem
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, attachment_type')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastMsg) {
        if (lastMsg.content && lastMsg.content.trim() !== '') {
          conv.lastMessage = lastMsg.content;
        } else if (lastMsg.attachment_type === 'image') {
          conv.lastMessage = '🖼 Imagem';
        } else if (lastMsg.attachment_type === 'audio') {
          conv.lastMessage = '🎤 Áudio';
        } else if (lastMsg.attachment_type === 'file') {
          conv.lastMessage = '📎 Arquivo';
        }
      }

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
 * Linha mínima de mensagem usada na contagem de não lidas (subset de `messages`).
 * Tipo derivado em runtime — não persistido.
 */
export interface UnreadMessageRow {
  conversationId: string;
  senderId: string;
  readAt: string | null;
}

/**
 * Helper PURO: número de CONVERSAS distintas com ao menos uma mensagem não lida
 * pelo usuário (remetente != usuário E `read_at` nulo). Sem I/O — testável por PBT.
 *
 * Mensagens do próprio usuário ou já lidas nunca contribuem, e múltiplas mensagens
 * não lidas na mesma conversa contam como 1 (deduplicação via `Set`).
 */
export function countUnreadConversations(rows: UnreadMessageRow[], userId: string): number {
  const unread = new Set<string>();
  for (const r of rows) {
    if (r.senderId !== userId && r.readAt === null) {
      unread.add(r.conversationId);
    }
  }
  return unread.size;
}

/**
 * Helper PURO: número de mensagens não lidas pelo usuário DENTRO de uma conversa
 * (remetente != usuário E `read_at` nulo). Retorna 0 quando não há nenhuma.
 * Sem I/O — testável por PBT.
 */
export function countUnreadInConversation(rows: UnreadMessageRow[], userId: string): number {
  let n = 0;
  for (const r of rows) {
    if (r.senderId !== userId && r.readAt === null) n++;
  }
  return n;
}

/**
 * Helper PURO: formata o Conversation_Badge_Count para exibição no Chat_Badge.
 * - `''` (sem badge) quando `n === 0`;
 * - o próprio número como texto quando `1 <= n <= 9`;
 * - exatamente `'9+'` quando `n > 9`.
 *
 * Sem I/O — testável por PBT.
 */
export function formatBadge(n: number): string {
  if (n === 0) return '';
  if (n > 9) return '9+';
  return String(n);
}

/**
 * Reducer PURO: aplica a chegada de uma mensagem ao conjunto de conversas não lidas.
 *
 * Retorna um NOVO `Set` igual a `set ∪ {conversationId}` quando o remetente NÃO é o
 * motorista; caso contrário (mensagem do próprio motorista) retorna o conjunto
 * inalterado (no-op). Não muta o `set` de entrada.
 *
 * A deduplicação por `conversationId` garante a idempotência: uma segunda mensagem
 * não lida na mesma conversa não altera o tamanho do conjunto.
 */
export function applyIncomingMessage(
  set: Set<string>,
  conversationId: string,
  senderIsMotorista: boolean
): Set<string> {
  if (senderIsMotorista) return set;
  const next = new Set(set);
  next.add(conversationId);
  return next;
}

/**
 * Reducer PURO: marca uma conversa como lida no conjunto de conversas não lidas.
 *
 * Retorna um NOVO `Set` igual a `set \ {conversationId}`. Quando `conversationId`
 * não está no conjunto, o resultado é equivalente ao conjunto original (no-op).
 * Não muta o `set` de entrada.
 */
export function applyMarkRead(set: Set<string>, conversationId: string): Set<string> {
  const next = new Set(set);
  next.delete(conversationId);
  return next;
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
 * Conversation_Badge_Count autoritativo do usuário: número de CONVERSAS distintas
 * com ao menos uma mensagem não lida (remetente != usuário E `read_at` nulo).
 *
 * Reusa o mesmo padrão de fetch de `getTotalUnreadCount` (mesmas tabelas/colunas e
 * filtros), mas deduplica por `conversation_id` via o helper puro
 * `countUnreadConversations`. Em qualquer erro resolve `0` (degradação silenciosa,
 * Req 6.3) e nunca lança. A RLS de `conversations`/`messages` garante o escopo do
 * usuário (Req 7.2, 7.3).
 */
export async function getUnreadConversationsCount(userId: string): Promise<number> {
  try {
    const { data: convs, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .or(`motorista_id.eq.${userId},embarcador_id.eq.${userId}`);

    if (convErr || !convs || convs.length === 0) return 0;

    const ids = convs.map((c) => c.id);
    const { data, error } = await supabase
      .from('messages')
      .select('conversation_id, sender_id, read_at')
      .in('conversation_id', ids)
      .neq('sender_id', userId)
      .is('read_at', null);

    if (error) return 0; // degradação silenciosa: Req 6.3

    const rows: UnreadMessageRow[] = (data ?? []).map((m) => ({
      conversationId: m.conversation_id as string,
      senderId: m.sender_id as string,
      readAt: (m.read_at as string | null) ?? null,
    }));
    return countUnreadConversations(rows, userId);
  } catch {
    return 0; // nunca lança: Req 6.3
  }
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
    content: data.content ?? '',
    readAt: data.read_at ? new Date(data.read_at) : null,
    createdAt: new Date(data.created_at),
    senderName: data.sender?.name,
    attachmentPath: data.attachment_path ?? null,
    attachmentType: data.attachment_type ?? null,
    attachmentName: data.attachment_name ?? null,
    attachmentSize: data.attachment_size ?? null,
    attachmentMime: data.attachment_mime ?? null,
  };
}

/**
 * Faz upload de um arquivo pro bucket `chat-attachments` e cria a mensagem.
 * O path segue o formato `<conversation_id>/<sender_id>/<timestamp>_<file>`
 * exigido pela RLS do bucket.
 */
export async function sendFreteAttachment(
  conversationId: string,
  senderId: string,
  file: File,
  attachmentType: 'image' | 'audio' | 'file',
  contentText: string = ''
): Promise<FreteMessage> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${conversationId}/${senderId}/${Date.now()}_${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadErr) throw new Error(`Erro no upload: ${uploadErr.message}`);

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content: contentText,
      attachment_path: path,
      attachment_type: attachmentType,
      attachment_name: file.name,
      attachment_size: file.size,
      attachment_mime: file.type,
    })
    .select(`*, sender:users!messages_sender_id_fkey(name)`)
    .single();

  if (error) {
    // Rollback do upload em caso de falha de insert
    await supabase.storage.from('chat-attachments').remove([path]);
    throw mapSupabaseError(error);
  }

  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return mapMessage(data);
}

/**
 * Resolve uma signed URL pra um anexo do bucket privado.
 */
export async function resolveAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Busca dados ricos do "outro lado" da conversa pra exibir avatar +
 * empresa (embarcador) ou caminhão (motorista).
 */
export async function getConversationPeer(
  conversationId: string
): Promise<ConversationPeer | null> {
  const { data, error } = await supabase.rpc('get_conversation_peer', {
    p_conversation_id: conversationId,
  });
  if (error) {
    console.warn('Erro ao buscar peer da conversa', error);
    return null;
  }
  const r = (data as Record<string, unknown>[] | null)?.[0];
  if (!r) return null;
  return {
    userId: r.user_id as string,
    name: (r.name as string) ?? '',
    userType: (r.user_type as 'motorista' | 'embarcador' | 'admin') ?? 'motorista',
    profilePhoto: (r.profile_photo as string) ?? null,
    companyName: (r.company_name as string) ?? null,
    companyLogo: (r.company_logo as string) ?? null,
    vehicleModel: (r.vehicle_model as string) ?? null,
    vehiclePlate: (r.vehicle_plate as string) ?? null,
    trailerAxles: r.trailer_axles !== null ? (r.trailer_axles as number) : null,
    cargoCapacity: r.cargo_capacity !== null ? Number(r.cargo_capacity) : null,
  };
}

/**
 * Metadados leves do frete vinculado à conversa, usados para derivar o gating
 * da Conversation_Screen (badge + bloqueio de input) e exibir o valor no
 * Frete_Card.
 */
export interface FreteStatusInfo {
  status: FreteStatus; // 'ativo' | 'encerrado' | 'cancelado'
  source: FreteSource | null; // 'embarcador' | 'comunidade' | null
  value: number | null; // valor do frete p/ exibir no Frete_Card (Req 1.3)
}

/**
 * Recupera o status (e metadados leves) do frete vinculado à conversa.
 *
 * Consulta `fretes` por `id` selecionando apenas `status, source, value`.
 * Fail-safe: retorna `null` em qualquer falha (erro do Supabase, ausência de
 * dados ou exceção inesperada) — a camada de UI trata `null` como
 * Status_Indisponivel (`unknown`), nunca bloqueando o usuário por engano
 * (Req 3.5). A função NUNCA lança.
 *
 * _Requirements: 3.1, 3.5_
 */
export async function getFreteStatus(freteId: string): Promise<FreteStatusInfo | null> {
  try {
    const { data, error } = await supabase
      .from('fretes')
      .select('status, source, value')
      .eq('id', freteId)
      .single();

    if (error || !data) return null;

    return {
      status: data.status as FreteStatus,
      source: (data.source as FreteSource) ?? null,
      value: data.value != null ? Number(data.value) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Estado autoritativo da conversa para o gating do chat, resolvido pela RPC
 * `get_conversation_chat_state` (SECURITY DEFINER). Diferente de
 * `getFreteStatus`, enxerga o estado REAL do frete para qualquer participante
 * (a RLS do feed esconde fretes não-`ativo` do motorista) e libera o telefone
 * do peer apenas quando os dois lados atingiram o limiar de mensagens.
 */
export interface ConversationChatState {
  frete: {
    /** Há frete vinculado à conversa? (`false` ⇒ sem gating). */
    linked: boolean;
    /** A linha do frete ainda existe? (`false` ⇒ excluído). */
    exists: boolean;
    /** Status bruto quando disponível (`ativo`/`encerrado`/`cancelado`). */
    status: FreteStatus | null;
    /** Disponível para negociação (controla o bloqueio do input). */
    available: boolean;
    /** Valor do frete para o Frete_Card. */
    value: number | null;
  };
  whatsapp: {
    /** Ambos os lados atingiram o limiar de mensagens. */
    unlocked: boolean;
    /** Telefone do peer — só presente quando `unlocked` e frete disponível. */
    peerPhone: string | null;
    /** Mensagens enviadas pelo próprio usuário. */
    msgsSelf: number;
    /** Mensagens enviadas pelo peer. */
    msgsPeer: number;
    /** Limiar por lado para liberar o WhatsApp. */
    threshold: number;
  };
}

/**
 * Busca o estado da conversa (disponibilidade do frete + liberação do
 * WhatsApp) via RPC. Fail-safe: retorna `null` em qualquer falha — a UI trata
 * `null` mantendo o gate `unknown` (input liberado), nunca bloqueando por
 * engano em erro transitório. A função NUNCA lança.
 */
export async function getConversationChatState(
  conversationId: string
): Promise<ConversationChatState | null> {
  try {
    const { data, error } = await supabase.rpc('get_conversation_chat_state', {
      p_conversation_id: conversationId,
    });

    if (error || !data) return null;

    const r = data as {
      frete?: {
        linked?: boolean;
        exists?: boolean;
        status?: string | null;
        available?: boolean;
        value?: number | string | null;
      };
      whatsapp?: {
        unlocked?: boolean;
        peer_phone?: string | null;
        msgs_self?: number | null;
        msgs_peer?: number | null;
        threshold?: number | null;
      };
    };

    return {
      frete: {
        linked: !!r.frete?.linked,
        exists: !!r.frete?.exists,
        status: (r.frete?.status as FreteStatus | null) ?? null,
        available: !!r.frete?.available,
        value: r.frete?.value != null ? Number(r.frete.value) : null,
      },
      whatsapp: {
        unlocked: !!r.whatsapp?.unlocked,
        peerPhone: r.whatsapp?.peer_phone ?? null,
        msgsSelf: Number(r.whatsapp?.msgs_self ?? 0),
        msgsPeer: Number(r.whatsapp?.msgs_peer ?? 0),
        threshold: Number(r.whatsapp?.threshold ?? 3),
      },
    };
  } catch {
    return null;
  }
}
