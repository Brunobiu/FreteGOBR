/**
 * priorityClassifier.ts — Priority_Classifier (suporte-inteligente).
 *
 * Função pura e determinística que classifica o atendimento em três níveis.
 * Espelhada no backend e alvo do property test CP5.
 *
 * Tabela de decisão:
 *   | Critical_Category presente | Answerable_Signal | Priority_Level |
 *   | sim (qualquer)             | qualquer          | 3              |
 *   | não                        | true              | 1              |
 *   | não                        | false             | 2              |
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 */

export type CriticalCategory = 'financeiro' | 'tecnico' | 'administrativo';
export type PriorityLevel = 1 | 2 | 3;

/** Domínio fechado das categorias críticas (Nível 3). */
export const CRITICAL_CATEGORIES: readonly CriticalCategory[] = [
  'financeiro',
  'tecnico',
  'administrativo',
] as const;

/**
 * Classifica a prioridade. Determinística e total em `{1,2,3}`:
 *   - `criticalCategory` presente ⇒ 3 (independe de `answerableSignal`).
 *   - ausente e `answerableSignal` verdadeiro ⇒ 1.
 *   - ausente e `answerableSignal` falso ⇒ 2.
 */
export function classifyPriority(
  answerableSignal: boolean,
  criticalCategory: CriticalCategory | null
): PriorityLevel {
  if (criticalCategory !== null) return 3;
  return answerableSignal ? 1 : 2;
}

/** Type guard do domínio fechado de categoria crítica. */
export function isCriticalCategory(value: string): value is CriticalCategory {
  return (CRITICAL_CATEGORIES as readonly string[]).includes(value);
}
