/**
 * Property-Based Test — motorista-chat-nav, Property 2.
 *
 * Feature: motorista-chat-nav, Property 2: Contagem por conversa conta apenas
 * mensagens não lidas de terceiros.
 * Validates: Requirements 4.1, 4.2, 4.3
 *
 * Invariante: `countUnreadInConversation(rows, userId)` retorna exatamente a
 * quantidade de mensagens com `senderId != userId` E `readAt === null`, e
 * retorna 0 quando não há nenhuma.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { countUnreadInConversation, type UnreadMessageRow } from '../services/chatFrete';

const USER_IDS = ['u-motorista', 'u-embarcador-1', 'u-embarcador-2'] as const;

// Mensagens de UMA conversa (mesmo conversationId).
const rowArb: fc.Arbitrary<UnreadMessageRow> = fc.record({
  conversationId: fc.constant('c-unica'),
  senderId: fc.constantFrom(...USER_IDS),
  readAt: fc.option(
    fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true })
      .map((d) => d.toISOString()),
    { nil: null }
  ),
});

/** Computação de referência independente da implementação. */
function referenceCount(rows: UnreadMessageRow[], userId: string): number {
  return rows.filter((r) => r.senderId !== userId && r.readAt === null).length;
}

describe('motorista-chat-nav — Property 2: contagem de não lidas por conversa', () => {
  it('iguala o número de mensagens não lidas de terceiros', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 50 }),
        fc.constantFrom(...USER_IDS),
        (rows, userId) => {
          expect(countUnreadInConversation(rows, userId)).toBe(referenceCount(rows, userId));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('retorna 0 quando não há mensagens não lidas de terceiros', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 50 }), (rows) => {
        const userId = 'u-motorista';
        // Caso vazio.
        expect(countUnreadInConversation([], userId)).toBe(0);
        // Todas do próprio usuário.
        const own = rows.map((r) => ({ ...r, senderId: userId }));
        expect(countUnreadInConversation(own, userId)).toBe(0);
        // Todas já lidas.
        const read = rows.map((r) => ({ ...r, readAt: '2024-01-01T00:00:00.000Z' }));
        expect(countUnreadInConversation(read, userId)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('conta cada mensagem não lida individualmente (sem deduplicação)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        const rows: UnreadMessageRow[] = Array.from({ length: n }, () => ({
          conversationId: 'c-unica',
          senderId: 'u-embarcador-1',
          readAt: null,
        }));
        expect(countUnreadInConversation(rows, 'u-motorista')).toBe(n);
      }),
      { numRuns: 100 }
    );
  });
});
