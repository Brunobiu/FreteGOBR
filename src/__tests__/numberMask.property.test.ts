/**
 * Property-Based Tests — Máscara numérica (Tarefa 8).
 *
 * Property 2 (round-trip): para todo número válido com N casas,
 * maskedToNumber(numberToMasked(n, N), N) ≈ n.
 * E unmask(mask(digits)) preserva os dígitos significativos.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { maskDecimal, unmaskDecimal, maskedToNumber, numberToMasked } from '../utils/numberMask';

describe('maskDecimal — formatação', () => {
  it('insere vírgula nas N casas decimais', () => {
    expect(maskDecimal('599', 2)).toBe('5,99');
    expect(maskDecimal('47000', 3)).toBe('47,000');
    expect(maskDecimal('25', 1)).toBe('2,5');
    expect(maskDecimal('5', 2)).toBe('0,05');
    expect(maskDecimal('', 2)).toBe('');
  });

  it('descarta não-dígitos antes de mascarar', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 4 }),
        (raw, dec) => {
          const masked = maskDecimal(raw, dec);
          // O resultado nunca contém letras.
          expect(masked).not.toMatch(/[a-zA-Z]/);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('Property 2 — round-trip número ↔ máscara', () => {
  it('maskedToNumber(numberToMasked(n, d), d) ≈ n', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 3 }),
        (n, d) => {
          const masked = numberToMasked(n, d);
          const back = maskedToNumber(masked, d);
          // Tolerância: a máscara trunca/arredonda para d casas.
          expect(Math.abs(back - Number(n.toFixed(d)))).toBeLessThan(Math.pow(10, -d) + 1e-9);
        }
      ),
      { numRuns: 400 }
    );
  });

  it('unmaskDecimal(maskDecimal(digits, d)) preserva valor numérico', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /\d/.test(s)),
        fc.integer({ min: 1, max: 3 }),
        (raw, d) => {
          const digits = raw.replace(/\D/g, '');
          if (digits === '') return;
          const masked = maskDecimal(digits, d);
          const unmasked = unmaskDecimal(masked);
          // O valor numérico dos dígitos é preservado (sem zeros à esquerda).
          expect(parseInt(unmasked, 10)).toBe(parseInt(digits, 10));
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('numberToMasked — bordas', () => {
  it('null/undefined/NaN ⇒ string vazia', () => {
    expect(numberToMasked(null, 2)).toBe('');
    expect(numberToMasked(undefined, 2)).toBe('');
    expect(numberToMasked(NaN, 2)).toBe('');
  });

  it('maskedToNumber("", d) ⇒ NaN', () => {
    expect(Number.isNaN(maskedToNumber('', 2))).toBe(true);
  });
});
