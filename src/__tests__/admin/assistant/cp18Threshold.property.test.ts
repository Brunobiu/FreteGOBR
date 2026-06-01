// Feature: admin-assistant, Property 18
/**
 * CP-18: Bicondicional por Critical_Threshold
 *
 * Para os tipos baseados em contagem (page_error_rate e
 * request_failure_rate), o evento daquele tipo e incluido SE E SOMENTE SE a
 * contagem observada >= threshold. Testa os dois ramos (>= dispara,
 * < nao dispara), com gerador de contagem cobrindo abaixo, igual e acima
 * do limite (Req 10.2/10.3).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 10.2, 10.3
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

// Contagem que cobre deliberadamente os dois ramos: bem abaixo, exatamente
// no limite e acima dele.
const countGen = fc.integer({ min: 0, max: 1200 });

const thresholdsGen: fc.Arbitrary<ThresholdConfig> = fc.record({
  page_error_rate: thresholdGen,
  request_failure_rate: thresholdGen,
  failed_login_burst: thresholdGen,
});

// Base de sinais sem nenhum outro disparo: isola o tipo sob teste.
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

describe('CP-18: Bicondicional por Critical_Threshold', () => {
  it('page_error_rate incluido sse pageErrorCount >= threshold', () => {
    fc.assert(
      fc.property(countGen, thresholdsGen, (count, thresholds) => {
        const signals = { ...neutralSignals(), pageErrorCount: count };
        const events = classifyEvents(signals, thresholds);
        const included = events.some((e) => e.type === 'page_error_rate');
        expect(included).toBe(count >= thresholds.page_error_rate);
      }),
      { numRuns: 100 }
    );
  });

  it('request_failure_rate incluido sse requestFailureCount >= threshold', () => {
    fc.assert(
      fc.property(countGen, thresholdsGen, (count, thresholds) => {
        const signals = { ...neutralSignals(), requestFailureCount: count };
        const events = classifyEvents(signals, thresholds);
        const included = events.some((e) => e.type === 'request_failure_rate');
        expect(included).toBe(count >= thresholds.request_failure_rate);
      }),
      { numRuns: 100 }
    );
  });
});
