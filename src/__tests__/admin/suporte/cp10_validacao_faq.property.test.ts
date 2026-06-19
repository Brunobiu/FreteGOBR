/**
 * Property-Based Test — CP10* (opcional): Validação de FAQ e config da IA.
 *
 * // Feature: suporte-inteligente, Property 10: validação aceita sse pergunta ∈
 * // [3,300], resposta ∈ [1,5000], category no domínio fechado e
 * // confidence_threshold número finito em [0,1].
 *
 * Alvo: src/services/admin/suporte/validation.ts. A mesma regra vale no
 * frontend e no backend (Req 12.2).
 *
 * Validates: Requirements 5.2, 6.8, 12.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateFaqQuestion,
  validateFaqAnswer,
  isValidCategory,
  isValidConfidenceThreshold,
  FAQ_CATEGORIES,
} from '../../../services/admin/suporte/validation';

describe('CP10* — validação de FAQ e config da IA', () => {
  it('pergunta válida sse comprimento (após trim) ∈ [3,300]', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 360 }), (q) => {
        const len = q.trim().length;
        expect(validateFaqQuestion(q)).toBe(len >= 3 && len <= 300);
      }),
      { numRuns: 100 }
    );
  });

  it('resposta válida sse comprimento (após trim) ∈ [1,5000]', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (a) => {
        const len = a.trim().length;
        expect(validateFaqAnswer(a)).toBe(len >= 1 && len <= 5000);
      }),
      { numRuns: 100 }
    );
  });

  it('category aceita exatamente o domínio fechado', () => {
    const known = fc.constantFrom(...FAQ_CATEGORIES);
    const unknown = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => !(FAQ_CATEGORIES as readonly string[]).includes(s));
    fc.assert(
      fc.property(fc.oneof(known, unknown), (c) => {
        expect(isValidCategory(c)).toBe((FAQ_CATEGORIES as readonly string[]).includes(c));
      }),
      { numRuns: 100 }
    );
  });

  it('confidence_threshold válido sse número finito em [0,1]', () => {
    const candidate = fc.oneof(
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: -5, max: 6 }), // inclui fora de faixa
      fc.constantFrom(NaN, Infinity, -Infinity, -0.0001, 1.0001)
    );
    fc.assert(
      fc.property(candidate, (n) => {
        expect(isValidConfidenceThreshold(n)).toBe(Number.isFinite(n) && n >= 0 && n <= 1);
      }),
      { numRuns: 100 }
    );
  });
});
