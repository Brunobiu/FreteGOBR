/**
 * Property-Based Tests — Validação de pares de anos do veículo
 *
 * Property 7 (Design Section 10): a validação cruzada exige que
 * `vehicleYearModel >= vehicleYearManufacture` e cada um dentro do
 * range permitido (1980 .. ano corrente + 1 para fab; +2 para modelo).
 *
 * Validates: Requirements 6.2, 6.3, 6.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

const CURRENT_YEAR = new Date().getFullYear();

interface YearValidationResult {
  ok: boolean;
  errors: { yearManufacture?: string; yearModel?: string };
}

// Função pura espelhando a lógica de validação do submit
function validateYears(
  yearFab: number | undefined,
  yearMod: number | undefined
): YearValidationResult {
  const errors: { yearManufacture?: string; yearModel?: string } = {};
  if (yearFab !== undefined && (yearFab < 1980 || yearFab > CURRENT_YEAR + 1)) {
    errors.yearManufacture = 'fora do intervalo';
  }
  if (yearMod !== undefined && (yearMod < 1980 || yearMod > CURRENT_YEAR + 2)) {
    errors.yearModel = 'fora do intervalo';
  }
  if (yearFab !== undefined && yearMod !== undefined && yearMod < yearFab) {
    errors.yearModel = 'modelo deve ser >= fabricação';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

describe('validateYears', () => {
  it('aceita ambos undefined (campos opcionais)', () => {
    expect(validateYears(undefined, undefined).ok).toBe(true);
  });

  it('aceita pares válidos onde modelo >= fabricação dentro dos ranges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1980, max: CURRENT_YEAR + 1 }),
        fc.integer({ min: 0, max: 2 }),
        (yearFab, delta) => {
          const yearMod = yearFab + delta;
          if (yearMod > CURRENT_YEAR + 2) return; // pula casos fora do max do modelo
          const r = validateYears(yearFab, yearMod);
          expect(r.ok).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('rejeita pares onde modelo < fabricação', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1981, max: CURRENT_YEAR + 1 }),
        fc.integer({ min: 1, max: 5 }),
        (yearFab, delta) => {
          const yearMod = yearFab - delta;
          if (yearMod < 1980) return;
          const r = validateYears(yearFab, yearMod);
          expect(r.ok).toBe(false);
          expect(r.errors.yearModel).toBeDefined();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('rejeita ano fabricação < 1980', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1979 }), (y) => {
        const r = validateYears(y, undefined);
        expect(r.ok).toBe(false);
        expect(r.errors.yearManufacture).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('rejeita ano fabricação > ano atual + 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: CURRENT_YEAR + 2, max: 9999 }), (y) => {
        const r = validateYears(y, undefined);
        expect(r.ok).toBe(false);
        expect(r.errors.yearManufacture).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('rejeita ano modelo > ano atual + 2', () => {
    fc.assert(
      fc.property(fc.integer({ min: CURRENT_YEAR + 3, max: 9999 }), (y) => {
        const r = validateYears(undefined, y);
        expect(r.ok).toBe(false);
        expect(r.errors.yearModel).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});
