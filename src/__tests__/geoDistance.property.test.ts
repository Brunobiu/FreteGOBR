/**
 * PBTs para src/utils/geoDistance.ts
 *
 * Property 1: invariante de distância e fallback nulo de filterFretesByRadius.
 * Property 2: monotonicidade do filtro em R.
 * Property 3: simetria/zero/não-negatividade do haversineDistanceKm.
 *
 * Validates: Requirements 4.1, 4.2, 4.6, 4.7, 6.3, 6.4, 6.5, 6.6, 7.1, 3.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  filterFretesByRadius,
  haversineDistanceKm,
} from '../utils/geoDistance';

const pointArb = fc.record({
  latitude: fc.float({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
  longitude: fc.float({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
});

const validFreteArb = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom('ativo', 'encerrado', 'cancelado'),
  originLocation: pointArb.filter(
    (p) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      !(p.latitude === 0 && p.longitude === 0)
  ),
});

const radiusArb = fc.integer({ min: 1, max: 1000 });

describe('haversineDistanceKm', () => {
  it('é simétrica (com tolerância numérica)', () => {
    fc.assert(
      fc.property(pointArb, pointArb, (p1, p2) => {
        const a = haversineDistanceKm(p1, p2);
        const b = haversineDistanceKm(p2, p1);
        expect(Math.abs(a - b)).toBeLessThan(0.001);
      }),
      { numRuns: 200 }
    );
  });

  it('retorna 0 (com tolerância) para pontos idênticos', () => {
    fc.assert(
      fc.property(pointArb, (p) => {
        expect(haversineDistanceKm(p, p)).toBeLessThan(0.001);
      }),
      { numRuns: 200 }
    );
  });

  it('é não-negativa e finita', () => {
    fc.assert(
      fc.property(pointArb, pointArb, (p1, p2) => {
        const d = haversineDistanceKm(p1, p2);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });
});

describe('filterFretesByRadius', () => {
  it('quando motoristaPoint é null, retorna a lista original', () => {
    fc.assert(
      fc.property(fc.array(validFreteArb, { maxLength: 20 }), radiusArb, (fretes, r) => {
        const out = filterFretesByRadius(fretes, null, r);
        expect(out).toBe(fretes);
      }),
      { numRuns: 100 }
    );
  });

  it('todos os elementos do resultado satisfazem a invariante de distância', () => {
    fc.assert(
      fc.property(
        fc.array(validFreteArb, { maxLength: 20 }),
        pointArb,
        radiusArb,
        (fretes, m, r) => {
          const out = filterFretesByRadius(fretes, m, r);
          for (const f of out) {
            const d = haversineDistanceKm(m, f.originLocation);
            expect(d).toBeLessThanOrEqual(r);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('é monotônica em R (R1 ≤ R2 implica subset)', () => {
    fc.assert(
      fc.property(
        fc.array(validFreteArb, { maxLength: 20 }),
        pointArb,
        radiusArb,
        radiusArb,
        (fretes, m, a, b) => {
          const r1 = Math.min(a, b);
          const r2 = Math.max(a, b);
          const out1 = filterFretesByRadius(fretes, m, r1);
          const out2 = filterFretesByRadius(fretes, m, r2);
          const ids2 = new Set(out2.map((f) => f.id));
          for (const f of out1) {
            expect(ids2.has(f.id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exclui fretes com originLocation inválido (lat/lng zero ou NaN)', () => {
    const invalid = [
      {
        id: '00000000-0000-4000-8000-000000000000',
        status: 'ativo' as const,
        originLocation: { latitude: 0, longitude: 0 },
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        status: 'ativo' as const,
        originLocation: { latitude: NaN, longitude: 10 },
      },
    ];
    const m = { latitude: -16.6869, longitude: -49.2648 }; // Goiânia
    const out = filterFretesByRadius(invalid, m, 1000);
    expect(out.length).toBe(0);
  });
});
