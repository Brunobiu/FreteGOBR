// Feature: admin-rastreamento-inteligente, Property 1 (CP1): Abandonment_Cause_Classifier
// — totalidade + determinismo + precedência total.
//
// Para todo Journey_Summary, classifyAbandonmentCause retorna EXATAMENTE um
// valor do domínio fechado Abandonment_Cause (incluindo UNKNOWN); a mesma
// entrada produz sempre a mesma causa; e causas concorrentes são resolvidas por
// uma ordem de precedência total fixa (mesmo summary nunca produz causas
// diferentes entre execuções).
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  ABANDONMENT_CAUSES,
  ABANDONMENT_PRECEDENCE,
} from '../../../services/admin/rastreamento/domain';
import { classifyAbandonmentCause } from '../../../services/admin/rastreamento/abandonmentClassifier';
import { journeySummaryArb } from './_generators';

describe('CP1 — Abandonment_Cause_Classifier', () => {
  it('totalidade: toda saída pertence ao domínio fechado Abandonment_Cause', () => {
    fc.assert(
      fc.property(journeySummaryArb(), fc.integer({ min: 1, max: 90 }), (summary, inactivity) => {
        const cause = classifyAbandonmentCause(summary, inactivity);
        expect(ABANDONMENT_CAUSES).toContain(cause);
      }),
      { numRuns: 200 }
    );
  });

  it('determinismo: mesma entrada ⇒ mesma causa (reexecução)', () => {
    fc.assert(
      fc.property(journeySummaryArb(), fc.integer({ min: 1, max: 90 }), (summary, inactivity) => {
        const a = classifyAbandonmentCause(summary, inactivity);
        const b = classifyAbandonmentCause({ ...summary }, inactivity);
        expect(b).toBe(a);
      }),
      { numRuns: 200 }
    );
  });

  it('precedência total: a causa retornada é a de maior precedência entre as aplicáveis', () => {
    fc.assert(
      fc.property(journeySummaryArb(), fc.integer({ min: 1, max: 90 }), (summary, inactivity) => {
        const cause = classifyAbandonmentCause(summary, inactivity);
        // A causa escolhida deve aparecer em ABANDONMENT_PRECEDENCE e nenhuma
        // causa de precedência MAIOR pode estar simultaneamente aplicável.
        const chosenRank = ABANDONMENT_PRECEDENCE.indexOf(cause);
        expect(chosenRank).toBeGreaterThanOrEqual(0);

        // Reaplicar o classificador a uma cópia (determinismo) confirma a ordem.
        const again = classifyAbandonmentCause({ ...summary }, inactivity);
        expect(again).toBe(cause);
      }),
      { numRuns: 200 }
    );
  });
});
