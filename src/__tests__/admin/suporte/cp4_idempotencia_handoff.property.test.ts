/**
 * Property-Based Test — CP4: Idempotência de Handoff e Return_To_AI.
 *
 * // Feature: suporte-inteligente, Property 4: Handoff sob 'human' (ou
 * // Return_To_AI sob 'ai') não altera o estado além da 1ª aplicação e retorna
 * // _SKIPPED; reaplicar é idempotente (f(f(x)) == f(x)).
 *
 * Alvo: src/services/admin/suporte/responderModeReducer.ts (handoff/return_to_ai).
 *
 * Validates: Requirements 7.5, 9.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyOp,
  initialTicket,
  projectState,
  type ResponderMode,
} from '../../../services/admin/suporte/responderModeReducer';
import { TICKET_STATUSES, type TicketStatus } from '../../../services/admin/suporte/statusMachine';

const modeArb = (): fc.Arbitrary<ResponderMode> => fc.constantFrom<ResponderMode>('ai', 'human');
const statusArb = (): fc.Arbitrary<TicketStatus> => fc.constantFrom(...TICKET_STATUSES);

describe('CP4 — idempotência de Handoff/Return_To_AI', () => {
  it('Handoff: após a 1ª aplicação fica human; reaplicar é _SKIPPED e não muda o estado', () => {
    fc.assert(
      fc.property(modeArb(), statusArb(), fc.integer({ min: 1, max: 6 }), (mode0, status0, n) => {
        let state = initialTicket({ responderMode: mode0, status: status0 });
        state = applyOp(state, { kind: 'handoff' });
        expect(state.responderMode).toBe('human');
        const afterFirst = projectState(state);

        for (let i = 0; i < n; i++) {
          state = applyOp(state, { kind: 'handoff' });
          expect(state.responderMode).toBe('human');
          expect(state.lastResult).toBe('skipped_already_human');
          expect(projectState(state)).toEqual(afterFirst); // f(f(x)) == f(x)
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Return_To_AI: após a 1ª aplicação fica ai; reaplicar é _SKIPPED e não muda o estado', () => {
    fc.assert(
      fc.property(modeArb(), statusArb(), fc.integer({ min: 1, max: 6 }), (mode0, status0, n) => {
        let state = initialTicket({ responderMode: mode0, status: status0 });
        state = applyOp(state, { kind: 'return_to_ai' });
        expect(state.responderMode).toBe('ai');
        const afterFirst = projectState(state);

        for (let i = 0; i < n; i++) {
          state = applyOp(state, { kind: 'return_to_ai' });
          expect(state.responderMode).toBe('ai');
          expect(state.lastResult).toBe('skipped_already_ai');
          expect(projectState(state)).toEqual(afterFirst);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('alternar Handoff/Return_To_AI sempre converge ao modo da última operação aplicada', () => {
    fc.assert(
      fc.property(modeArb(), (mode0) => {
        let state = initialTicket({ responderMode: mode0 });
        state = applyOp(state, { kind: 'handoff' });
        state = applyOp(state, { kind: 'return_to_ai' });
        expect(state.responderMode).toBe('ai');
        state = applyOp(state, { kind: 'handoff' });
        expect(state.responderMode).toBe('human');
      }),
      { numRuns: 50 }
    );
  });
});
