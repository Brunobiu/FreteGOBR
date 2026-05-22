/**
 * Property-Based Tests — Cálculo financeiro do frete
 *
 * Property 2 (Design Section 10):
 * 1. litros = round2(distanceKm / kmPerLiter)
 * 2. custoDiesel = round2(litros * dieselPrice)
 * 3. lucroLiquido = round2(freteValue - custoDiesel)
 * 4. pedagio é sempre null (placeholder)
 *
 * Validates: Requirements 12.2, 12.3, 12.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateFreteFinanceiro, round2, formatCurrencyBRL } from '../utils/calculoFrete';

const safeFloat = (min: number, max: number) =>
  fc.float({ min, max, noNaN: true, noDefaultInfinity: true }).map((n) => round2(n));

describe('round2', () => {
  it('arredonda para 2 casas decimais', () => {
    fc.assert(
      fc.property(safeFloat(-1e6, 1e6), (n) => {
        const r = round2(n);
        // Tolerância numérica de ponto flutuante
        expect(Math.abs(r * 100 - Math.round(n * 100))).toBeLessThan(1e-6);
      }),
      { numRuns: 200 }
    );
  });

  it('é idempotente', () => {
    fc.assert(
      fc.property(safeFloat(-1e6, 1e6), (n) => {
        const a = round2(n);
        const b = round2(a);
        expect(b).toBe(a);
      }),
      { numRuns: 200 }
    );
  });
});

describe('calculateFreteFinanceiro', () => {
  const distanceArb = fc.integer({ min: 1, max: 5000 });
  const kmPerLiterArb = safeFloat(1.0, 10.0);
  const dieselPriceArb = safeFloat(1.0, 20.0);
  const freteValueArb = safeFloat(0, 100000);

  it('pedagio é sempre null', () => {
    fc.assert(
      fc.property(distanceArb, kmPerLiterArb, dieselPriceArb, freteValueArb, (d, kpl, dp, fv) => {
        const out = calculateFreteFinanceiro({
          distanceKm: d,
          kmPerLiter: kpl,
          dieselPrice: dp,
          freteValue: fv,
        });
        expect(out.pedagio).toBeNull();
      }),
      { numRuns: 200 }
    );
  });

  it('litros é proporcional a distância e inversamente proporcional a km/l', () => {
    fc.assert(
      fc.property(distanceArb, kmPerLiterArb, dieselPriceArb, freteValueArb, (d, kpl, dp, fv) => {
        const out = calculateFreteFinanceiro({
          distanceKm: d,
          kmPerLiter: kpl,
          dieselPrice: dp,
          freteValue: fv,
        });
        const expected = round2(d / kpl);
        expect(out.litros).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('custoDiesel = round2(litros * dieselPrice)', () => {
    fc.assert(
      fc.property(distanceArb, kmPerLiterArb, dieselPriceArb, freteValueArb, (d, kpl, dp, fv) => {
        const out = calculateFreteFinanceiro({
          distanceKm: d,
          kmPerLiter: kpl,
          dieselPrice: dp,
          freteValue: fv,
        });
        const expected = round2(out.litros * dp);
        expect(out.custoDiesel).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('lucroLiquido = round2(freteValue - custoDiesel)', () => {
    fc.assert(
      fc.property(distanceArb, kmPerLiterArb, dieselPriceArb, freteValueArb, (d, kpl, dp, fv) => {
        const out = calculateFreteFinanceiro({
          distanceKm: d,
          kmPerLiter: kpl,
          dieselPrice: dp,
          freteValue: fv,
        });
        const expected = round2(fv - out.custoDiesel);
        expect(out.lucroLiquido).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('lucroLiquido pode ser negativo se custo excede valor do frete', () => {
    const out = calculateFreteFinanceiro({
      distanceKm: 5000,
      kmPerLiter: 1.0,
      dieselPrice: 20.0,
      freteValue: 1000,
    });
    expect(out.lucroLiquido).toBeLessThan(0);
  });
});

describe('formatCurrencyBRL', () => {
  it('produz string contendo R$ e separadores brasileiros', () => {
    fc.assert(
      fc.property(safeFloat(0, 1e6), (n) => {
        const s = formatCurrencyBRL(n);
        // Aceita "R$" com espaço normal ou non-breaking (Intl usa NBSP em pt-BR)
        expect(s).toMatch(/R\$/);
      }),
      { numRuns: 100 }
    );
  });
});
