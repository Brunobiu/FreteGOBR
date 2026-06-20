/**
 * supervisor/chatHistory.ts — núcleo puro do histórico de conversas do chat da
 * IA Supervisora (supervisor-chat-history / 119).
 *
 * Funções puras, determinísticas e totais, espelho das RPCs/RLS:
 *  - deriveTitle: título da conversa a partir da 1ª mensagem (sem PII) — CP1.
 *  - compareSessions / compareMessages: ordenação total — CP2.
 *  - validateMessage: validação de role/content — CP3.
 *
 * Spec: .kiro/specs/supervisor-chat-history/{requirements,design}.md
 */

import { sanitizeSupervisorText } from './sanitize';

export const CHAT_LIMITS = {
  TITLE_MAX: 120,
  CONTENT_MAX: 8000,
  TITLE_DERIVE_MAX: 80,
} as const;

export const DEFAULT_SESSION_TITLE = 'Nova conversa';

export type ChatRole = 'user' | 'ai';

export interface ChatSessionRow {
  id: string;
  updatedAt: string;
}
export interface ChatMessageRow {
  id: string;
  createdAt: string;
}

export type MessageValidation = { ok: true } | { ok: false; code: 'INVALID_INPUT'; message: string };

/**
 * Deriva o título da conversa a partir da 1ª mensagem do usuário:
 * sanitiza PII → colapsa espaços → trim → trunca em TITLE_DERIVE_MAX.
 * Vazio (ou só espaços/só-PII-redigida-removida) ⇒ DEFAULT_SESSION_TITLE.
 * Determinística, total e SEM PII (CP1).
 */
export function deriveTitle(firstUserMessage: unknown): string {
  const raw = typeof firstUserMessage === 'string' ? firstUserMessage : '';
  const sanitized = sanitizeSupervisorText(raw);
  const collapsed = sanitized.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return DEFAULT_SESSION_TITLE;
  const truncated = collapsed.slice(0, CHAT_LIMITS.TITLE_DERIVE_MAX).trim();
  return truncated === '' ? DEFAULT_SESSION_TITLE : truncated;
}

/** Ordem total de sessões: updated_at desc, depois id asc (espelha a RPC). */
export function compareSessions(a: ChatSessionRow, b: ChatSessionRow): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1; // desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // tiebreak estável
}

/** Ordem total de mensagens: created_at asc, depois id asc. */
export function compareMessages(a: ChatMessageRow, b: ChatMessageRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1; // asc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Valida (role, content) de uma mensagem. Total e determinística (CP3):
 *  - role deve ∈ {'user','ai'};
 *  - content não-vazio (após trim) e ≤ CONTENT_MAX.
 * NÃO decide permissão — a precedência de permission_denied é do service/RPC.
 */
export function validateMessage(role: unknown, content: unknown): MessageValidation {
  if (role !== 'user' && role !== 'ai') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Papel de mensagem inválido.' };
  }
  if (typeof content !== 'string' || content.trim() === '') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Mensagem vazia.' };
  }
  if (content.length > CHAT_LIMITS.CONTENT_MAX) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Mensagem muito longa.' };
  }
  return { ok: true };
}
