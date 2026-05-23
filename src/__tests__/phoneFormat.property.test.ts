/**
 * Property-Based Tests — Formatação de telefone BR
 *
 * Validates: Requirement 12.4 (motorista-perfil-extras)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sanitizePhone, formatPhoneBR, isValidPhoneBR } from '../utils/phoneFormat';

describe('sanitizePhone', () => {
  it('é idempotente', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = sanitizePhone(raw);
        const twice = sanitizePhone(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('produz somente dígitos', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(sanitizePhone(raw)).toMatch(/^\d*$/);
      }),
      { numRuns: 200 }
    );
  });

  it('preserva os dígitos originais (em ordem)', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const expected = raw.replace(/\D/g, '');
        expect(sanitizePhone(raw)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
});

describe('formatPhoneBR', () => {
  it('preserva dígitos (até 11) após formatação e re-sanitização', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const sanitized = sanitizePhone(raw).slice(0, 11);
        expect(sanitizePhone(formatPhoneBR(raw))).toBe(sanitized);
      }),
      { numRuns: 200 }
    );
  });

  it('formato 10 dígitos: (DD) NNNN-NNNN', () => {
    expect(formatPhoneBR('6233334444')).toBe('(62) 3333-4444');
  });

  it('formato 11 dígitos (celular): (DD) N NNNN-NNNN', () => {
    expect(formatPhoneBR('62988881234')).toBe('(62) 9 8888-1234');
  });

  it('vazio retorna vazio', () => {
    expect(formatPhoneBR('')).toBe('');
  });
});

describe('isValidPhoneBR', () => {
  it('aceita exatamente 10 ou 11 dígitos', () => {
    expect(isValidPhoneBR('6233334444')).toBe(true);
    expect(isValidPhoneBR('62988881234')).toBe(true);
    expect(isValidPhoneBR('62988881')).toBe(false);
    expect(isValidPhoneBR('629888812345')).toBe(false);
    expect(isValidPhoneBR('')).toBe(false);
  });

  it('isValidPhoneBR(s) ⇔ sanitizePhone(s).length ∈ {10, 11}', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const len = sanitizePhone(raw).length;
        expect(isValidPhoneBR(raw)).toBe(len === 10 || len === 11);
      }),
      { numRuns: 200 }
    );
  });
});
