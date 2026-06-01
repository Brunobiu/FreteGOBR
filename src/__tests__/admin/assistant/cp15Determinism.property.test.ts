// Feature: admin-assistant, Property 15
/**
 * CP-15: Determinismo do Event_Classifier
 *
 * Para toda entrada valida (signals + thresholds), duas invocacoes
 * consecutivas de classifyEvents produzem resultados IGUAIS (deep equal).
 * Garante que a classificacao e pura e deterministica: nao depende de
 * relogio, aleatoriedade nem estado externo, e nao muta a entrada (Req 9.1).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 9.1
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

const ipGen = fc.constantFrom('1.2.3.4', '10.0.0.1', '192.168.0.2', '203.0.113.7', '172.16.5.9');

const failedLoginsByIpGen = fc.dictionary(ipGen, fc.integer({ min: 0, max: 50 }));

const thresholdsGen: fc.Arbitrary<ThresholdConfig> = fc.record({
  page_error_rate: thresholdGen,
  request_failure_rate: thresholdGen,
  failed_login_burst: thresholdGen,
});

const signalsGen: fc.Arbitrary<ClassifierSignals> = fc.record({
  pageErrorCount: fc.integer({ min: 0, max: 2000 }),
  requestFailureCount: fc.integer({ min: 0, max: 2000 }),
  failedLoginsByIp: failedLoginsByIpGen,
  unauthorizedAccessCount: fc.integer({ min: 0, max: 500 }),
  paymentFailureCount: fc.integer({ min: 0, max: 500 }),
  dbPerformanceDrop: fc.boolean(),
  newSignups: fc.integer({ min: 0, max: 5000 }),
  postedFretes: fc.integer({ min: 0, max: 5000 }),
});

describe('CP-15: Determinismo do Event_Classifier', () => {
  it('duas invocacoes consecutivas com a mesma entrada produzem resultados iguais', () => {
    fc.assert(
      fc.property(signalsGen, thresholdsGen, (signals, thresholds) => {
        const first = classifyEvents(signals, thresholds);
        const second = classifyEvents(signals, thresholds);
        expect(second).toEqual(first);
      }),
      { numRuns: 100 }
    );
  });
});
