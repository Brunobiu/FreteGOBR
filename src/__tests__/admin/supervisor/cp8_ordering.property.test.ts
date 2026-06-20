// Feature: admin-ia-supervisora, Property 8: Ordenação determinística.
//
// compareInsights/compareDiagnostics definem ordem total (antissimétrica,
// transitiva, estável); ordenar qualquer permutação do mesmo conjunto produz a
// mesma sequência.
//
// Validates: Requirements 10.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  compareInsights,
  compareDiagnostics,
  type InsightRow,
  type DiagnosticRow,
} from '../../../services/admin/supervisor/ordering';
import { insightRowGen, diagnosticRowGen } from './_generators';

function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}
function dedupeById<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('CP8 supervisor: ordenação determinística (insights e diagnósticos)', () => {
  it('compareInsights: ordem total + permutação invariante', () => {
    fc.assert(
      fc.property(fc.array(insightRowGen, { maxLength: 12 }), fc.integer(), (rawRows, seed) => {
        const rows = dedupeById(rawRows) as InsightRow[];
        // antissimetria (ids únicos => nunca 0 entre distintos)
        for (const a of rows)
          for (const b of rows)
            if (a.id !== b.id) expect(sign(compareInsights(a, b))).toBe(-sign(compareInsights(b, a)));
        // permutação invariante
        const s1 = [...rows].sort(compareInsights);
        const s2 = shuffle(rows, seed).sort(compareInsights);
        expect(s2.map((r) => r.id)).toEqual(s1.map((r) => r.id));
      }),
      { numRuns: 200 }
    );
  });

  it('compareInsights: transitividade', () => {
    fc.assert(
      fc.property(insightRowGen, insightRowGen, insightRowGen, (a, b, c) => {
        const ab = compareInsights(a, b);
        const bc = compareInsights(b, c);
        if (ab <= 0 && bc <= 0) expect(compareInsights(a, c)).toBeLessThanOrEqual(0);
        if (ab >= 0 && bc >= 0) expect(compareInsights(a, c)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });

  it('compareDiagnostics: ordem total + permutação invariante', () => {
    fc.assert(
      fc.property(fc.array(diagnosticRowGen, { maxLength: 12 }), fc.integer(), (rawRows, seed) => {
        const rows = dedupeById(rawRows) as DiagnosticRow[];
        for (const a of rows)
          for (const b of rows)
            if (a.id !== b.id)
              expect(sign(compareDiagnostics(a, b))).toBe(-sign(compareDiagnostics(b, a)));
        const s1 = [...rows].sort(compareDiagnostics);
        const s2 = shuffle(rows, seed).sort(compareDiagnostics);
        expect(s2.map((r) => r.id)).toEqual(s1.map((r) => r.id));
      }),
      { numRuns: 200 }
    );
  });
});
