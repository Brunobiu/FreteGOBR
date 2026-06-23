// Feature: admin-rastreamento-inteligente, Property 6 (CP6): Conversion_Funnel —
// monotonicidade do funil.
//
// Para todo par de Funnel_Stage consecutivos na mesma Time_Window, a contagem
// da etapa posterior é menor ou igual à da etapa anterior (funil não-crescente).
// A agregação cumulativa (`aggregateFunnelCounts`) garante isso por construção
// para QUALQUER conjunto de etapas de usuário.
//
// Validates: Requirements 8.1, 8.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { FUNNEL_ORDER } from '../../../services/admin/rastreamento/domain';
import { aggregateFunnelCounts } from '../../../services/admin/rastreamento/funnelMetrics';

describe('CP6 — Conversion_Funnel monotonicidade', () => {
  it('contagem cumulativa é não-crescente ao longo de FUNNEL_ORDER', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...FUNNEL_ORDER), { minLength: 0, maxLength: 80 }),
        (userStages) => {
          const counts = aggregateFunnelCounts(userStages);
          for (let i = 1; i < FUNNEL_ORDER.length; i += 1) {
            expect(counts[FUNNEL_ORDER[i]]).toBeLessThanOrEqual(counts[FUNNEL_ORDER[i - 1]]);
          }
          // O total de visitantes é igual ao número de usuários (todos passam pelo topo).
          expect(counts[FUNNEL_ORDER[0]]).toBe(userStages.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});
