/**
 * Property-Based Test — CP8* (opcional): Answerable_Signal por threshold.
 *
 * // Feature: suporte-inteligente, Property 8: deriveAnswerableSignal(confidence,
 * // threshold) é verdadeiro sse confidence >= threshold.
 *
 * Alvo: src/services/admin/suporte/validation.ts (deriveAnswerableSignal).
 *
 * Validates: Requirements 6.4, 6.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveAnswerableSignal } from '../../../services/admin/suporte/validation';

const unit = (): fc.Arbitrary<number> => fc.double({ min: 0, max: 1, noNaN: true });

describe('CP8* — Answerable_Signal por threshold', () => {
  it('verdadeiro sse confidence >= threshold', () => {
    fc.assert(
      fc.property(unit(), unit(), (confidence, threshold) => {
        expect(deriveAnswerableSignal(confidence, threshold)).toBe(confidence >= threshold);
      }),
      { numRuns: 100 }
    );
  });

  it('entrada não-finita degrada para não-respondível (false)', () => {
    fc.assert(
      fc.property(fc.constantFrom(NaN, Infinity, -Infinity), unit(), (bad, t) => {
        expect(deriveAnswerableSignal(bad, t)).toBe(false);
        expect(deriveAnswerableSignal(t, bad)).toBe(false);
      }),
      { numRuns: 30 }
    );
  });
});
