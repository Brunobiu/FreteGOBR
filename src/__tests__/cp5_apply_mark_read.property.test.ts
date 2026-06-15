/**
 * Property-Based Test — motorista-chat-nav, Property 5.
 *
 * Feature: motorista-chat-nav, Property 5: Marcar conversa como lida decrementa
 * em exatamente 1 (ou mantém).
 * Validates: Requirements 5.5
 *
 * Invariante: para qualquer conjunto `S` e `conversationId c`,
 * `applyMarkRead(S, c)` resulta em `S' = S \ {c}`. Logo `|S'| = |S| - 1`
 * quando `c ∈ S` e `|S'| = |S|` quando `c ∉ S`. O conjunto de entrada nunca é
 * mutado.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { applyMarkRead } from '../services/chatFrete';

const ID_POOL = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'] as const;

const setArb: fc.Arbitrary<Set<string>> = fc
  .array(fc.constantFrom(...ID_POOL), { maxLength: 5 })
  .map((arr) => new Set(arr));

const idArb = fc.constantFrom(...ID_POOL);

describe('motorista-chat-nav — Property 5: marcar como lida decrementa em 1 (ou no-op)', () => {
  it('resultado é S \\ {c} com transição de tamanho correta', () => {
    fc.assert(
      fc.property(setArb, idArb, (set, c) => {
        const had = set.has(c);
        const before = set.size;
        const result = applyMarkRead(set, c);

        expect(result.has(c)).toBe(false);
        // Todos os outros elementos preservados.
        for (const x of set) {
          if (x !== c) expect(result.has(x)).toBe(true);
        }
        expect(result.size).toBe(had ? before - 1 : before);
      }),
      { numRuns: 100 }
    );
  });

  it('marcar conversa ausente é no-op de tamanho', () => {
    fc.assert(
      fc.property(setArb, (set) => {
        const absent = 'c-inexistente';
        const result = applyMarkRead(set, absent);
        expect(result.size).toBe(set.size);
        for (const x of set) expect(result.has(x)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('não muta o conjunto de entrada', () => {
    fc.assert(
      fc.property(setArb, idArb, (set, c) => {
        const snapshot = new Set(set);
        applyMarkRead(set, c);
        expect(set.size).toBe(snapshot.size);
        for (const x of snapshot) expect(set.has(x)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
