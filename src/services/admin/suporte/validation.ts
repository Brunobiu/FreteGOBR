/**
 * validation.ts — validações puras da Support_Console (suporte-inteligente).
 *
 * Mesmas regras aplicadas no frontend E no backend (Req 12.2). São a ÚNICA
 * condição que bloqueia o envio de formulário (Req 12.3, 12.7). Alvo dos
 * property tests CP8* (deriveAnswerableSignal) e CP10* (validações de FAQ).
 *
 * Validates: Requirements 5.2, 6.4, 6.8, 12.2
 */

/** Domínio fechado de categorias da FAQ (espelha o CHECK de support_kb_entries). */
export type FaqCategory = 'geral' | 'financeiro' | 'tecnico' | 'administrativo' | 'conta' | 'planos';

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  'geral',
  'financeiro',
  'tecnico',
  'administrativo',
  'conta',
  'planos',
] as const;

/** Domínio fechado do estado de publicação de uma FAQ_Entry. */
export type FaqPublicationState = 'rascunho' | 'publicada';

export const FAQ_PUBLICATION_STATES: readonly FaqPublicationState[] = [
  'rascunho',
  'publicada',
] as const;

/** Pergunta: 3..300 caracteres (comprimento após `trim`). */
export function validateFaqQuestion(question: string): boolean {
  const len = question.trim().length;
  return len >= 3 && len <= 300;
}

/** Resposta: 1..5000 caracteres (comprimento após `trim`). */
export function validateFaqAnswer(answer: string): boolean {
  const len = answer.trim().length;
  return len >= 1 && len <= 5000;
}

/** Categoria pertence ao domínio fechado. */
export function isValidCategory(category: string): category is FaqCategory {
  return (FAQ_CATEGORIES as readonly string[]).includes(category);
}

/** Estado de publicação pertence ao domínio fechado. */
export function isValidPublicationState(state: string): state is FaqPublicationState {
  return (FAQ_PUBLICATION_STATES as readonly string[]).includes(state);
}

/** `Confidence_Threshold`: número finito em `[0, 1]`. */
export function isValidConfidenceThreshold(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * `Answerable_Signal` = `confidence >= threshold`. Determinístico; exige
 * ambos finitos (entrada não-finita ⇒ não-respondível, degrada para handoff).
 */
export function deriveAnswerableSignal(confidence: number, threshold: number): boolean {
  if (!Number.isFinite(confidence) || !Number.isFinite(threshold)) return false;
  return confidence >= threshold;
}
