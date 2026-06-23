// Feature: admin-rastreamento-inteligente, Property 3 (CP3): Risk_Score —
// monotonicidade não-decrescente.
//
// Para todo Risk_Factor, aumentar o valor de um fator mantendo os demais
// constantes nunca diminui o Risk_Score resultante (decorre de pesos
// não-negativos + clamp).
//
// Validates: Requirements 6.3, 6.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { calculateRiskScore, type RiskFactors } from '../../../services/admin/rastreamento/riskScore';
import { riskFactorsArb } from './_generators';

const NUMERIC_KEYS = [
  'days_since_last_access',
  'recent_failures',
  'frustrated_attempts',
  'freight_refusals',
] as const;

describe('CP3 — Risk_Score monotonicidade não-decrescente', () => {
  it('aumentar qualquer fator numérico nunca diminui o score', () => {
    fc.assert(
      fc.property(
        riskFactorsArb(),
        fc.constantFrom(...NUMERIC_KEYS),
        fc.nat({ max: 100 }),
        (base, key, delta) => {
          const before = calculateRiskScore(base);
          const bumped: RiskFactors = { ...base, [key]: base[key] + delta };
          const after = calculateRiskScore(bumped);
          expect(after).toBeGreaterThanOrEqual(before);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('ligar no_conversion (0→1) nunca diminui o score', () => {
    fc.assert(
      fc.property(riskFactorsArb(), (base) => {
        const off = calculateRiskScore({ ...base, no_conversion: 0 });
        const on = calculateRiskScore({ ...base, no_conversion: 1 });
        expect(on).toBeGreaterThanOrEqual(off);
      }),
      { numRuns: 200 }
    );
  });
});
