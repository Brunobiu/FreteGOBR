// Feature: admin-central-operacao, Property 9: Ordenação determinística de alertas e logs.
//
// compareAlerts/compareLogs definem ordem total (antissimétrica, estável); ordenar
// qualquer permutação do mesmo conjunto produz a mesma sequência.
//
// Validates: Requirements 8.8, 10.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  compareAlerts,
  compareLogs,
  type AlertRow,
  type LogRow,
} from '../../../services/admin/operacao/ordering';
import { uuidLike } from '../../_helpers/generators';
import { severityGen } from './_generators';

const alertRowGen: fc.Arbitrary<AlertRow> = fc.record({
  id: uuidLike(),
  severity: severityGen,
  lastSeenAt: fc.constantFrom('2026-06-19T10:00:00Z', '2026-06-19T11:00:00Z', '2026-06-18T10:00:00Z'),
});
const logRowGen: fc.Arbitrary<LogRow> = fc.record({
  id: uuidLike(),
  occurredAt: fc.constantFrom('2026-06-19T10:00:00Z', '2026-06-19T11:00:00Z', '2026-06-18T10:00:00Z'),
  eventType: fc.constantFrom('LOGIN', 'PLAN_CHANGED', 'ERROR_OCCURRED', 'AI_REPLIED'),
});

function dedupeById<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

describe('CP-9 operações: ordenação total e determinística', () => {
  it('compareAlerts: antissimetria + invariância a permutação', () => {
    fc.assert(
      fc.property(
        fc.array(alertRowGen, { maxLength: 12 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 12 }),
        (raw, keys) => {
          const xs = dedupeById(raw);
          // antissimetria (ids unicos => compare(a,b)!=0 para a!=b; pula self p/ evitar -0)
          for (const a of xs)
            for (const b of xs) {
              if (a === b) continue;
              expect(sign(compareAlerts(a, b))).toBe(-sign(compareAlerts(b, a)));
            }
          const sorted = [...xs].sort(compareAlerts);
          // adjacentes em ordem
          for (let i = 1; i < sorted.length; i++)
            expect(compareAlerts(sorted[i - 1], sorted[i])).toBeLessThanOrEqual(0);
          // invariância a permutação
          const permuted = xs
            .map((x, i) => ({ x, k: keys[i] ?? i }))
            .sort((p, q) => p.k - q.k)
            .map((p) => p.x);
          expect([...permuted].sort(compareAlerts)).toEqual(sorted);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('compareLogs: antissimetria + invariância a permutação', () => {
    fc.assert(
      fc.property(
        fc.array(logRowGen, { maxLength: 12 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 12 }),
        (raw, keys) => {
          const xs = dedupeById(raw);
          for (const a of xs)
            for (const b of xs) {
              if (a === b) continue;
              expect(sign(compareLogs(a, b))).toBe(-sign(compareLogs(b, a)));
            }
          const sorted = [...xs].sort(compareLogs);
          const permuted = xs
            .map((x, i) => ({ x, k: keys[i] ?? i }))
            .sort((p, q) => p.k - q.k)
            .map((p) => p.x);
          expect([...permuted].sort(compareLogs)).toEqual(sorted);
        }
      ),
      { numRuns: 200 }
    );
  });
});
