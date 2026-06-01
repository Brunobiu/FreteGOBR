// Feature: admin-assistant, Property 7
/**
 * CP-7: Highlights ordenados cronologicamente decrescente
 *
 * Para toda lista de Highlight, sortHighlights produz uma PERMUTACAO da
 * entrada ordenada de forma NAO-CRESCENTE por timestamp (cada item tem
 * timestamp maior ou igual ao seguinte).
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 4.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { sortHighlights, type Highlight, type Severity } from '../../../services/admin/assistant';

// ----- Geradores -----

const severityGen = fc.constantFrom<Severity>('info', 'warning', 'critical');

// Timestamps ISO variados a partir de epoch ms num intervalo amplo,
// permitindo empates (mesmo instante) para exercitar a estabilidade.
const isoTimestampGen = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970..2100
  .map((ms) => new Date(ms).toISOString());

const highlightGen: fc.Arbitrary<Highlight> = fc.record({
  id: fc.uuid(),
  category: fc.string({ minLength: 1, maxLength: 20 }),
  summary: fc.string({ minLength: 1, maxLength: 40 }),
  severity: severityGen,
  timestamp: isoTimestampGen,
  conversationId: fc.option(fc.uuid(), { nil: null }),
});

const highlightListGen = fc.array(highlightGen, { minLength: 0, maxLength: 40 });

// Chave de ordenacao identica a do helper (epoch ms; invalidos para -inf).
function tsKey(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

// Multiset estavel por id para comparar permutacao independentemente da ordem.
function idMultiset(list: Highlight[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of list) {
    counts[h.id] = (counts[h.id] ?? 0) + 1;
  }
  return counts;
}

describe('CP-7: Highlights ordenados cronologicamente decrescente', () => {
  it('produz permutacao nao-crescente por timestamp', () => {
    fc.assert(
      fc.property(highlightListGen, (list) => {
        const sorted = sortHighlights(list);

        // Mesmo tamanho.
        expect(sorted.length).toBe(list.length);

        // Mesma multiset (permutacao da entrada).
        expect(idMultiset(sorted)).toEqual(idMultiset(list));

        // Ordem nao-crescente por timestamp.
        for (let i = 0; i + 1 < sorted.length; i++) {
          expect(tsKey(sorted[i].timestamp)).toBeGreaterThanOrEqual(tsKey(sorted[i + 1].timestamp));
        }
      }),
      { numRuns: 100 }
    );
  });
});
