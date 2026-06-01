/**
 * Property-Based Tests — admin-marketing
 *
 * Feature: admin-marketing, Property 3: Ordenação total e estável do ranking de criativos
 *
 * CP-3 — `rankCreatives(items, metric, direction)` (src/services/admin/marketing.ts)
 * produz uma ORDEM TOTAL sobre Creative_Performance:
 *  1. Permutação: a saída é uma permutação da entrada (mesmo multiconjunto de
 *     creative_ids; nada some nem é duplicado).
 *  2. Monotonicidade + null-last: para cada par adjacente (a,b) do resultado, os
 *     valores não-nulos respeitam a direção (desc ⇒ va >= vb; asc ⇒ va <= vb);
 *     valores null (cpc/cpl com denominador zero) vão SEMPRE para o fim,
 *     independentemente da direção; empates (mesmo valor, ou ambos null)
 *     desempatam por creative_id ascendente (estável e determinístico).
 *  3. Idempotência: rank(rank(x)) == rank(x).
 *  4. Determinismo: duas chamadas com os mesmos argumentos produzem o mesmo
 *     resultado.
 *
 * Notas de geração:
 *  - Valores de métrica pequenos (fc.nat({ max: 5 })) e creative_id em espaço
 *    pequeno: força colisões de valor (testa o desempate estável) e colisões de
 *    id (não quebram a invariância — o invariante de par adjacente vale sempre).
 *  - clicks = min(clicks, impressions): computeMetrics (chamado internamente por
 *    rankCreatives para ctr/cpc/cpl) lança INVALID_METRICS se clicks > impressions.
 *
 * Validates: Requirements 6.2, 6.3, 6.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  rankCreatives,
  computeMetrics,
  type CreativePerformance,
  type RankMetric,
  type RankDirection,
} from '../../../services/admin/marketing';

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

/**
 * Gera um Creative_Performance com valores de métrica pequenos (favorece
 * colisões de valor) e clicks <= impressions (evita INVALID_METRICS em
 * computeMetrics, chamado internamente para métricas derivadas).
 */
const creativeGen: fc.Arbitrary<CreativePerformance> = fc
  .record({
    // Espaço pequeno de ids => provoca colisões para exercitar o desempate.
    creative_id: fc.string({ minLength: 1, maxLength: 3 }),
    name: fc.string(),
    spend: fc.nat({ max: 5 }),
    impressions: fc.nat({ max: 5 }),
    clicks: fc.nat({ max: 5 }),
    leads: fc.nat({ max: 5 }),
  })
  .map((c) => ({ ...c, clicks: Math.min(c.clicks, c.impressions) }));

const itemsGen = fc.array(creativeGen, { maxLength: 12 });

const metricGen = fc.constantFrom<RankMetric>(
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpl',
  'leads'
);

const directionGen = fc.constantFrom<RankDirection>('asc', 'desc');

// ---------------------------------------------------------------------------
// Espelho fiel de creativeMetricValue (interno de marketing.ts): extrai o valor
// de ordenação para a métrica, derivando ctr/cpc/cpl via computeMetrics
// (conversions irrelevante => 0). cpc/cpl podem ser null (denominador zero).
// ---------------------------------------------------------------------------
function metricValueOf(item: CreativePerformance, metric: RankMetric): number | null {
  switch (metric) {
    case 'spend':
      return item.spend;
    case 'impressions':
      return item.impressions;
    case 'clicks':
      return item.clicks;
    case 'leads':
      return item.leads;
    case 'ctr':
    case 'cpc':
    case 'cpl': {
      const d = computeMetrics({
        spend: item.spend,
        impressions: item.impressions,
        clicks: item.clicks,
        leads: item.leads,
        conversions: 0,
      });
      return metric === 'ctr' ? d.ctr : metric === 'cpc' ? d.cpc : d.cpl;
    }
  }
}

/** Lista ordenada dos creative_ids (para comparar multiconjuntos). */
function sortedIds(items: CreativePerformance[]): string[] {
  return items.map((i) => i.creative_id).sort();
}

describe('rankCreatives — Property 3: ordenação total e estável (CP-3)', () => {
  it('produz uma permutação da entrada (mesmo multiconjunto de creative_ids)', () => {
    fc.assert(
      fc.property(itemsGen, metricGen, directionGen, (items, metric, direction) => {
        const ranked = rankCreatives(items, metric, direction);
        // Mesmo tamanho: nada some nem é duplicado.
        expect(ranked).toHaveLength(items.length);
        // Mesmo multiconjunto de ids (permite duplicatas).
        expect(sortedIds(ranked)).toEqual(sortedIds(items));
      }),
      { numRuns: 100 }
    );
  });

  it('é monotônico pela métrica, com null por último e desempate estável por creative_id asc', () => {
    fc.assert(
      fc.property(itemsGen, metricGen, directionGen, (items, metric, direction) => {
        const ranked = rankCreatives(items, metric, direction);
        for (let i = 0; i + 1 < ranked.length; i++) {
          const a = ranked[i];
          const b = ranked[i + 1];
          const va = metricValueOf(a, metric);
          const vb = metricValueOf(b, metric);
          const aNull = va === null;
          const bNull = vb === null;

          if (aNull) {
            // null vai sempre por último: se a é null, b também tem que ser null.
            expect(bNull).toBe(true);
            // Ambos null => desempate estável por creative_id asc.
            expect(a.creative_id <= b.creative_id).toBe(true);
          } else if (bNull) {
            // a não-null antes de b null: posição correta (null-last). OK.
            expect(bNull).toBe(true);
          } else if (va === vb) {
            // Mesmo valor (inclui igualdade exata de derivadas) => creative_id asc.
            expect(a.creative_id <= b.creative_id).toBe(true);
          } else if (direction === 'desc') {
            // desc => maior valor primeiro; como não são iguais, va > vb.
            expect(va > vb).toBe(true);
          } else {
            // asc => menor valor primeiro; como não são iguais, va < vb.
            expect(va < vb).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('é idempotente: rank(rank(x)) == rank(x)', () => {
    fc.assert(
      fc.property(itemsGen, metricGen, directionGen, (items, metric, direction) => {
        const once = rankCreatives(items, metric, direction);
        const twice = rankCreatives(once, metric, direction);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 }
    );
  });

  it('é determinístico: mesmas entradas produzem o mesmo resultado', () => {
    fc.assert(
      fc.property(itemsGen, metricGen, directionGen, (items, metric, direction) => {
        const first = rankCreatives(items, metric, direction);
        const second = rankCreatives(items, metric, direction);
        expect(second).toEqual(first);
      }),
      { numRuns: 100 }
    );
  });
});
