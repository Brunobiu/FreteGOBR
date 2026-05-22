/**
 * Property-Based Tests — Normalização e validação do PIS
 *
 * Property 6 (Design Section 10): a UI do MotoristaPerfilPage normaliza
 * o input do PIS para conter SOMENTE dígitos, com no máximo 11 chars.
 * A validação considera: vazio = aviso amarelo (permite salvar);
 * length === 11 = válido; outros lengths = bloqueia.
 *
 * Validates: Requirements 9.2, 9.3, 9.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// Função pura espelhando a normalização aplicada no onChange do PIS
function normalizePis(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 11);
}

// Status de validação espelhando o submit
type PisStatus = 'empty' | 'valid' | 'invalid';

function classifyPis(raw: string): PisStatus {
  const norm = normalizePis(raw);
  if (norm.length === 0) return 'empty';
  if (norm.length === 11) return 'valid';
  return 'invalid';
}

describe('normalizePis', () => {
  it('produz somente dígitos', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(normalizePis(raw)).toMatch(/^\d*$/);
      }),
      { numRuns: 200 }
    );
  });

  it('produz no máximo 11 caracteres', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(normalizePis(raw).length).toBeLessThanOrEqual(11);
      }),
      { numRuns: 200 }
    );
  });

  it('é idempotente', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = normalizePis(raw);
        const twice = normalizePis(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it('preserva os dígitos originais (em ordem) até o limite de 11', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const expected = raw.replace(/\D/g, '').slice(0, 11);
        expect(normalizePis(raw)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
});

describe('classifyPis', () => {
  it('PIS vazio → status "empty" (permite salvar)', () => {
    expect(classifyPis('')).toBe('empty');
    expect(classifyPis('   ')).toBe('empty');
    expect(classifyPis('---')).toBe('empty');
  });

  it('PIS com 11 dígitos exatos → status "valid"', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{11}$/).filter((s) => s.length === 11),
        (s) => {
          expect(classifyPis(s)).toBe('valid');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PIS com 1 a 10 dígitos → status "invalid"', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (len) => {
        const s = '1'.repeat(len);
        expect(classifyPis(s)).toBe('invalid');
      }),
      { numRuns: 50 }
    );
  });

  it('classificação considera apenas dígitos, ignorando outros chars', () => {
    expect(classifyPis('123.456.789-01')).toBe('valid'); // 11 dígitos
    expect(classifyPis('123.456')).toBe('invalid'); // 6 dígitos
  });
});
