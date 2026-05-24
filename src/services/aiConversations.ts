/**
 * Persistência local das conversas do assistente IA.
 *
 * Por enquanto, usamos localStorage por simplicidade — cada usuário tem
 * sua própria lista, namespaceada por ID. Quando uma API real for
 * conectada e houver necessidade de sincronização entre dispositivos,
 * basta substituir essas funções por chamadas a uma tabela no Supabase.
 */

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Frete sugerido (opcional). Guardamos só o ID — o resto vem do banco. */
  suggestionFreteId?: string;
  suggestionLucroLiquido?: number;
  suggestionLucroPorKm?: number;
  /** Marca a mensagem como pedido de localização (renderiza botão). */
  requestsLocation?: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
}

const KEY = (userId: string) => `fretego-ai-conversations-${userId}`;

function read(userId: string): AiConversation[] {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return [];
    return JSON.parse(raw) as AiConversation[];
  } catch {
    return [];
  }
}

function write(userId: string, list: AiConversation[]): void {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(list));
  } catch {
    /* quota excedida — ignora */
  }
}

export function listConversations(userId: string): AiConversation[] {
  return read(userId).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getConversation(userId: string, id: string): AiConversation | null {
  return read(userId).find((c) => c.id === id) ?? null;
}

export function createConversation(userId: string): AiConversation {
  const conv: AiConversation = {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Nova conversa',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  const list = read(userId);
  list.push(conv);
  write(userId, list);
  return conv;
}

export function saveConversation(userId: string, conv: AiConversation): void {
  const list = read(userId);
  const idx = list.findIndex((c) => c.id === conv.id);
  const updated = { ...conv, updatedAt: new Date().toISOString() };
  if (idx === -1) list.push(updated);
  else list[idx] = updated;
  write(userId, list);
}

export function deleteConversation(userId: string, id: string): void {
  write(
    userId,
    read(userId).filter((c) => c.id !== id)
  );
}

/**
 * Gera um título inteligente a partir da primeira mensagem do usuário.
 */
export function inferTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 40) return trimmed;
  return trimmed.slice(0, 40).trimEnd() + '…';
}
