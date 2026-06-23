// Feature: admin-rastreamento-inteligente, Property 8 (CP8): Recovery_Rule_Engine
// — determinismo + domínio fechado.
//
// Para todo gatilho, histórico de Recovery_Attempt e estado de anti-spam,
// decideRecovery produz um Recovery_Decision determinístico (mesma entrada ⇒
// mesma decisão) que usa exclusivamente Recovery_Scenario (em DISPATCH) e
// Suppression_Reason (em SUPPRESS) dos domínios fechados.
//
// Validates: Requirements 9.1, 9.2, 9.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { RECOVERY_SCENARIOS, SUPPRESSION_REASONS } from '../../../services/admin/rastreamento/domain';
import { decideRecovery } from '../../../services/admin/rastreamento/recoveryRuleEngine';
import { recoveryTriggerArb, recoveryHistoryArb, antiSpamConfigArb } from './_generators';

describe('CP8 — Recovery_Rule_Engine determinismo + domínio fechado', () => {
  it('decisão determinística e dentro dos domínios fechados', () => {
    fc.assert(
      fc.property(
        recoveryTriggerArb(),
        recoveryHistoryArb(),
        antiSpamConfigArb(),
        (trigger, history, cfg) => {
          const decision = decideRecovery(trigger, history, cfg);

          if (decision.kind === 'DISPATCH') {
            expect(RECOVERY_SCENARIOS).toContain(decision.scenario);
            expect(decision.template_key).toBe(decision.scenario);
          } else {
            expect(SUPPRESSION_REASONS).toContain(decision.reason);
          }

          // Determinismo: reexecutar com cópias produz exatamente a mesma decisão.
          const again = decideRecovery({ ...trigger }, [...history], { ...cfg });
          expect(again).toEqual(decision);
        }
      ),
      { numRuns: 200 }
    );
  });
});
