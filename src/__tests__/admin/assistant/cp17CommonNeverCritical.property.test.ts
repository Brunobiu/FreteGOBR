// Feature: admin-assistant, Property 17
/**
 * CP-17: Eventos comuns nunca disparam Critical_Event
 *
 * Com todos os sinais criticos ausentes (contagens abaixo do threshold,
 * flag de banco falsa, failedLoginsByIp vazio, unauthorized/payment = 0),
 * QUALQUER valor de newSignups/postedFretes produz uma lista vazia. Novos
 * cadastros e fretes postados sao Common_Event e jamais sao classificados
 * como criticos (Req 9.3).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 9.3
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

describe('CP-17: Eventos comuns (newSignups/postedFretes) nunca disparam', () => {
  it('sem sinais criticos, qualquer newSignups/postedFretes produz lista vazia', () => {
    fc.assert(
      fc.property(
        thresholdsGen,
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (thresholds, newSignups, postedFretes) => {
          // Sinais criticos deliberadamente ausentes: contagens estritamente
          // abaixo do threshold (threshold >= 1, logo 0 < threshold), flag
          // falsa, mapa de logins vazio, unauthorized/payment zerados.
          const signals: ClassifierSignals = {
            pageErrorCount: 0,
            requestFailureCount: 0,
            failedLoginsByIp: {},
            unauthorizedAccessCount: 0,
            paymentFailureCount: 0,
            dbPerformanceDrop: false,
            newSignups,
            postedFretes,
          };

          const events = classifyEvents(signals, thresholds);
          expect(events).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
