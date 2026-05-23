/**
 * Property-Based Tests — Sanitização e formatação de CEP
 *
 * Validates: Requirements 1.2, 1.8 (motorista-perfil-extras)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sanitizeCep, formatCep, isValidCepFormat } from '../services/cep';

describe('sanitizeCep', () => {
  it('é idempotente', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = sanitizeCep(raw);
        const twice = sanitizeCep(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('produz somente dígitos', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(sanitizeCep(raw)).toMatch(/^\d*$/);
      }),
      { numRuns: 200 }
    );
  });
});

describe('formatCep', () => {
  it('output tem no máximo 9 caracteres (8 dígitos + 1 hífen)', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(formatCep(raw).length).toBeLessThanOrEqual(9);
      }),
      { numRuns: 200 }
    );
  });

  it('round-trip: sanitize(format(d)) === d para 0–8 dígitos', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{0,8}$/).filter((s) => s.length <= 8),
        (digits) => {
          expect(sanitizeCep(formatCep(digits))).toBe(digits);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('formato canônico: NNNNN-NNN para 8 dígitos', () => {
    expect(formatCep('01310100')).toBe('01310-100');
    expect(formatCep('74000000')).toBe('74000-000');
  });

  it('valores parciais (até 5 dígitos) sem hífen', () => {
    expect(formatCep('01310')).toBe('01310');
    expect(formatCep('013')).toBe('013');
  });
});

describe('isValidCepFormat', () => {
  it('isValidCepFormat(s) ⇔ sanitizeCep(s).length === 8', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const len = sanitizeCep(raw).length;
        expect(isValidCepFormat(raw)).toBe(len === 8);
      }),
      { numRuns: 200 }
    );
  });

  it('aceita CEP formatado (com hífen) válido', () => {
    expect(isValidCepFormat('01310-100')).toBe(true);
  });

  it('rejeita CEP curto', () => {
    expect(isValidCepFormat('01310-10')).toBe(false);
    expect(isValidCepFormat('123')).toBe(false);
  });
});
