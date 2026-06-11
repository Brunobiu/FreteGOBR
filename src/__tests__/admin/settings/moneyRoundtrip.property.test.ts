/**
 * Property-Based Test — Round-trip centavos↔reais (Settings_Service).
 *
 * Feature: finalizacao-lancamento, Property 3: Round-trip centavos↔reais.
 * Validates: Requirements 7.1, 7.4, 7.5.
 *
 * Para todo inteiro de centavos c em 0..1_000_000:
 *   - reaisToCents(centsToReais(c)) === c
 *   - centsToReais(c) sempre tem exatamente 2 casas decimais.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { reaisToCents, centsToReais, MONEY_MAX_CENTS } from '../../../services/admin/settings';

describe('Property 3: round-trip centavos↔reais', () => {
  it('reaisToCents(centsToReais(c)) === c para todo c válido', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MONEY_MAX_CENTS }), (c) => {
        expect(reaisToCents(centsToReais(c))).toBe(c);
      }),
      { numRuns: 200 }
    );
  });

  it('centsToReais sempre produz string com exatamente 2 casas decimais', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MONEY_MAX_CENTS }), (c) => {
        const s = centsToReais(c);
        expect(s).toMatch(/^\d+\.\d{2}$/);
      }),
      { numRuns: 200 }
    );
  });

  it('valores fixos conhecidos convertem corretamente', () => {
    expect(centsToReais(3900)).toBe('39.00');
    expect(centsToReais(8700)).toBe('87.00');
    expect(centsToReais(15000)).toBe('150.00');
    expect(reaisToCents('39.00')).toBe(3900);
    expect(reaisToCents('39,90')).toBe(3990);
    expect(reaisToCents(150)).toBe(15000);
  });

  it('entrada não numérica lança INVALID_VALUE', () => {
    expect(() => reaisToCents('abc')).toThrowError(/inválido/i);
  });
});
