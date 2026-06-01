// Feature: admin-assistant, Property 10
/**
 * CP-10: Historico de Chat ordenado cronologicamente crescente
 *
 * Para toda lista de ChatMessage, normalizeHistory produz uma PERMUTACAO da
 * entrada ordenada de forma NAO-DECRESCENTE por `createdAt` (cada mensagem
 * tem `createdAt` menor ou igual a seguinte).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 5.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  normalizeHistory,
  type ChatMessage,
  type ChatRole,
} from '../../../services/admin/assistant';

// ----- Geradores -----

const roleGen = fc.constantFrom<ChatRole>('user', 'assistant', 'system');

// Timestamps ISO variados a partir de epoch ms, permitindo empates.
const isoTimestampGen = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970..2100
  .map((ms) => new Date(ms).toISOString());

const chatMessageGen: fc.Arbitrary<ChatMessage> = fc.record({
  id: fc.uuid(),
  conversationId: fc.uuid(),
  role: roleGen,
  content: fc.string({ minLength: 0, maxLength: 40 }),
  createdAt: isoTimestampGen,
});

const messageListGen = fc.array(chatMessageGen, { minLength: 0, maxLength: 40 });

// Chave de ordenacao identica a do helper (epoch ms; invalidos para -inf).
function tsKey(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function idMultiset(list: ChatMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of list) {
    counts[m.id] = (counts[m.id] ?? 0) + 1;
  }
  return counts;
}

describe('CP-10: Historico de Chat ordenado cronologicamente crescente', () => {
  it('produz permutacao nao-decrescente por createdAt', () => {
    fc.assert(
      fc.property(messageListGen, (list) => {
        const sorted = normalizeHistory(list);

        // Mesmo tamanho.
        expect(sorted.length).toBe(list.length);

        // Mesma multiset (permutacao da entrada).
        expect(idMultiset(sorted)).toEqual(idMultiset(list));

        // Ordem nao-decrescente por createdAt.
        for (let i = 0; i + 1 < sorted.length; i++) {
          expect(tsKey(sorted[i].createdAt)).toBeLessThanOrEqual(tsKey(sorted[i + 1].createdAt));
        }
      }),
      { numRuns: 100 }
    );
  });
});
