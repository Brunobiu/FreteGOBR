// Feature: admin-rastreamento-inteligente, Property 4 (CP4): Risk_Band — função
// total + monotonicidade.
//
// Para todo Risk_Score em [0,100], deriveRiskBand atribui exatamente uma
// Risk_Band (função total sobre [0,24]/[25,49]/[50,74]/[75,100]), e para todo
// par de scores, um score maior nunca mapeia para uma Risk_Band de severidade
// menor (monotonicidade).
//
// Validates: Requirements 6.6, 6.7

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { RISK_BANDS } from '../../../services/admin/rastreamento/domain';
import { deriveRiskBand, riskBandSeverity } from '../../../services/admin/rastreamento/riskScore';

describe('CP4 — Risk_Band função total + monotonicidade', () => {
  it('todo score em [0,100] mapeia para exatamente uma banda do domínio', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        const band = deriveRiskBand(score);
        expect(RISK_BANDS).toContain(band);
      }),
      { numRuns: 200 }
    );
  });

  it('faixas exatas: [0,24]=LOW, [25,49]=MEDIUM, [50,74]=HIGH, [75,100]=CRITICAL', () => {
    expect(deriveRiskBand(0)).toBe('LOW');
    expect(deriveRiskBand(24)).toBe('LOW');
    expect(deriveRiskBand(25)).toBe('MEDIUM');
    expect(deriveRiskBand(49)).toBe('MEDIUM');
    expect(deriveRiskBand(50)).toBe('HIGH');
    expect(deriveRiskBand(74)).toBe('HIGH');
    expect(deriveRiskBand(75)).toBe('CRITICAL');
    expect(deriveRiskBand(100)).toBe('CRITICAL');
  });

  it('monotonicidade: score maior ⇒ severidade de banda maior ou igual', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(riskBandSeverity(deriveRiskBand(hi))).toBeGreaterThanOrEqual(
            riskBandSeverity(deriveRiskBand(lo))
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
