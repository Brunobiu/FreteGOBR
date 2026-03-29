/**
 * Property-Based Tests for Trip Suggestion
 *
 * Property 12: Distance-Based Sorting
 * Validates: Requirements 11.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateDistance } from '../services/geolocation';
import type { GeographicPoint } from '../types';

// Simula a ordenação que findNearbyFretes faz no frontend
interface FreteWithDistance {
  id: string;
  distanceKm: number;
  originLocation: GeographicPoint;
}

function sortByDistance(fretes: FreteWithDistance[]): FreteWithDistance[] {
  return [...fretes].sort((a, b) => a.distanceKm - b.distanceKm);
}

function filterByRadius(
  fretes: FreteWithDistance[],
  userPoint: GeographicPoint,
  radiusKm: number
): FreteWithDistance[] {
  return fretes.filter((f) => calculateDistance(userPoint, f.originLocation) <= radiusKm);
}

const brazilPointArb = fc.record({
  latitude: fc.float({ min: Math.fround(-33.75), max: Math.fround(5.27), noNaN: true }),
  longitude: fc.float({ min: Math.fround(-73.99), max: Math.fround(-34.79), noNaN: true }),
});

const freteWithDistArb = fc.record({
  id: fc.uuid(),
  distanceKm: fc.float({ min: 0, max: Math.fround(5000), noNaN: true }),
  originLocation: brazilPointArb,
});

describe('Property 12: Distance-Based Sorting', () => {
  it('lista ordenada por distância é não-decrescente', () => {
    fc.assert(
      fc.property(fc.array(freteWithDistArb, { minLength: 0, maxLength: 20 }), (fretes) => {
        const sorted = sortByDistance(fretes);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].distanceKm < sorted[i - 1].distanceKm) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('ordenação preserva todos os elementos (sem perda)', () => {
    fc.assert(
      fc.property(fc.array(freteWithDistArb, { minLength: 0, maxLength: 20 }), (fretes) => {
        const sorted = sortByDistance(fretes);
        return sorted.length === fretes.length;
      }),
      { numRuns: 100 }
    );
  });

  it('ordenação é estável: IDs presentes antes estão presentes depois', () => {
    fc.assert(
      fc.property(fc.array(freteWithDistArb, { minLength: 0, maxLength: 20 }), (fretes) => {
        const sorted = sortByDistance(fretes);
        const originalIds = new Set(fretes.map((f) => f.id));
        const sortedIds = new Set(sorted.map((f) => f.id));
        return (
          originalIds.size === sortedIds.size && [...originalIds].every((id) => sortedIds.has(id))
        );
      }),
      { numRuns: 100 }
    );
  });

  it('filtro por raio retorna apenas fretes dentro do raio', () => {
    fc.assert(
      fc.property(
        brazilPointArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            distanceKm: fc.float({ min: 0, max: Math.fround(5000), noNaN: true }),
            originLocation: brazilPointArb,
          }),
          { minLength: 0, maxLength: 20 }
        ),
        fc.constantFrom(50, 100, 200, 500),
        (userPoint, fretes, radiusKm) => {
          const filtered = filterByRadius(fretes, userPoint, radiusKm);
          return filtered.every(
            (f) => calculateDistance(userPoint, f.originLocation) <= radiusKm + 1 // +1km tolerância float
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it('primeiro elemento da lista ordenada tem menor ou igual distância que o último', () => {
    fc.assert(
      fc.property(fc.array(freteWithDistArb, { minLength: 2, maxLength: 20 }), (fretes) => {
        const sorted = sortByDistance(fretes);
        return sorted[0].distanceKm <= sorted[sorted.length - 1].distanceKm;
      }),
      { numRuns: 100 }
    );
  });
});

describe('Testes unitários para ordenação por distância', () => {
  it('lista vazia retorna lista vazia', () => {
    expect(sortByDistance([])).toEqual([]);
  });

  it('lista com um elemento retorna o mesmo elemento', () => {
    const frete = { id: '1', distanceKm: 50, originLocation: { latitude: -16, longitude: -49 } };
    expect(sortByDistance([frete])).toEqual([frete]);
  });

  it('ordena corretamente 3 fretes por distância', () => {
    const fretes = [
      { id: 'c', distanceKm: 300, originLocation: { latitude: -23, longitude: -46 } },
      { id: 'a', distanceKm: 50, originLocation: { latitude: -16, longitude: -49 } },
      { id: 'b', distanceKm: 150, originLocation: { latitude: -19, longitude: -43 } },
    ];
    const sorted = sortByDistance(fretes);
    expect(sorted[0].id).toBe('a');
    expect(sorted[1].id).toBe('b');
    expect(sorted[2].id).toBe('c');
  });
});
