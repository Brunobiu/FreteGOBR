/**
 * Property-Based Test — motorista-chat-nav, Property 4.
 *
 * Feature: motorista-chat-nav, Property 4: Inserção de mensagem não lida é
 * incremento idempotente por conversa.
 * Validates: Requirements 5.1, 5.2
 *
 * Invariante: para qualquer conjunto `S` e `conversationId c`:
 *   - se o remetente NÃO é o motorista ⇒ `S' = S ∪ {c}`, logo
 *     `|S'| = |S| + 1` quando `c ∉ S` e `|S'| = |S|` quando `c ∈ S`;
 *   - se o remetente É o motorista ⇒ `S'` inalterado;
 *   - o conjunto de entrada nunca é mutado.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { applyIncomingMessage } from '../services/chatFrete';

const ID_POOL = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'] as const;

const setArb: fc.Arbitrary<Set<string>> = fc
  .array(fc.constantFrom(...ID_POOL), { maxLength: 5 })
  .map((arr) => new Set(arr));

const idArb = fc.constantFrom(...ID_POOL);

describe('motorista-chat-nav — Property 4: inserção idempotente por conversa', () => {
  it('remetente terceiro: resultado é S ∪ {c} com transição de tamanho correta', () => {
    fc.assert(
      fc.property(setArb, idArb, (set, c) => {
        const had = set.has(c);
        const before = set.size;
        const result = applyIncomingMessage(set, c, false);

        expect(result.has(c)).toBe(true);
        // S' = S ∪ {c}
        for (const x of set) expect(result.has(x)).toBe(true);
        expect(result.size).toBe(had ? before : before + 1);
      }),
      { numRuns: 100 }
    );
  });

  it('remetente é o motorista: conjunto inalterado (no-op)', () => {
    fc.assert(
      fc.property(setArb, idArb, (set, c) => {
        const result = applyIncomingMessage(set, c, true);
        expect(result.size).toBe(set.size);
        for (const x of set) expect(result.has(x)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('não muta o conjunto de entrada', () => {
    fc.assert(
      fc.property(setArb, idArb, fc.boolean(), (set, c, senderIsMotorista) => {
        const snapshot = new Set(set);
        applyIncomingMessage(set, c, senderIsMotorista);
        expect(set.size).toBe(snapshot.size);
        for (const x of snapshot) expect(set.has(x)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
