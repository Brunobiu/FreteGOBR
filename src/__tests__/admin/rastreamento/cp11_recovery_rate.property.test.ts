// Feature: admin-rastreamento-inteligente, Property 11 (CP11): Recovery_Rate —
// limites + progressão monotônica de Contact_Status.
//
// Para todo conjunto de contadores, computeRecoveryRate = CONVERTED / CONTACTED
// está em [0,1] (e vale 0 quando CONTACTED = 0); e para todo par (from, to),
// canTransitionContactStatus só admite avanço na ordem
// AT_RISK → CONTACTED → REPLIED → CONVERTED, nunca retrocesso.
//
// Validates: Requirements 11.2, 11.3, 11.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { CONTACT_STATUSES } from '../../../services/admin/rastreamento/domain';
import {
  computeRecoveryRate,
  canTransitionContactStatus,
  contactStatusIndex,
} from '../../../services/admin/rastreamento/recoveryPerformance';

describe('CP11 — Recovery_Rate limites + progressão de Contact_Status', () => {
  it('Recovery_Rate em [0,1] e 0 quando CONTACTED = 0', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100000 }),
        fc.nat({ max: 100000 }),
        fc.nat({ max: 100000 }),
        fc.nat({ max: 100000 }),
        (atRisk, contacted, replied, converted) => {
          const rate = computeRecoveryRate({
            AT_RISK: atRisk,
            CONTACTED: contacted,
            REPLIED: replied,
            CONVERTED: converted,
          });
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(1);
          if (contacted === 0) expect(rate).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('CONVERTED ≤ CONTACTED ⇒ taxa = CONVERTED/CONTACTED', () => {
    expect(computeRecoveryRate({ AT_RISK: 10, CONTACTED: 4, REPLIED: 3, CONVERTED: 1 })).toBeCloseTo(
      0.25,
      10
    );
  });

  it('Contact_Status só avança na ordem, nunca retrocede nem permanece', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONTACT_STATUSES),
        fc.constantFrom(...CONTACT_STATUSES),
        (from, to) => {
          const allowed = canTransitionContactStatus(from, to);
          if (contactStatusIndex(to) > contactStatusIndex(from)) {
            expect(allowed).toBe(true);
          } else {
            expect(allowed).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
