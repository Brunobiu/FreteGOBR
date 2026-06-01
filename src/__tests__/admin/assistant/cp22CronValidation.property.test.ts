// Feature: admin-assistant, Property 22
/**
 * CP-22: Validacao do intervalo do Cron_Job (inteiro 1..5)
 *
 * Para todo valor, isValidCronInterval retorna verdadeiro SE E SOMENTE SE
 * o valor e um inteiro no intervalo fechado [1, 5]. Espelha o CHECK
 * `cron_interval_minutes BETWEEN 1 AND 5` da migration 047.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 10.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { isValidCronInterval } from '../../../services/admin/assistant';

// Oraculo independente: replica a definicao do dominio (inteiro em [1,5]).
function expectedValid(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
}

// ----- Geradores -----

// Mistura inteiros amplos, inteiros na vizinhanca do intervalo valido,
// doubles e nao-numeros para exercitar fronteiras (0, 1, 5, 6) e o ramo
// de tipo invalido.
const valueGen = fc.oneof(
  fc.integer(),
  fc.integer({ min: -2, max: 8 }), // enfase nas fronteiras do intervalo
  fc.double(),
  fc.constantFrom<unknown>(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    1,
    5,
    6,
    2.5,
    '3',
    'abc',
    true,
    null,
    undefined,
    {},
    [3]
  )
);

describe('CP-22: Validacao do intervalo do Cron_Job (inteiro 1..5)', () => {
  it('isValidCronInterval e verdadeiro sse inteiro em [1,5]', () => {
    fc.assert(
      fc.property(valueGen, (n) => {
        expect(isValidCronInterval(n)).toBe(expectedValid(n));
      }),
      { numRuns: 100 }
    );
  });
});
