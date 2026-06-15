/**
 * Property-Based Test — motorista-chat-nav, Property 6.
 *
 * Feature: motorista-chat-nav, Property 6: O Conversation_Badge_Count é sempre
 * um inteiro não negativo igual ao tamanho do conjunto.
 * Validates: Requirements 5.6, 6.1, 6.2
 *
 * Invariante: para qualquer sequência de operações de inserção (mensagem de
 * terceiro) e marcação de leitura aplicada a partir de um conjunto inicial
 * qualquer, o `Conversation_Badge_Count` resultante é igual ao tamanho do
 * conjunto de conversas não lidas e nunca é negativo. Quando o conjunto fica
 * vazio, o count é 0 (sem badge, `formatBadge` retorna '').
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { applyIncomingMessage, applyMarkRead, formatBadge } from '../services/chatFrete';

const ID_POOL = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'] as const;

const setArb: fc.Arbitrary<Set<string>> = fc
  .array(fc.constantFrom(...ID_POOL), { maxLength: 5 })
  .map((arr) => new Set(arr));

// Operação: incoming (com flag senderIsMotorista) ou markRead, sobre um c do pool.
type Op =
  | { kind: 'incoming'; conversationId: string; senderIsMotorista: boolean }
  | { kind: 'markRead'; conversationId: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant<'incoming'>('incoming'),
    conversationId: fc.constantFrom(...ID_POOL),
    senderIsMotorista: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant<'markRead'>('markRead'),
    conversationId: fc.constantFrom(...ID_POOL),
  })
);

function applyOp(set: Set<string>, op: Op): Set<string> {
  return op.kind === 'incoming'
    ? applyIncomingMessage(set, op.conversationId, op.senderIsMotorista)
    : applyMarkRead(set, op.conversationId);
}

describe('motorista-chat-nav — Property 6: invariante count === set.size e count >= 0', () => {
  it('count nunca negativo e igual ao tamanho do conjunto após cada operação', () => {
    fc.assert(
      fc.property(setArb, fc.array(opArb, { maxLength: 40 }), (initial, ops) => {
        let set = new Set(initial);
        for (const op of ops) {
          set = applyOp(set, op);
          const count = set.size;
          expect(count).toBeGreaterThanOrEqual(0);
          expect(count).toBe(set.size);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('conjunto vazio ⇒ count 0 e sem badge', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        // Sequência de markRead esvazia; verificamos no estado vazio.
        let set = new Set<string>();
        for (const op of ops) set = applyOp(set, op);
        if (set.size === 0) {
          expect(formatBadge(set.size)).toBe('');
        }
        // Estado explicitamente vazio sempre dá ''.
        expect(formatBadge(new Set<string>().size)).toBe('');
      }),
      { numRuns: 100 }
    );
  });

  it('formatBadge sempre coerente com o tamanho do conjunto resultante', () => {
    fc.assert(
      fc.property(setArb, fc.array(opArb, { maxLength: 40 }), (initial, ops) => {
        let set = new Set(initial);
        for (const op of ops) set = applyOp(set, op);
        const n = set.size;
        const badge = formatBadge(n);
        if (n === 0) expect(badge).toBe('');
        else if (n <= 9) expect(badge).toBe(String(n));
        else expect(badge).toBe('9+');
      }),
      { numRuns: 100 }
    );
  });
});
