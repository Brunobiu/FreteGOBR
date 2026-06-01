// Feature: admin-assistant, Property 21
/**
 * CP-21: Validacao de Critical_Threshold (inteiro >= 1)
 *
 * Para todo valor, isValidThreshold retorna verdadeiro SE E SOMENTE SE o
 * valor e um inteiro maior ou igual a 1. Rejeita nao-numeros, NaN,
 * Infinity, fracionarios e inteiros < 1.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 10.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { isValidThreshold } from '../../../services/admin/assistant';

// Oraculo independente: replica a definicao do dominio (inteiro >= 1)
// sem reusar a implementacao sob teste.
function expectedValid(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

// ----- Geradores -----

// Mistura inteiros (validos e invalidos), doubles (fracionarios/especiais)
// e nao-numeros, cobrindo todo o espaco de entrada de `unknown`.
const valueGen = fc.oneof(
  fc.integer(),
  fc.integer({ min: 1, max: 1000 }), // enfase no ramo valido
  fc.double(),
  fc.double({ noNaN: false }),
  fc.constantFrom<unknown>(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    1.5,
    '1',
    'abc',
    true,
    false,
    null,
    undefined,
    {},
    [1]
  )
);

describe('CP-21: Validacao de Critical_Threshold (inteiro >= 1)', () => {
  it('isValidThreshold e verdadeiro sse inteiro >= 1', () => {
    fc.assert(
      fc.property(valueGen, (n) => {
        expect(isValidThreshold(n)).toBe(expectedValid(n));
      }),
      { numRuns: 100 }
    );
  });
});
