// Feature: admin-assistant, Property 20
/**
 * CP-20: Sinais diretos disparam o Critical_Event_Type correspondente
 *
 * Para os sinais diretos (sem threshold de contagem configuravel):
 *   - unauthorizedAccessCount > 0 ⇒ unauthorized_access_attempt
 *   - paymentFailureCount > 0     ⇒ payment_failure
 *   - dbPerformanceDrop === true  ⇒ db_performance_drop
 * Cada relacao e bicondicional: a ausencia do sinal nao gera o evento
 * (Req 11.1, 11.5, 11.6).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 11.1, 11.5, 11.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  classifyEvents,
  type ThresholdConfig,
  type ClassifierSignals,
} from '../../../services/admin/assistantClassifier';

// ----- Geradores (estrategia de testes do design.md) -----

const thresholdGen = fc.integer({ min: 1, max: 1000 });

const thresholdsGen: fc.Arbitrary<ThresholdConfig> = fc.record({
  page_error_rate: thresholdGen,
  request_failure_rate: thresholdGen,
  failed_login_burst: thresholdGen,
});

// Contagem cobrindo o ramo ausente (0) e presente (> 0).
const directCountGen = fc.integer({ min: 0, max: 500 });

// Base de sinais sem nenhum outro disparo: isola o sinal sob teste.
function neutralSignals(): ClassifierSignals {
  return {
    pageErrorCount: 0,
    requestFailureCount: 0,
    failedLoginsByIp: {},
    unauthorizedAccessCount: 0,
    paymentFailureCount: 0,
    dbPerformanceDrop: false,
    newSignups: 0,
    postedFretes: 0,
  };
}

describe('CP-20: Sinais diretos disparam o tipo correspondente', () => {
  it('unauthorizedAccessCount > 0 sse unauthorized_access_attempt', () => {
    fc.assert(
      fc.property(directCountGen, thresholdsGen, (count, thresholds) => {
        const signals = { ...neutralSignals(), unauthorizedAccessCount: count };
        const events = classifyEvents(signals, thresholds);
        const included = events.some((e) => e.type === 'unauthorized_access_attempt');
        expect(included).toBe(count > 0);
      }),
      { numRuns: 100 }
    );
  });

  it('paymentFailureCount > 0 sse payment_failure', () => {
    fc.assert(
      fc.property(directCountGen, thresholdsGen, (count, thresholds) => {
        const signals = { ...neutralSignals(), paymentFailureCount: count };
        const events = classifyEvents(signals, thresholds);
        const included = events.some((e) => e.type === 'payment_failure');
        expect(included).toBe(count > 0);
      }),
      { numRuns: 100 }
    );
  });

  it('dbPerformanceDrop === true sse db_performance_drop', () => {
    fc.assert(
      fc.property(fc.boolean(), thresholdsGen, (flag, thresholds) => {
        const signals = { ...neutralSignals(), dbPerformanceDrop: flag };
        const events = classifyEvents(signals, thresholds);
        const included = events.some((e) => e.type === 'db_performance_drop');
        expect(included).toBe(flag);
      }),
      { numRuns: 100 }
    );
  });
});
