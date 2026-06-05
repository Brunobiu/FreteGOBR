/**
 * Property-Based Tests — Invariante financeira do frete (Tarefa 4).
 *
 * Complementa `calculoFrete.property.test.ts` cobrindo:
 *   - Property 1: lucro_liquido = brutoRecebido - custoDiesel (consistência)
 *   - Modo per_ton: bruto = freteValue * cargoCapacityTon
 *   - Entradas extremas (NaN, Infinity) — documenta o comportamento atual
 *
 * Validates: Requirements 1.1, 1.2, 1.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateFreteFinanceiro, round2 } from '../utils/calculoFrete';
import { validFinancialAmount } from './_helpers/generators';

const dist = () => fc.integer({ min: 1, max: 5000 });
const kpl = () => fc.double({ min: 1, max: 10, noNaN: true, noDefaultInfinity: true });
const diesel = () => fc.double({ min: 1, max: 20, noNaN: true, noDefaultInfinity: true });

describe('Property 1 — invariante de consistência do lucro', () => {
  it('lucroLiquido === round2(brutoRecebido - custoDiesel) (modo closed)', () => {
    fc.assert(
      fc.property(dist(), kpl(), diesel(), validFinancialAmount(), (d, k, dp, fv) => {
        const out = calculateFreteFinanceiro({
          distanceKm: d,
          kmPerLiter: k,
          dieselPrice: dp,
          freteValue: fv,
        });
        expect(out.lucroLiquido).toBe(round2(out.brutoRecebido - out.custoDiesel));
        // No modo fechado, bruto recebido é o próprio freteValue.
        expect(out.brutoRecebido).toBe(fv);
      }),
      { numRuns: 300 }
    );
  });

  it('modo per_ton: brutoRecebido === round2(freteValue * cargoCapacityTon)', () => {
    fc.assert(
      fc.property(
        dist(),
        kpl(),
        diesel(),
        fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 80, noNaN: true, noDefaultInfinity: true }),
        (d, k, dp, pricePerTon, cap) => {
          const out = calculateFreteFinanceiro({
            distanceKm: d,
            kmPerLiter: k,
            dieselPrice: dp,
            freteValue: pricePerTon,
            cargoCapacityTon: cap,
            pricingMode: 'per_ton',
          });
          expect(out.brutoRecebido).toBe(round2(pricePerTon * cap));
          expect(out.lucroLiquido).toBe(round2(out.brutoRecebido - out.custoDiesel));
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('Property 1 — comportamento sob entradas extremas', () => {
  // Documenta o comportamento atual: a função não lança, mas propaga
  // NaN/Infinity. Os callers (UI) já só passam valores validados; este
  // teste fixa o contrato observável para evitar regressão silenciosa.
  it('kmPerLiter zero produz litros não-finito (custoDiesel propaga)', () => {
    const out = calculateFreteFinanceiro({
      distanceKm: 100,
      kmPerLiter: 0,
      dieselPrice: 5,
      freteValue: 1000,
    });
    expect(Number.isFinite(out.litros)).toBe(false);
  });

  it('freteValue NaN propaga para lucroLiquido como NaN', () => {
    const out = calculateFreteFinanceiro({
      distanceKm: 100,
      kmPerLiter: 2.5,
      dieselPrice: 5,
      freteValue: NaN,
    });
    expect(Number.isNaN(out.lucroLiquido)).toBe(true);
  });
});
