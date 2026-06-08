/**
 * Property-Based Tests — Catálogo de planos (`src/utils/subscriptionPlans.ts`).
 *
 * Feature: assinaturas-pagamento, Property 1: Total dos planos.
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5.
 *
 * `computePlanTotal` é determinístico e igual a `monthlyPrice * months`
 * arredondado a 2 casas; os totais dos três planos são fixos
 * (39,90 / 104,70 / 179,40).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  PLANS,
  computePlanTotal,
  getPlanById,
  getRecommendedPlan,
  type Plan,
  type PlanId,
} from '../utils/subscriptionPlans';

/** round2 de referência (espelha o helper interno do módulo). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// Feature: assinaturas-pagamento, Property 1: Total dos planos
// Validates: Requirements 1.2, 1.3, 1.4, 1.5
// ============================================================================
describe('Property 1: computePlanTotal — total dos planos', () => {
  it('é determinístico (mesmo plano => mesmo total)', () => {
    fc.assert(
      fc.property(fc.constantFrom<PlanId>('mensal', 'trimestral', 'semestral'), (id) => {
        const plan = getPlanById(id) as Plan;
        const a = computePlanTotal(plan);
        const b = computePlanTotal(plan);
        expect(a).toBe(b);
      })
    );
  });

  it('iguala round2(monthlyPrice * months) para qualquer plano gerado', () => {
    const planArb = fc.record({
      id: fc.constantFrom<PlanId>('mensal', 'trimestral', 'semestral'),
      name: fc.constantFrom('Mensal', 'Trimestral', 'Semestral'),
      months: fc.constantFrom(1, 3, 6, 12),
      monthlyPrice: fc.constantFrom(19.9, 29.9, 34.9, 39.9, 49.9),
      recommended: fc.boolean(),
    });
    fc.assert(
      fc.property(planArb, (plan) => {
        expect(computePlanTotal(plan)).toBe(round2(plan.monthlyPrice * plan.months));
      })
    );
  });

  it('produz os totais fixos esperados dos três planos do catálogo', () => {
    expect(computePlanTotal(getPlanById('mensal') as Plan)).toBe(39.9);
    expect(computePlanTotal(getPlanById('trimestral') as Plan)).toBe(104.7);
    expect(computePlanTotal(getPlanById('semestral') as Plan)).toBe(179.4);
  });
});

// ============================================================================
// Invariantes estruturais do catálogo (apoio à Property 1)
// ============================================================================
describe('Catálogo PLANS — invariantes estruturais', () => {
  it('contém exatamente os três planos esperados, na ordem de exibição', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['mensal', 'trimestral', 'semestral']);
  });

  it('tem exatamente um plano recomendado e é o semestral', () => {
    const recommended = PLANS.filter((p) => p.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].id).toBe('semestral');
    expect(getRecommendedPlan().id).toBe('semestral');
  });

  it('todos os planos têm months > 0 e monthlyPrice > 0', () => {
    for (const p of PLANS) {
      expect(p.months).toBeGreaterThan(0);
      expect(p.monthlyPrice).toBeGreaterThan(0);
    }
  });

  it('getPlanById retorna undefined para id inexistente', () => {
    expect(getPlanById('anual' as PlanId)).toBeUndefined();
  });
});
