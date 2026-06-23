// Feature: admin-rastreamento-inteligente, Property 5 (CP5): Stage_Derivation —
// domínio fechado + determinismo.
//
// Para todo conjunto de Journey_Event, deriveFunnelStage retorna um Funnel_Stage
// do domínio ordenado (VISITOR … RECURRING_USER), igual ao mais avançado
// alcançado, e é invariante à ordem de entrada e idempotente (mesmo conjunto ⇒
// mesma etapa).
//
// Validates: Requirements 8.2, 4.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { FUNNEL_ORDER } from '../../../services/admin/rastreamento/domain';
import { deriveFunnelStage, stageIndex } from '../../../services/admin/rastreamento/stageDerivation';
import { journeyEventsArb } from './_generators';

describe('CP5 — Stage_Derivation domínio fechado + determinismo', () => {
  it('retorna etapa do domínio ordenado, idempotente e invariante à ordem', () => {
    fc.assert(
      fc.property(journeyEventsArb(), (events) => {
        const stage = deriveFunnelStage(events);
        // (a) domínio fechado e ordenado
        expect(FUNNEL_ORDER).toContain(stage);
        expect(stageIndex(stage)).toBeGreaterThanOrEqual(0);
        // (b) idempotência
        expect(deriveFunnelStage(events)).toBe(stage);
        // (c) invariância à permutação da entrada
        expect(deriveFunnelStage([...events].reverse())).toBe(stage);
      }),
      { numRuns: 200 }
    );
  });

  it('conjunto vazio ⇒ VISITOR (piso, totalidade)', () => {
    expect(deriveFunnelStage([])).toBe('VISITOR');
  });

  it('2+ fretes concluídos ⇒ RECURRING_USER', () => {
    expect(
      deriveFunnelStage([
        { event_type: 'FIRST_FREIGHT_COMPLETED' },
        { event_type: 'FIRST_FREIGHT_COMPLETED' },
      ])
    ).toBe('RECURRING_USER');
  });

  it('pagamento aprovado ⇒ pelo menos SUBSCRIPTION_PAID', () => {
    const stage = deriveFunnelStage([{ event_type: 'PAYMENT_SUCCEEDED' }]);
    expect(stageIndex(stage)).toBeGreaterThanOrEqual(stageIndex('SUBSCRIPTION_PAID'));
  });
});
