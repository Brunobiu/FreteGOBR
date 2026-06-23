// Feature: admin-rastreamento-inteligente, Property 2 (CP2): Risk_Score — limites
// + determinismo.
//
// Para toda combinação de Risk_Factor, calculateRiskScore produz um inteiro no
// intervalo fechado [0, 100] (clamping), e os mesmos fatores produzem sempre o
// mesmo score (determinismo).
//
// Validates: Requirements 6.1, 6.2, 6.4, 6.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { calculateRiskScore } from '../../../services/admin/rastreamento/riskScore';
import { riskFactorsArb } from './_generators';

describe('CP2 — Risk_Score limites + determinismo', () => {
  it('produz inteiro em [0,100] e é determinístico', () => {
    fc.assert(
      fc.property(riskFactorsArb(), (factors) => {
        const score = calculateRiskScore(factors);
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        // Determinismo: reexecutar com os mesmos fatores dá o mesmo score.
        expect(calculateRiskScore({ ...factors })).toBe(score);
      }),
      { numRuns: 200 }
    );
  });

  it('satura em 100 com fatores extremos (clamping)', () => {
    expect(
      calculateRiskScore({
        days_since_last_access: 365,
        recent_failures: 50,
        frustrated_attempts: 50,
        freight_refusals: 50,
        no_conversion: 1,
      })
    ).toBe(100);
  });

  it('é 0 com todos os fatores zerados', () => {
    expect(
      calculateRiskScore({
        days_since_last_access: 0,
        recent_failures: 0,
        frustrated_attempts: 0,
        freight_refusals: 0,
        no_conversion: 0,
      })
    ).toBe(0);
  });
});
