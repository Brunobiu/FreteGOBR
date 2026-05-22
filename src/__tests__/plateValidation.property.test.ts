/**
 * Property-Based Tests — Validação de placa Mercosul
 *
 * Property 1 (Design Section 10): formatPlate é idempotente, recorta
 * em 7 chars e isValidMercosulPlate aceita exatamente o regex
 * `^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$`.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatPlate, isValidMercosulPlate, PLATE_REGEX } from '../utils/plateValidation';

const upperLetter = () => fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
const digit = () => fc.constantFrom(...'0123456789'.split(''));
const alnum = () => fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''));

describe('formatPlate', () => {
  it('é idempotente (formatPlate(formatPlate(x)) === formatPlate(x))', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = formatPlate(raw);
        const twice = formatPlate(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('produz no máximo 7 caracteres', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(formatPlate(raw).length).toBeLessThanOrEqual(7);
      }),
      { numRuns: 200 }
    );
  });

  it('produz somente caracteres alfanuméricos maiúsculos', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const out = formatPlate(raw);
        expect(out).toMatch(/^[A-Z0-9]*$/);
      }),
      { numRuns: 200 }
    );
  });

  it('preserva caracteres alfanuméricos em ordem (até 7)', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const expected = raw
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 7);
        expect(formatPlate(raw)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
});

describe('isValidMercosulPlate', () => {
  it('aceita placas no formato canônico ABC1D23', () => {
    fc.assert(
      fc.property(
        upperLetter(),
        upperLetter(),
        upperLetter(),
        digit(),
        upperLetter(),
        digit(),
        digit(),
        (l1, l2, l3, d1, l4, d2, d3) => {
          const plate = `${l1}${l2}${l3}${d1}${l4}${d2}${d3}`;
          expect(isValidMercosulPlate(plate)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('aceita placas legadas ABC1D23 com dígito na 5ª posição (Mercosul aceita letra OU dígito)', () => {
    // Posição 5 pode ser letra ou dígito (ABC1234 OU ABC1D23)
    fc.assert(
      fc.property(
        upperLetter(),
        upperLetter(),
        upperLetter(),
        digit(),
        alnum(),
        digit(),
        digit(),
        (l1, l2, l3, d1, x, d2, d3) => {
          const plate = `${l1}${l2}${l3}${d1}${x}${d2}${d3}`;
          // Apenas letra ou dígito é aceito na 5ª — o regex cobre ambos
          expect(isValidMercosulPlate(plate)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('rejeita placas com menos de 7 caracteres', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 6 }).filter((s) => /^[A-Z0-9]*$/.test(s)),
        (s) => {
          expect(isValidMercosulPlate(s)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejeita ABCD123 (4ª posição letra em vez de dígito)', () => {
    expect(isValidMercosulPlate('ABCD123')).toBe(false);
  });

  it('rejeita AB12D34 (2 letras + 2 dígitos no início)', () => {
    expect(isValidMercosulPlate('AB12D34')).toBe(false);
  });

  it('rejeita placas com caracteres especiais que não somem ao normalizar (excesso de chars)', () => {
    // formatPlate strips non-alphanumeric, então "ABC-1D23X" → "ABC1D23X" → "ABC1D23" (truncado em 7).
    // Mas "AB!CD123" → "ABCD123" → 4ª posição é letra → inválido.
    expect(isValidMercosulPlate('AB!CD123')).toBe(false);
    expect(isValidMercosulPlate('ABCD-123')).toBe(false);
  });

  it('PLATE_REGEX casa exatamente 7 chars no padrão Mercosul', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const formatted = formatPlate(raw);
        const isValid = isValidMercosulPlate(raw);
        expect(isValid).toBe(PLATE_REGEX.test(formatted));
      }),
      { numRuns: 200 }
    );
  });
});
