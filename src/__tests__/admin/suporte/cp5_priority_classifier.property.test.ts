/**
 * Property-Based Test — CP5: Classificação determinística de prioridade.
 *
 * // Feature: suporte-inteligente, Property 5: classifyPriority é determinística
 * // e total em {1,2,3}: Critical_Category presente ⇒ 3; ausente+true ⇒ 1;
 * // ausente+false ⇒ 2.
 *
 * Alvo: src/services/admin/suporte/priorityClassifier.ts (classifyPriority).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.10
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classifyPriority,
  CRITICAL_CATEGORIES,
  type CriticalCategory,
} from '../../../services/admin/suporte/priorityClassifier';

const criticalArb = (): fc.Arbitrary<CriticalCategory | null> =>
  fc.option(fc.constantFrom<CriticalCategory>(...CRITICAL_CATEGORIES), { nil: null });

describe('CP5 — Priority_Classifier', () => {
  it('classifica deterministicamente e total em {1,2,3}', () => {
    fc.assert(
      fc.property(fc.boolean(), criticalArb(), (signal, category) => {
        const level = classifyPriority(signal, category);

        if (category !== null) {
          expect(level).toBe(3); // crítico independe do Answerable_Signal
        } else {
          expect(level).toBe(signal ? 1 : 2);
        }

        // Determinismo: mesma entrada ⇒ mesmo nível.
        expect(classifyPriority(signal, category)).toBe(level);
        // Total em {1,2,3}.
        expect([1, 2, 3]).toContain(level);
      }),
      { numRuns: 100 }
    );
  });
});
