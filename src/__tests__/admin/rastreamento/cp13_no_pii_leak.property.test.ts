// Feature: admin-rastreamento-inteligente, Property 13 (transversal — privacidade):
// nenhuma saída vaza PII bruta ou segredo.
//
// Para todo Journey_Summary / Recovery_Decision / contexto mínimo de IA / linha
// de log estruturado, a serialização da saída nunca contém PII bruta (CPF,
// e-mail, telefone), senha, token, chave de IA ou stack trace (verificado por
// expectNoSecrets / expectStructuredLog).
//
// Validates: Requirements 3.6, 3.7, 4.6, 10.4, 12.3, 15.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { buildJourneySummary } from '../../../services/admin/rastreamento/journeySummary';
import { decideRecovery } from '../../../services/admin/rastreamento/recoveryRuleEngine';
import {
  buildMinimalAiContext,
  buildSuppressionLog,
  buildDispatchFailureLog,
  type MinimalAiContext,
} from '../../../services/admin/rastreamento/recoveryContext';
import { SUPPRESSION_REASONS, FUNNEL_ORDER, RISK_BANDS, ABANDONMENT_CAUSES, RECOVERY_SCENARIOS } from '../../../services/admin/rastreamento/domain';
import { expectNoSecrets, expectStructuredLog } from '../../_helpers/logAssertions';
import {
  journeyEventsArb,
  recoveryTriggerArb,
  recoveryHistoryArb,
  antiSpamConfigArb,
  NOW_MS,
} from './_generators';

describe('CP13 — privacidade: sem vazamento de PII/segredo', () => {
  it('Journey_Summary serializado não vaza segredos', () => {
    fc.assert(
      fc.property(journeyEventsArb(), (events) => {
        const summary = buildJourneySummary(events, NOW_MS);
        expectNoSecrets(summary);
      }),
      { numRuns: 200 }
    );
  });

  it('Recovery_Decision serializado não vaza segredos', () => {
    fc.assert(
      fc.property(
        recoveryTriggerArb(),
        recoveryHistoryArb(),
        antiSpamConfigArb(),
        (trigger, history, cfg) => {
          const decision = decideRecovery(trigger, history, cfg);
          expectNoSecrets(decision);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('contexto mínimo de IA não contém PII (só enums + template) e não vaza segredos', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECOVERY_SCENARIOS),
        fc.constantFrom(...FUNNEL_ORDER),
        fc.constantFrom(...RISK_BANDS),
        fc.constantFrom(...ABANDONMENT_CAUSES),
        (scenario, current_stage, risk_band, abandonment_cause) => {
          const ctx: MinimalAiContext = buildMinimalAiContext({
            scenario,
            current_stage,
            risk_band,
            abandonment_cause,
          });
          expectNoSecrets(ctx);
          // Garantia estrutural: o contexto não tem campos de PII.
          expect(Object.keys(ctx).sort()).toEqual(
            ['abandonment_cause', 'current_stage', 'risk_band', 'scenario', 'template'].sort()
          );
          expect(ctx).not.toHaveProperty('user_id');
          expect(ctx).not.toHaveProperty('name');
          expect(ctx).not.toHaveProperty('phone');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('logs estruturados de supressão e de falha têm level/ts e não vazam segredos', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SUPPRESSION_REASONS), fc.constantFrom(...RECOVERY_SCENARIOS), (reason, scenario) => {
        expectStructuredLog(buildSuppressionLog(reason, NOW_MS));
        expectStructuredLog(buildDispatchFailureLog(scenario, NOW_MS));
      }),
      { numRuns: 200 }
    );
  });
});
