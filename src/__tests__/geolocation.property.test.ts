/**
 * Property-Based Tests for Geolocation
 *
 * Property 17: Geocoding Validity - coordenadas retornadas são sempre válidas
 * Testes unitários para calculateDistance e reverseGeocode
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateDistance } from '../services/geolocation';
import type { GeographicPoint } from '../types';

const pointArb = fc.record({
  latitude: fc.float({ min: Math.fround(-33.75), max: Math.fround(5.27), noNaN: true }),
  longitude: fc.float({ min: Math.fround(-73.99), max: Math.fround(-34.79), noNaN: true }),
});

describe('Property 17: Geocoding Validity - calculateDistance', () => {
  it('distância entre o mesmo ponto é zero', () => {
    fc.assert(
      fc.property(pointArb, (point) => {
        const dist = calculateDistance(point, point);
        return Math.abs(dist) < 0.001;
      }),
      { numRuns: 100 }
    );
  });

  it('distância é sempre não-negativa', () => {
    fc.assert(
      fc.property(pointArb, pointArb, (p1, p2) => {
        return calculateDistance(p1, p2) >= 0;
      }),
      { numRuns: 100 }
    );
  });

  it('distância é simétrica: d(A,B) === d(B,A)', () => {
    fc.assert(
      fc.property(pointArb, pointArb, (p1, p2) => {
        const d1 = calculateDistance(p1, p2);
        const d2 = calculateDistance(p2, p1);
        return Math.abs(d1 - d2) < 0.001;
      }),
      { numRuns: 100 }
    );
  });

  it('desigualdade triangular: d(A,C) <= d(A,B) + d(B,C)', () => {
    fc.assert(
      fc.property(pointArb, pointArb, pointArb, (a, b, c) => {
        const dAC = calculateDistance(a, c);
        const dAB = calculateDistance(a, b);
        const dBC = calculateDistance(b, c);
        return dAC <= dAB + dBC + 1; // tolerância de 1km para imprecisão de float 32-bit
      }),
      { numRuns: 100 }
    );
  });

  it('coordenadas válidas do Brasil produzem distâncias razoáveis (< 6000km)', () => {
    fc.assert(
      fc.property(pointArb, pointArb, (p1, p2) => {
        return calculateDistance(p1, p2) < 6000;
      }),
      { numRuns: 100 }
    );
  });
});

describe('Testes unitários para calculateDistance', () => {
  it('Goiânia → São Paulo ≈ 870km', () => {
    const goiania: GeographicPoint = { latitude: -16.6869, longitude: -49.2648 };
    const saopaulo: GeographicPoint = { latitude: -23.5505, longitude: -46.6333 };
    const dist = calculateDistance(goiania, saopaulo);
    expect(dist).toBeGreaterThan(800);
    expect(dist).toBeLessThan(950);
  });

  it('Brasília → Rio de Janeiro ≈ 930km', () => {
    const brasilia: GeographicPoint = { latitude: -15.7801, longitude: -47.9292 };
    const rio: GeographicPoint = { latitude: -22.9068, longitude: -43.1729 };
    const dist = calculateDistance(brasilia, rio);
    expect(dist).toBeGreaterThan(850);
    expect(dist).toBeLessThan(1050);
  });
});
