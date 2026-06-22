// Feature: marketplace, Property 4
/**
 * CP-4: Formatação BRL estável
 *
 * Para qualquer valor `v >= 0` finito, `formatBRL(v)`:
 *  - começa com "R$ ";
 *  - agrupa milhares com ".";
 *  - omite a parte decimal quando `v` é inteiro;
 *  - inclui duas casas com "," quando há centavos;
 *  - é determinística.
 *
 * Lógica pura (sem I/O), então não há mocks.
 *
 * Validates: Requirements 6.4, 7.4 (Property 4)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { formatBRL, groupThousands } from '../../utils/marketplacePost';

/** Apenas os dígitos da string formatada. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

describe('CP-4: formatBRL', () => {
  it('prefixo "R$ " e dígitos coerentes com reais/centavos', () => {
    fc.assert(
      // Gera centavos inteiros para evitar imprecisão de ponto flutuante.
      fc.property(fc.integer({ min: 0, max: 500_000_000 }), (totalCents) => {
        const value = totalCents / 100;
        const out = formatBRL(value);

        expect(out.startsWith('R$ ')).toBe(true);

        const reais = Math.floor(totalCents / 100);
        const cents = totalCents % 100;
        if (cents === 0) {
          // Inteiro ⇒ sem vírgula decimal; dígitos == reais.
          expect(out).not.toContain(',');
          expect(digitsOnly(out)).toBe(String(reais));
        } else {
          // Com centavos ⇒ vírgula + 2 casas; dígitos == reais + centavos(2).
          expect(out).toContain(',');
          expect(digitsOnly(out)).toBe(`${reais}${String(cents).padStart(2, '0')}`);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('agrupa milhares com "." para valores inteiros >= 1000', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 1_000_000_000 }), (reais) => {
        const out = formatBRL(reais);
        expect(out).toContain('.');
        expect(digitsOnly(out)).toBe(String(reais));
      }),
      { numRuns: 100 }
    );
  });

  it('é determinística', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }), (v) => {
        expect(formatBRL(v)).toBe(formatBRL(v));
      }),
      { numRuns: 100 }
    );
  });

  it('exemplos concretos', () => {
    expect(formatBRL(65000)).toBe('R$ 65.000');
    expect(formatBRL(5000)).toBe('R$ 5.000');
    expect(formatBRL(42000)).toBe('R$ 42.000');
    expect(formatBRL(1250.5)).toBe('R$ 1.250,50');
    expect(formatBRL(1000.05)).toBe('R$ 1.000,05');
    expect(formatBRL(5)).toBe('R$ 5');
    expect(formatBRL(0)).toBe('R$ 0');
    expect(formatBRL(0.05)).toBe('R$ 0,05');
    expect(formatBRL(1_000_000)).toBe('R$ 1.000.000');
  });
});

describe('groupThousands (máscara do campo de valor)', () => {
  it('agrupa milhares e ignora não-dígitos', () => {
    expect(groupThousands('56000')).toBe('56.000');
    expect(groupThousands('1000000')).toBe('1.000.000');
    expect(groupThousands('999')).toBe('999');
    expect(groupThousands('')).toBe('');
    expect(groupThousands('R$ 56.000')).toBe('56.000');
  });

  it('dígitos extraídos da saída reconstroem o número inteiro', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (n) => {
        expect(groupThousands(String(n)).replace(/\D/g, '')).toBe(String(n));
      }),
      { numRuns: 100 }
    );
  });
});
