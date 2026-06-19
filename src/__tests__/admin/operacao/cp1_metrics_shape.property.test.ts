// Feature: admin-central-operacao, Property 1: Determinismo das métricas operacionais.
//
// adaptOperationsBundle é determinístico; KPI sem fonte => {value:null, available:false}
// (nunca {value:0, available:true}); grupo em `errors` força todos os seus KPIs a
// indisponíveis.
//
// Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.4, 15.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  adaptOperationsBundle,
  KPI_GROUP,
  OPERATIONS_KPI_KEYS,
  type OperationsGroupKey,
  type RawKpi,
} from '../../../services/admin/operacao/metricsShape';
import { kpiKeyGen, rawKpiGen, groupGen } from './_generators';

describe('CP-1 operações: determinismo e disponibilidade das métricas', () => {
  it('mesmo bundle cru => mesmo bundle; sem fonte => indisponível (nunca 0)', () => {
    const scenario = fc.record({
      kpis: fc.dictionary(kpiKeyGen, rawKpiGen),
      errors: fc
        .uniqueArray(groupGen, { maxLength: 4 })
        .map((gs) => Object.fromEntries(gs.map((g) => [g, 'Bloco indisponível.']))),
    });

    fc.assert(
      fc.property(scenario, (raw) => {
        const bundle = adaptOperationsBundle(
          raw as {
            kpis: Partial<Record<(typeof OPERATIONS_KPI_KEYS)[number], RawKpi>>;
            errors: Partial<Record<OperationsGroupKey, string>>;
          }
        );

        // todos os 11 KPIs presentes
        expect(Object.keys(bundle.kpis).sort()).toEqual([...OPERATIONS_KPI_KEYS].sort());

        for (const key of OPERATIONS_KPI_KEYS) {
          const kpi = bundle.kpis[key];
          const group = KPI_GROUP[key];
          // indisponível NUNCA carrega valor
          if (!kpi.available) expect(kpi.value).toBeNull();
          if (group in bundle.errors) {
            expect(kpi).toEqual({ value: null, available: false });
          } else {
            const src = (raw.kpis as Record<string, RawKpi | undefined>)[key];
            if (!src || src.available !== true) {
              expect(kpi).toEqual({ value: null, available: false });
            } else {
              expect(kpi.available).toBe(true);
            }
          }
        }

        // determinismo
        expect(
          adaptOperationsBundle(
            raw as {
              kpis: Partial<Record<(typeof OPERATIONS_KPI_KEYS)[number], RawKpi>>;
              errors: Partial<Record<OperationsGroupKey, string>>;
            }
          )
        ).toEqual(bundle);
      }),
      { numRuns: 200 }
    );
  });
});
