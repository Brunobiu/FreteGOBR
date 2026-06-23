// Feature: admin-rastreamento-inteligente, Property 7 (CP7): Funnel_Metrics —
// limites + complemento + determinismo.
//
// Para todo conjunto de contagens por etapa, toda taxa de Funnel_Metrics está
// em [0,1]; Stage_Conversion_Rate(etapa) + Stage_Abandonment_Rate(etapa) = 1
// sempre que o denominador é > 0 (e conversão = 0 quando denom = 0); e o cálculo
// é determinístico.
//
// Validates: Requirements 8.4, 8.5, 8.6, 8.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { FUNNEL_ORDER } from '../../../services/admin/rastreamento/domain';
import { computeFunnelMetrics } from '../../../services/admin/rastreamento/funnelMetrics';
import { stageCountsArb } from './_generators';

const inUnit = (v: number) => v >= 0 && v <= 1;

describe('CP7 — Funnel_Metrics limites + complemento + determinismo', () => {
  it('todas as taxas em [0,1]; complemento em transições com denom > 0; determinístico', () => {
    fc.assert(
      fc.property(stageCountsArb(), (counts) => {
        const m = computeFunnelMetrics(counts);

        // (a) escalares em [0,1]
        expect(inUnit(m.overall_conversion_rate)).toBe(true);
        expect(inUnit(m.retention_rate)).toBe(true);
        expect(inUnit(m.churn_rate)).toBe(true);
        expect(inUnit(m.activation_rate)).toBe(true);

        // (b) taxas por etapa em [0,1] + complemento
        for (let i = 0; i < FUNNEL_ORDER.length; i += 1) {
          const stage = FUNNEL_ORDER[i];
          const conv = m.stage_conversion_rate[stage];
          const aband = m.stage_abandonment_rate[stage];
          expect(inUnit(conv)).toBe(true);
          expect(inUnit(aband)).toBe(true);

          const isTerminal = i + 1 >= FUNNEL_ORDER.length;
          if (!isTerminal) {
            if (counts[stage] > 0) {
              // conversão + abandono = 1
              expect(conv + aband).toBeCloseTo(1, 10);
            } else {
              // denom 0 ⇒ conversão 0
              expect(conv).toBe(0);
            }
          }
        }

        // (c) determinismo
        expect(computeFunnelMetrics({ ...counts })).toEqual(m);
      }),
      { numRuns: 200 }
    );
  });
});
