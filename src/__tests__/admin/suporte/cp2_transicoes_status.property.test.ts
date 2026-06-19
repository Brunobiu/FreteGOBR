/**
 * Property-Based Test — CP2: Transições de status válidas e `closed` terminal.
 *
 * // Feature: suporte-inteligente, Property 2: isValidTransition(from,to) é
 * // verdadeiro sse to ∈ STATUS_TRANSITIONS[from]; closed é terminal.
 *
 * Alvo: src/services/admin/suporte/statusMachine.ts (isValidTransition).
 *
 * Validates: Requirements 3.1, 3.4, 3.5, 3.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isValidTransition,
  STATUS_TRANSITIONS,
  TICKET_STATUSES,
  type TicketStatus,
} from '../../../services/admin/suporte/statusMachine';

const statusArb = (): fc.Arbitrary<TicketStatus> => fc.constantFrom(...TICKET_STATUSES);

describe('CP2 — máquina de transições de status', () => {
  it('isValidTransition(from,to) ⇔ to ∈ STATUS_TRANSITIONS[from]', () => {
    fc.assert(
      fc.property(statusArb(), statusArb(), (from, to) => {
        const expected = STATUS_TRANSITIONS[from].includes(to);
        expect(isValidTransition(from, to)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('closed é terminal: nenhuma transição de saída é válida', () => {
    fc.assert(
      fc.property(statusArb(), (to) => {
        expect(isValidTransition('closed', to)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('from === to nunca é transição válida (idempotência tratada como _SKIPPED, não transição)', () => {
    fc.assert(
      fc.property(statusArb(), (s) => {
        expect(isValidTransition(s, s)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
