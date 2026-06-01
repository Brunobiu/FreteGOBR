// Feature: admin-assistant, Property 16
/**
 * CP-16: Saida do Event_Classifier tipada e completa
 *
 * Para toda entrada valida, todo DetectedEvent retornado por classifyEvents
 * tem `type` dentro do dominio fechado CriticalEventType e os campos
 * `type`, `severity` e `summary` nao vazios (Req 9.2, 9.6).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 9.2, 9.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  classifyEvents,
  type ThresholdConfig,
  type ClassifierSignals,
} from '../../../services/admin/assistantClassifier';

// Dominio fechado de CriticalEventType (oraculo independente).
const CRITICAL_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop',
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set<string>(['info', 'warning', 'critical']);

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

describe('CP-16: Saida do Event_Classifier tipada e completa', () => {
  it('todo DetectedEvent tem type no dominio e type/severity/summary nao vazios', () => {
    fc.assert(
      fc.property(signalsGen, thresholdsGen, (signals, thresholds) => {
        const events = classifyEvents(signals, thresholds);
        for (const ev of events) {
          // type pertence ao dominio fechado.
          expect(CRITICAL_EVENT_TYPES.has(ev.type)).toBe(true);
          // severity pertence ao dominio fechado e nao e vazia.
          expect(VALID_SEVERITIES.has(ev.severity)).toBe(true);
          // campos nao vazios.
          expect(typeof ev.type).toBe('string');
          expect(ev.type.length).toBeGreaterThan(0);
          expect(typeof ev.severity).toBe('string');
          expect(ev.severity.length).toBeGreaterThan(0);
          expect(typeof ev.summary).toBe('string');
          expect(ev.summary.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});
