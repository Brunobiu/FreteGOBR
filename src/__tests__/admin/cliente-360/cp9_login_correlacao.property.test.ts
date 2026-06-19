// Feature: admin-cliente-360, Property 9*: Correlacao de login por telefone (opcional).
//
// A correlacao inclui a tentativa SSE o telefone normalizado (so digitos) da
// tentativa e igual ao do Cliente; sem telefone do Cliente => conjunto vazio;
// invariante a mascara/formatacao.
//
// Validates: Requirements 12.2

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import {
  normalizePhoneForCorrelation,
  loginAttemptMatchesUser,
} from '../../../services/admin/cliente360/loginCorrelation';
import { validPhone } from '../../_helpers/generators';

const phoneOrEmpty = fc.oneof(validPhone(), fc.constantFrom<string | null>(null, '', ' ', '   '));

/** Reaplica formatacao arbitraria mantendo os mesmos digitos. */
function reformat(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length < 4) return d;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

describe('CP-9* correlacao de login por telefone', () => {
  it('casa sse digitos iguais; vazio sem telefone do Cliente', () => {
    fc.assert(
      fc.property(phoneOrEmpty, phoneOrEmpty, (attempt, user) => {
        const userDigits = normalizePhoneForCorrelation(user);
        const attemptDigits = normalizePhoneForCorrelation(attempt);
        const expected = userDigits.length > 0 && attemptDigits === userDigits;
        expect(loginAttemptMatchesUser(attempt, user)).toBe(expected);
        if (userDigits.length === 0) {
          expect(loginAttemptMatchesUser(attempt, user)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('e invariante a mascara/formatacao do mesmo numero', () => {
    fc.assert(
      fc.property(validPhone(), (phone) => {
        const digitsOnly = phone.replace(/\D/g, '');
        // mesmo numero, formatacoes diferentes => casam
        expect(loginAttemptMatchesUser(digitsOnly, phone)).toBe(true);
        expect(loginAttemptMatchesUser(reformat(phone), phone)).toBe(true);
        expect(loginAttemptMatchesUser(phone, digitsOnly)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});
