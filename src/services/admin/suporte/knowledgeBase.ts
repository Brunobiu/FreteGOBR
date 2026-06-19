/**
 * knowledgeBase.ts — seletor de FAQ publicada + Context_Builder (suporte-inteligente).
 *
 * Funções puras importáveis pelo Vitest (alvo do property test CP9*) e
 * espelhadas pela Edge `support-ai-reply` no runtime Deno. A Support_AI consome
 * EXCLUSIVAMENTE entradas com `publication_state='publicada'` (Req 5.7) — único
 * critério de exposição.
 *
 * Validates: Requirements 5.7, 6.2
 */

import type { FaqCategory, FaqPublicationState } from './validation';

/** Forma mínima de uma FAQ_Entry usada pelo Context_Builder. */
export interface KbEntryLite {
  id: string;
  question: string;
  answer: string;
  category: FaqCategory | string;
  publication_state: FaqPublicationState | string;
}

/** Mensagem do histórico do atendimento (sem PII além do corpo). */
export interface TicketHistoryMessage {
  author_kind: 'user' | 'admin' | 'ai' | string;
  body: string;
}

/**
 * Seleciona apenas FAQ publicada (Req 5.7). Determinística; preserva a ordem.
 * Único critério de exposição à IA — nenhum outro marcador inclui/exclui.
 */
export function selectPublishedFaq<T extends { publication_state: string }>(entries: T[]): T[] {
  return entries.filter((e) => e.publication_state === 'publicada');
}

/** Mapeia o histórico do atendimento para papéis de chat (user/assistant). */
export function historyToMessages(
  history: TicketHistoryMessage[]
): { role: 'user' | 'assistant'; content: string }[] {
  return history.map((m) => ({
    role: m.author_kind === 'user' ? 'user' : 'assistant',
    content: m.body,
  }));
}

/**
 * Monta o bloco de CONTEXTO (system) da Support_AI a partir das FAQ publicadas.
 * Instrui o modelo a responder SOMENTE com base na Base de Conhecimento e a
 * devolver um JSON estruturado `{ answer, confidence, grounded }`.
 *
 * Espera receber a lista JÁ FILTRADA por `selectPublishedFaq`.
 */
export function buildSupportContext(publishedFaqs: KbEntryLite[]): string {
  const header = [
    'Você é o atendimento automático do FreteGO, falando diretamente com o cliente em pt-BR.',
    'Responda à última mensagem do cliente USANDO SOMENTE a Base de Conhecimento abaixo.',
    'Se a Base não cobre a dúvida com segurança, NÃO invente: marque grounded=false.',
    '',
    'Responda EXCLUSIVAMENTE com um JSON válido, sem texto fora dele, no formato:',
    '{"answer": "<resposta em pt-BR>", "confidence": <número entre 0 e 1>, "grounded": <true|false>}',
    '- confidence: o quão seguro você está de que a resposta resolve a dúvida com base na Base.',
    '- grounded: true somente se a resposta vier da Base de Conhecimento.',
    '',
    '## Base de Conhecimento (somente entradas publicadas)',
  ];

  const body =
    publishedFaqs.length === 0
      ? ['- (Base de Conhecimento vazia)']
      : publishedFaqs.map((f, i) => `${i + 1}. [${f.category}] P: ${f.question}\n   R: ${f.answer}`);

  return [...header, ...body].join('\n');
}
