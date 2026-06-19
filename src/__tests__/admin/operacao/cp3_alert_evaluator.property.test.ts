// Feature: admin-central-operacao, Property 3: Determinismo do Alert_Evaluator.
//
// Para o mesmo snapshot, evaluate produz sempre o mesmo conjunto de
// (Alert_Type, Alert_Source), com severity === ALERT_SEVERITY_MAP[type]; fonte
// ausente (undefined) => zero alertas daquele tipo (omissão sem fabricação).
//
// Validates: Requirements 6.4, 7.1, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluate, ALERT_SEVERITY_MAP } from '../../../services/admin/operacao/alertEvaluator';
import { evaluatorInputGen } from './_generators';

describe('CP-3 operações: determinismo do Alert_Evaluator', () => {
  it('determinístico; severidade fixa; fonte ausente => sem alertas do tipo', () => {
    fc.assert(
      fc.property(evaluatorInputGen, (input) => {
        const out = evaluate(input);
        // determinismo
        expect(evaluate(input)).toEqual(out);
        // severidade pelo mapa
        for (const s of out) expect(s.severity).toBe(ALERT_SEVERITY_MAP[s.alertType]);
        // fonte ausente => zero alertas daquele tipo
        if (input.whatsappSessions === undefined)
          expect(out.some((s) => s.alertType === 'WHATSAPP_DISCONNECTED')).toBe(false);
        if (input.dispatchJobs === undefined)
          expect(out.some((s) => s.alertType === 'CAMPAIGN_PAUSED' || s.alertType === 'CAMPAIGN_ERROR')).toBe(false);
        if (input.integrations === undefined)
          expect(out.some((s) => s.alertType === 'INTEGRATION_FAILURE')).toBe(false);
        if (input.subscriptions === undefined)
          expect(out.some((s) => s.alertType === 'SUBSCRIPTION_EXPIRING')).toBe(false);
        if (input.awaitingTickets === undefined)
          expect(out.some((s) => s.alertType === 'CUSTOMER_AWAITING')).toBe(false);
        // ordenado por dedupKey (estável, localeCompare — igual ao evaluate)
        const keys = out.map((s) => `${s.alertType}:${s.source.sourceType}:${s.source.sourceId}`);
        expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
      }),
      { numRuns: 200 }
    );
  });
});
