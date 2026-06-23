// Feature: admin-rastreamento-inteligente, Property 10 (CP10): At_Risk_List —
// filtragem (subconjunto) + ordenação total.
//
// Para toda lista de entrada e todo Tracking_Filter, o resultado de
// filterAndSortAtRisk é um SUBCONJUNTO da entrada, TODA linha retornada
// satisfaz TODOS os filtros ativos, a ordenação é total e determinística
// (risk_score DESC, desempate user_id ASC), e uma faixa de Risk_Score com
// mínimo maior que o máximo produz conjunto vazio (sem erro).
//
// Validates: Requirements 7.3, 7.5, 13.3, 13.9

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { filterAndSortAtRisk } from '../../../services/admin/rastreamento/atRiskList';
import { atRiskRowArb, trackingFilterArb } from './_generators';

describe('CP10 — At_Risk_List filtragem + ordenação total', () => {
  it('resultado é subconjunto da entrada, satisfaz filtros e é totalmente ordenado', () => {
    fc.assert(
      fc.property(
        fc.array(atRiskRowArb(), { minLength: 0, maxLength: 30 }),
        trackingFilterArb(),
        (rows, filter) => {
          const result = filterAndSortAtRisk(rows, filter);

          // (a) subconjunto: toda linha retornada está na entrada (por referência).
          for (const row of result) {
            expect(rows.includes(row)).toBe(true);
          }

          // (b) cada linha satisfaz TODOS os filtros ativos (verificação independente).
          const impossibleRange =
            filter.min_score !== undefined &&
            filter.max_score !== undefined &&
            filter.min_score > filter.max_score;

          if (impossibleRange) {
            // (d) faixa impossível ⇒ vazio, sem erro.
            expect(result).toEqual([]);
          } else {
            for (const row of result) {
              if (filter.risk_category !== undefined) {
                expect(row.risk_category).toBe(filter.risk_category);
              }
              if (filter.problem_type !== undefined) {
                expect(row.abandonment_cause).toBe(filter.problem_type);
              }
              if (filter.profile !== undefined) {
                expect(row.profile).toBe(filter.profile);
              }
              if (filter.min_score !== undefined) {
                expect(row.risk_score).toBeGreaterThanOrEqual(filter.min_score);
              }
              if (filter.max_score !== undefined) {
                expect(row.risk_score).toBeLessThanOrEqual(filter.max_score);
              }
              if (filter.from !== undefined) {
                expect(row.last_activity_at).toBeGreaterThanOrEqual(filter.from);
              }
              if (filter.to !== undefined) {
                expect(row.last_activity_at).toBeLessThanOrEqual(filter.to);
              }
            }
          }

          // (c) ordenação total: risk_score DESC, desempate user_id ASC.
          for (let i = 1; i < result.length; i += 1) {
            const prev = result[i - 1];
            const cur = result[i];
            expect(prev.risk_score).toBeGreaterThanOrEqual(cur.risk_score);
            if (prev.risk_score === cur.risk_score) {
              expect(prev.user_id <= cur.user_id).toBe(true);
            }
          }

          // (e) determinismo / idempotência da ordenação.
          expect(filterAndSortAtRisk(rows, filter)).toEqual(result);
        }
      ),
      { numRuns: 200 }
    );
  });
});
