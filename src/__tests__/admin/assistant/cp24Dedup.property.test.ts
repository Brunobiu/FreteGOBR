// Feature: admin-assistant, Property 24
/**
 * CP-24: Deduplicacao de eventos ja notificados e idempotente
 *
 * Para todo conjunto de dedupKeys ja notificadas (`already`) e todo lote de
 * DedupCandidate, dedupNewEvents(already, batch):
 *   - nunca retorna um candidato cuja dedupKey ja esteja em `already`;
 *   - nunca retorna dedupKeys duplicadas dentro do resultado;
 *   - e idempotente: dedupNewEvents(already, dedupNewEvents(already, batch))
 *     e profundamente igual a dedupNewEvents(already, batch).
 *
 * dedupKeys vem de um pool pequeno (fc.constantFrom) para que colisoes com
 * `already` e dentro do lote ocorram de fato.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 12.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  dedupNewEvents,
  type DedupCandidate,
  type DetectedEvent,
  type CriticalEventType,
  type Severity,
} from '../../../services/admin/assistant';

// ----- Geradores -----

const eventTypeGen = fc.constantFrom<CriticalEventType>(
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop'
);

const severityGen = fc.constantFrom<Severity>('info', 'warning', 'critical');

const detectedEventGen: fc.Arbitrary<DetectedEvent> = fc.record({
  type: eventTypeGen,
  severity: severityGen,
  summary: fc.string({ minLength: 0, maxLength: 30 }),
  scope: fc.string({ minLength: 0, maxLength: 20 }),
});

// Pool pequeno de dedupKeys: garante colisoes reais com `already` e no lote.
const dedupKeyGen = fc.constantFrom('k1', 'k2', 'k3', 'k4', 'k5');

const candidateGen: fc.Arbitrary<DedupCandidate> = fc.record({
  event: detectedEventGen,
  dedupKey: dedupKeyGen,
});

const batchGen = fc.array(candidateGen, { minLength: 0, maxLength: 20 });

// `already` tambem do mesmo pool, para colidir com o lote.
const alreadyGen = fc
  .array(dedupKeyGen, { minLength: 0, maxLength: 5 })
  .map((keys) => new Set<string>(keys));

describe('CP-24: Deduplicacao idempotente de eventos ja notificados', () => {
  it('nunca retorna dedupKey ja em `already` nem duplicatas no resultado', () => {
    fc.assert(
      fc.property(alreadyGen, batchGen, (already, batch) => {
        const result = dedupNewEvents(already, batch);

        // Nenhuma dedupKey do resultado esta em `already`.
        for (const item of result) {
          expect(already.has(item.dedupKey)).toBe(false);
        }

        // Sem dedupKeys duplicadas dentro do resultado.
        const keys = result.map((r) => r.dedupKey);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 100 }
    );
  });

  it('e idempotente: dedup(dedup(x)) deep-equals dedup(x)', () => {
    fc.assert(
      fc.property(alreadyGen, batchGen, (already, batch) => {
        const once = dedupNewEvents(already, batch);
        const twice = dedupNewEvents(already, once);

        expect(twice).toEqual(once);
      }),
      { numRuns: 100 }
    );
  });
});
