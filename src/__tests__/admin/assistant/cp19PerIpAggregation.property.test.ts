// Feature: admin-assistant, Property 19
/**
 * CP-19: failed_login_burst avaliado por IP (sem somar entre IPs)
 *
 * O classificador gera exatamente um evento failed_login_burst com
 * `scope = ip:<addr>` para cada IP cuja contagem INDIVIDUAL >= threshold;
 * IPs distintos nao sao somados. Em particular, quando TODAS as contagens
 * individuais ficam abaixo do threshold, nenhum evento e gerado, mesmo que
 * a soma das contagens entre IPs exceda o threshold (Req 11.2/11.3/11.4).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 11.2, 11.3, 11.4
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

// Base de sinais que isola failed_login_burst (nenhum outro disparo).
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

describe('CP-19: failed_login_burst avaliado por IP', () => {
  it('gera failed_login_burst (scope ip:<addr>) exatamente para IPs com contagem individual >= threshold', () => {
    fc.assert(
      fc.property(failedLoginsByIpGen, thresholdsGen, (failedLoginsByIp, thresholds) => {
        const signals = { ...neutralSignals(), failedLoginsByIp };
        const events = classifyEvents(signals, thresholds);

        const burstEvents = events.filter((e) => e.type === 'failed_login_burst');

        // Conjunto esperado de scopes a partir das contagens individuais.
        const expectedScopes = Object.entries(failedLoginsByIp)
          .filter(([, count]) => count >= thresholds.failed_login_burst)
          .map(([ip]) => `ip:${ip}`)
          .sort();

        const actualScopes = burstEvents.map((e) => e.scope).sort();
        expect(actualScopes).toEqual(expectedScopes);
      }),
      { numRuns: 100 }
    );
  });

  it('quando todas as contagens individuais < threshold, nenhum evento mesmo que a soma exceda', () => {
    fc.assert(
      fc.property(
        // threshold relativamente alto para deixar espaco a contagens individuais menores.
        fc.integer({ min: 5, max: 50 }),
        (threshold) => {
          // Distribui valores estritamente abaixo do threshold por varios IPs,
          // de modo que a SOMA ultrapasse o threshold.
          const per = threshold - 1; // < threshold individualmente
          const failedLoginsByIp: Record<string, number> = {
            '1.2.3.4': per,
            '10.0.0.1': per,
            '192.168.0.2': per,
            '203.0.113.7': per,
            '172.16.5.9': per,
          };
          // Sanidade: a soma de fato excede o threshold.
          const sum = Object.values(failedLoginsByIp).reduce((a, b) => a + b, 0);
          expect(sum).toBeGreaterThanOrEqual(threshold);

          const thresholds: ThresholdConfig = {
            page_error_rate: 1000,
            request_failure_rate: 1000,
            failed_login_burst: threshold,
          };
          const signals = { ...neutralSignals(), failedLoginsByIp };
          const events = classifyEvents(signals, thresholds);
          const burstEvents = events.filter((e) => e.type === 'failed_login_burst');
          expect(burstEvents).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
