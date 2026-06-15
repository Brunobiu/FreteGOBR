/**
 * Property-Based Test — motorista-chat-nav, Property 1.
 *
 * Feature: motorista-chat-nav, Property 1: Contagem é o número de conversas
 * distintas não lidas.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.6
 *
 * Invariante: `countUnreadConversations(rows, userId)` retorna exatamente o
 * número de `conversationId` DISTINTOS que possuem ao menos uma mensagem com
 * `senderId != userId` E `readAt === null`. Mensagens do próprio usuário ou já
 * lidas nunca contribuem; múltiplas não lidas na mesma conversa contam como 1.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { countUnreadConversations, type UnreadMessageRow } from '../services/chatFrete';

// Pool pequeno de IDs para forçar colisões intencionais entre conversas/remetentes.
const CONVERSATION_IDS = ['c-1', 'c-2', 'c-3', 'c-4'] as const;
const USER_IDS = ['u-motorista', 'u-embarcador-1', 'u-embarcador-2'] as const;

const rowArb: fc.Arbitrary<UnreadMessageRow> = fc.record({
  conversationId: fc.constantFrom(...CONVERSATION_IDS),
  senderId: fc.constantFrom(...USER_IDS),
  // readAt nulo (não lida) ou ISO string (lida) — força ambos os caminhos.
  readAt: fc.option(
    fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true })
      .map((d) => d.toISOString()),
    { nil: null }
  ),
});

/** Computação de referência independente da implementação. */
function referenceCount(rows: UnreadMessageRow[], userId: string): number {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.senderId !== userId && r.readAt === null) set.add(r.conversationId);
  }
  return set.size;
}

describe('motorista-chat-nav — Property 1: contagem de conversas distintas não lidas', () => {
  it('iguala o Set de referência para qualquer lista de mensagens', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 50 }),
        fc.constantFrom(...USER_IDS),
        (rows, userId) => {
          expect(countUnreadConversations(rows, userId)).toBe(referenceCount(rows, userId));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('múltiplas mensagens não lidas na mesma conversa contam como 1', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONVERSATION_IDS),
        fc.integer({ min: 1, max: 10 }),
        (conversationId, n) => {
          const rows: UnreadMessageRow[] = Array.from({ length: n }, () => ({
            conversationId,
            senderId: 'u-embarcador-1',
            readAt: null,
          }));
          expect(countUnreadConversations(rows, 'u-motorista')).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mensagens do próprio usuário ou já lidas nunca contribuem', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 50 }), (rows) => {
        const userId = 'u-motorista';
        // Força todas a serem do próprio usuário OU lidas → contagem deve ser 0.
        const ignored = rows.map((r) => ({ ...r, senderId: userId }));
        expect(countUnreadConversations(ignored, userId)).toBe(0);

        const allRead = rows.map((r) => ({ ...r, readAt: '2024-01-01T00:00:00.000Z' }));
        expect(countUnreadConversations(allRead, userId)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
