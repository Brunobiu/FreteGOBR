/**
 * Property-Based Tests for Frete Filters
 *
 * Property 9: Filter Matching - fretes retornados sempre satisfazem os filtros aplicados
 * Property 20: Filter Composition (AND Logic) - múltiplos filtros combinam com lógica AND
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import type { FreteFilters } from '../services/fretes';

// Simula a lógica de filtragem do backend (getActiveFretes) no frontend para testes
interface MockFrete {
  origin: string;
  destination: string;
  cargoType: string;
  vehicleType: string;
  weight: number;
  value: number;
  status: string;
}

function applyFilters(fretes: MockFrete[], filters: FreteFilters): MockFrete[] {
  return fretes.filter((f) => {
    if (filters.origin && !f.origin.toLowerCase().includes(filters.origin.toLowerCase()))
      return false;
    if (
      filters.destination &&
      !f.destination.toLowerCase().includes(filters.destination.toLowerCase())
    )
      return false;
    if (filters.cargoType && f.cargoType !== filters.cargoType) return false;
    if (filters.vehicleType && f.vehicleType !== filters.vehicleType) return false;
    if (filters.minWeight !== undefined && f.weight < filters.minWeight) return false;
    if (filters.maxWeight !== undefined && f.weight > filters.maxWeight) return false;
    if (filters.minValue !== undefined && f.value < filters.minValue) return false;
    if (filters.maxValue !== undefined && f.value > filters.maxValue) return false;
    return true;
  });
}

const cargoTypes = ['geral', 'granel', 'refrigerada', 'perigosa', 'fragil'];
const vehicleTypes = ['truck', 'van', 'pickup', 'carreta'];

const mockFreteArb = fc.record({
  origin: fc.constantFrom(
    'Goiânia, GO',
    'São Paulo, SP',
    'Brasília, DF',
    'Curitiba, PR',
    'Belo Horizonte, MG'
  ),
  destination: fc.constantFrom(
    'Goiânia, GO',
    'São Paulo, SP',
    'Brasília, DF',
    'Curitiba, PR',
    'Belo Horizonte, MG'
  ),
  cargoType: fc.constantFrom(...cargoTypes),
  vehicleType: fc.constantFrom(...vehicleTypes),
  weight: fc.float({ min: 100, max: 50000, noNaN: true }),
  value: fc.float({ min: 500, max: 100000, noNaN: true }),
  status: fc.constant('ativo'),
});

describe('Property 9: Filter Matching', () => {
  it('todos os resultados satisfazem o filtro de cargoType', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }),
        fc.constantFrom(...cargoTypes),
        (fretes, cargoType) => {
          const result = applyFilters(fretes, { cargoType });
          return result.every((f) => f.cargoType === cargoType);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('todos os resultados satisfazem o filtro de vehicleType', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }),
        fc.constantFrom(...vehicleTypes),
        (fretes, vehicleType) => {
          const result = applyFilters(fretes, { vehicleType });
          return result.every((f) => f.vehicleType === vehicleType);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('todos os resultados satisfazem o filtro de peso mínimo', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }),
        fc.float({ min: 0, max: 25000, noNaN: true }),
        (fretes, minWeight) => {
          const result = applyFilters(fretes, { minWeight });
          return result.every((f) => f.weight >= minWeight);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('todos os resultados satisfazem o filtro de peso máximo', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }),
        fc.float({ min: 100, max: 50000, noNaN: true }),
        (fretes, maxWeight) => {
          const result = applyFilters(fretes, { maxWeight });
          return result.every((f) => f.weight <= maxWeight);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('todos os resultados satisfazem o filtro de valor mínimo', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }),
        fc.float({ min: 0, max: 50000, noNaN: true }),
        (fretes, minValue) => {
          const result = applyFilters(fretes, { minValue });
          return result.every((f) => f.value >= minValue);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 20: Filter Composition (AND Logic)', () => {
  it('filtros combinados retornam subconjunto de cada filtro individual', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 30 }),
        fc.constantFrom(...cargoTypes),
        fc.constantFrom(...vehicleTypes),
        (fretes, cargoType, vehicleType) => {
          const combined = applyFilters(fretes, { cargoType, vehicleType });
          const onlyCargo = applyFilters(fretes, { cargoType });
          const onlyVehicle = applyFilters(fretes, { vehicleType });

          // Resultado combinado deve ser subconjunto de cada filtro individual
          const combinedIds = new Set(combined.map((f) => f.origin + f.cargoType + f.vehicleType));
          const cargoIds = new Set(onlyCargo.map((f) => f.origin + f.cargoType + f.vehicleType));
          const vehicleIds = new Set(
            onlyVehicle.map((f) => f.origin + f.cargoType + f.vehicleType)
          );

          return (
            [...combinedIds].every((id) => cargoIds.has(id)) &&
            [...combinedIds].every((id) => vehicleIds.has(id))
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('filtro de peso min/max retorna apenas fretes dentro do intervalo', () => {
    fc.assert(
      fc.property(
        fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }),
        fc.float({ min: 100, max: 20000, noNaN: true }),
        fc.float({ min: 20001, max: 50000, noNaN: true }),
        (fretes, minWeight, maxWeight) => {
          const result = applyFilters(fretes, { minWeight, maxWeight });
          return result.every((f) => f.weight >= minWeight && f.weight <= maxWeight);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('filtros sem critérios retornam todos os fretes', () => {
    fc.assert(
      fc.property(fc.array(mockFreteArb, { minLength: 0, maxLength: 20 }), (fretes) => {
        const result = applyFilters(fretes, {});
        return result.length === fretes.length;
      }),
      { numRuns: 100 }
    );
  });

  it('filtro impossível retorna lista vazia', () => {
    fc.assert(
      fc.property(fc.array(mockFreteArb, { minLength: 1, maxLength: 20 }), (fretes) => {
        // minWeight > maxWeight é impossível de satisfazer
        const result = applyFilters(fretes, { minWeight: 99999, maxWeight: 1 });
        return result.length === 0;
      }),
      { numRuns: 50 }
    );
  });
});
