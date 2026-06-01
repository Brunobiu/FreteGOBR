/**
 * CP-2: Property test da derivacao de metricas com guardas de divisao por zero.
 *
 * Spec: .kiro/specs/admin-marketing/design.md (Property 2 / CP-2) e
 * requirements.md Requirements 4.10, 5.6, 5.7, 5.8, 5.9, 5.10.
 *
 * Funcao sob teste: `computeMetrics(m: CampaignMetrics): ComputedMetrics`
 * (helper puro de src/services/admin/marketing.ts). Por ser pura e sem
 * dependencias externas, NAO precisa de mocks.
 *
 * Propriedade 2 — Derivacao correta de metricas com guardas de divisao por zero:
 *
 *  Ramo valido (clicks <= impressions, garantido pelo gerador):
 *   1. computeMetrics nunca lanca.
 *   2. impressions > 0  ⇒ ctr === clicks / impressions; impressions === 0 ⇒ ctr === 0.
 *   3. clicks > 0       ⇒ cpc === spend / clicks (incl. cpc === 0 quando spend === 0
 *                          e clicks > 0); clicks === 0 ⇒ cpc === null.
 *   4. leads > 0        ⇒ cpl === spend / leads; leads === 0 ⇒ cpl === null.
 *
 *  Ramo de violacao (clicks > impressions, testado a parte):
 *   5. computeMetrics lanca MarketingError com code === 'INVALID_METRICS'
 *      (em vez de derivar CTR > 100%).
 *
 * Comparacoes de divisao usam EXATAMENTE a mesma expressao da implementacao
 * (spend / clicks, clicks / impressions, spend / leads) para que a igualdade
 * estrita (===) seja exata mesmo com ponto flutuante.
 */

// Feature: admin-marketing, Property 2: Derivação de métricas com guardas de divisão por zero

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeMetrics,
  MarketingError,
  type CampaignMetrics,
} from '../../../services/admin/marketing';

// Gerador do ramo valido: numeros nao-negativos com `clicks` restringido a
// no maximo `impressions` (Math.min), garantindo a invariante clicks <= impressions.
const campaignGen: fc.Arbitrary<CampaignMetrics> = fc
  .record({
    spend: fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
    impressions: fc.nat({ max: 1_000_000 }),
    clicks: fc.nat({ max: 1_000_000 }),
    leads: fc.nat({ max: 1_000_000 }),
    conversions: fc.nat({ max: 1_000_000 }),
  })
  .map((m) => ({ ...m, clicks: Math.min(m.clicks, m.impressions) }));

describe('CP-2: computeMetrics — derivacao de metricas com guardas de div/0', () => {
  it('Property 2 (ramo valido): ctr/cpc/cpl corretos, sem lancar por div/0', () => {
    fc.assert(
      fc.property(campaignGen, (m) => {
        // Invariante do gerador: nunca viola clicks <= impressions.
        expect(m.clicks).toBeLessThanOrEqual(m.impressions);

        // (1) Nunca lanca no ramo valido.
        const result = computeMetrics(m);

        // (2) CTR: clicks / impressions quando impressions > 0; 0 quando impressions === 0.
        if (m.impressions > 0) {
          expect(result.ctr).toBe(m.clicks / m.impressions);
        } else {
          expect(result.ctr).toBe(0);
        }

        // (3) CPC: spend / clicks quando clicks > 0; null quando clicks === 0.
        if (m.clicks > 0) {
          expect(result.cpc).toBe(m.spend / m.clicks);
          // Faceta especifica: spend === 0 e clicks > 0 ⇒ cpc === 0.
          if (m.spend === 0) {
            expect(result.cpc).toBe(0);
          }
        } else {
          expect(result.cpc).toBeNull();
        }

        // (4) CPL: spend / leads quando leads > 0; null quando leads === 0.
        if (m.leads > 0) {
          expect(result.cpl).toBe(m.spend / m.leads);
        } else {
          expect(result.cpl).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Property 2 (ramo de violacao): clicks > impressions ⇒ MarketingError(INVALID_METRICS)', () => {
    // Gerador que garante clicks > impressions: clicks = impressions + 1 + nat.
    const violationGen: fc.Arbitrary<CampaignMetrics> = fc
      .record({
        spend: fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        impressions: fc.nat({ max: 1_000_000 }),
        extra: fc.nat({ max: 1_000_000 }),
        leads: fc.nat({ max: 1_000_000 }),
        conversions: fc.nat({ max: 1_000_000 }),
      })
      .map(({ spend, impressions, extra, leads, conversions }) => ({
        spend,
        impressions,
        clicks: impressions + 1 + extra,
        leads,
        conversions,
      }));

    fc.assert(
      fc.property(violationGen, (m) => {
        // Pre-condicao do ramo: a invariante esta de fato violada.
        expect(m.clicks).toBeGreaterThan(m.impressions);

        let threw = false;
        try {
          computeMetrics(m);
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(MarketingError);
          expect((err as MarketingError).code).toBe('INVALID_METRICS');
        }
        expect(threw).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
