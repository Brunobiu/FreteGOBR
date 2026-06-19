/**
 * Property-Based Test — CP1: Exclusão mútua IA×humano.
 *
 * // Feature: suporte-inteligente, Property 1: nenhuma Atendimento_Message
 * // gerada por IA é persistida enquanto responder_mode='human'; toda resposta
 * // humana iniciada em 'ai' faz flip atômico para 'human' antes de ser aceita.
 *
 * Alvo: src/services/admin/suporte/responderModeReducer.ts (applyOp), model-based.
 *
 * Validates: Requirements 7.1, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 9.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyOp,
  initialTicket,
  type Op,
  type ResponderMode,
  type TicketModel,
} from '../../../services/admin/suporte/responderModeReducer';
import { TICKET_STATUSES, type TicketStatus } from '../../../services/admin/suporte/statusMachine';

const opArb = (): fc.Arbitrary<Op> =>
  fc.constantFrom<Op>(
    { kind: 'customer_message' },
    { kind: 'ai_reply_attempt' },
    { kind: 'human_reply' },
    { kind: 'handoff' },
    { kind: 'return_to_ai' }
  );

const modeArb = (): fc.Arbitrary<ResponderMode> => fc.constantFrom<ResponderMode>('ai', 'human');
const statusArb = (): fc.Arbitrary<TicketStatus> => fc.constantFrom(...TICKET_STATUSES);

describe('CP1 — exclusão mútua IA×humano (model-based)', () => {
  it('nenhuma mensagem de IA persiste sob modo human; flip humano é atômico', () => {
    fc.assert(
      fc.property(
        modeArb(),
        statusArb(),
        fc.array(opArb(), { maxLength: 40 }),
        (mode0, status0, ops) => {
          let state: TicketModel = initialTicket({ responderMode: mode0, status: status0 });

          for (const op of ops) {
            const before = state;
            state = applyOp(before, op);

            if (op.kind === 'ai_reply_attempt') {
              if (before.responderMode === 'human') {
                // AI_LOCKED: nada persistido (Req 8.2, 8.3).
                expect(state.lastResult).toBe('ai_locked');
                expect(state.messages.length).toBe(before.messages.length);
              } else {
                // Persiste mensagem de IA somente sob modo 'ai'.
                expect(state.messages.length).toBe(before.messages.length + 1);
                expect(state.messages[state.messages.length - 1].authorKind).toBe('ai');
              }
            }

            if (op.kind === 'human_reply' && before.responderMode === 'ai') {
              // Flip atômico ai→human ANTES de aceitar a resposta (Req 7.6, 8.4).
              expect(state.responderMode).toBe('human');
              expect(state.handoffAt).not.toBeNull();
              expect(state.messages[state.messages.length - 1].authorKind).toBe('admin');
            }
          }

          // Invariante global (Req 8.5): toda mensagem de IA foi inserida sob 'ai';
          // toda mensagem humana sob 'human'.
          for (const m of state.messages) {
            if (m.authorKind === 'ai') expect(m.modeAtInsert).toBe('ai');
            if (m.authorKind === 'admin') expect(m.modeAtInsert).toBe('human');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
