/**
 * Property-Based Tests — Regras de comissão (Tarefa 5).
 *
 * Cobre `computeCommission` e `validateBrackets` de
 * `services/admin/financeiro.ts` (Critical_Module, paridade SQL CP-1).
 *
 * Property 1 (consistência): valor_liquido = round2(valor_bruto - commission_value).
 * Cobre ramos: flat_default, flat, bracket, bracket_max_inclusive.
 *
 * Validates: Requirements 1.4, 1.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeCommission,
  validateBrackets,
  type FinanceiroSettings,
  type CommissionBracket,
} from '../../../services/admin/financeiro';

const round2 = (n: number) => Math.round(n * 100) / 100;

const valorBrutoArb = () =>
  fc.oneof(
    fc.double({ min: 0, max: 500_000, noNaN: true, noDefaultInfinity: true }),
    fc.constantFrom(NaN, Infinity, -Infinity, -1, 0)
  );

const settingsFlat = (pct: number): FinanceiroSettings => ({
  id: 'cfg-1',
  commission_pct: pct,
  commission_brackets: [],
  effective_from: null,
  updated_at: null,
  updated_by: null,
});

describe('computeCommission — Property 1 (consistência)', () => {
  it('valor_liquido === round2(valor_normalizado - commission_value) sempre', () => {
    fc.assert(
      fc.property(valorBrutoArb(), fc.double({ min: 0, max: 50, noNaN: true }), (bruto, pct) => {
        const r = computeCommission(bruto, settingsFlat(pct));
        // valor normalizado: negativo/NaN/Infinity viram 0.
        const v = !Number.isFinite(bruto) || bruto < 0 ? 0 : bruto;
        expect(r.valor_liquido).toBe(round2(v - r.commission_value));
      }),
      { numRuns: 400 }
    );
  });

  it('commission_value nunca excede o valor bruto normalizado (pct <= 50)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 500_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (bruto, pct) => {
          const r = computeCommission(bruto, settingsFlat(pct));
          expect(r.commission_value).toBeLessThanOrEqual(round2(bruto) + 1e-6);
          expect(r.commission_value).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('computeCommission — ramos de decisão', () => {
  it('settings null ⇒ flat_default 0%', () => {
    const r = computeCommission(1000, null);
    expect(r.resolved_via).toBe('flat_default');
    expect(r.commission_pct).toBe(0);
    expect(r.commission_value).toBe(0);
    expect(r.valor_liquido).toBe(1000);
  });

  it('settings com id null (sentinel fresh) ⇒ flat_default', () => {
    const sentinel: FinanceiroSettings = {
      id: null,
      commission_pct: 10,
      commission_brackets: [],
      effective_from: null,
      updated_at: null,
      updated_by: null,
    };
    expect(computeCommission(1000, sentinel).resolved_via).toBe('flat_default');
  });

  it('brackets vazios ⇒ flat', () => {
    const r = computeCommission(1000, settingsFlat(10));
    expect(r.resolved_via).toBe('flat');
    expect(r.commission_pct).toBe(10);
    expect(r.commission_value).toBe(100);
    expect(r.valor_liquido).toBe(900);
  });

  it('valor dentro de [min, max) ⇒ bracket', () => {
    const brackets: CommissionBracket[] = [
      { min_value: 0, max_value: 1000, pct: 5 },
      { min_value: 1000, max_value: 5000, pct: 10 },
    ];
    const settings: FinanceiroSettings = {
      id: 'cfg',
      commission_pct: 20,
      commission_brackets: brackets,
      effective_from: null,
      updated_at: null,
      updated_by: null,
    };
    const r = computeCommission(2000, settings);
    expect(r.resolved_via).toBe('bracket');
    expect(r.commission_pct).toBe(10);
  });

  it('valor === max_value da última faixa ⇒ bracket_max_inclusive', () => {
    const brackets: CommissionBracket[] = [{ min_value: 0, max_value: 5000, pct: 8 }];
    const settings: FinanceiroSettings = {
      id: 'cfg',
      commission_pct: 20,
      commission_brackets: brackets,
      effective_from: null,
      updated_at: null,
      updated_by: null,
    };
    const r = computeCommission(5000, settings);
    expect(r.resolved_via).toBe('bracket_max_inclusive');
    expect(r.commission_pct).toBe(8);
  });

  it('valor acima do teto da última faixa ⇒ cai no flat', () => {
    const brackets: CommissionBracket[] = [{ min_value: 0, max_value: 5000, pct: 8 }];
    const settings: FinanceiroSettings = {
      id: 'cfg',
      commission_pct: 20,
      commission_brackets: brackets,
      effective_from: null,
      updated_at: null,
      updated_by: null,
    };
    const r = computeCommission(9999, settings);
    expect(r.resolved_via).toBe('flat');
    expect(r.commission_pct).toBe(20);
  });
});

describe('validateBrackets', () => {
  it('array vazio é ok (só flat)', () => {
    expect(validateBrackets([])).toEqual({ ok: true });
  });

  it('mais de 5 faixas ⇒ BRACKETS_TOO_MANY', () => {
    const six: CommissionBracket[] = Array.from({ length: 6 }, (_, i) => ({
      min_value: i * 1000,
      max_value: (i + 1) * 1000,
      pct: 5,
    }));
    expect(validateBrackets(six)).toMatchObject({ ok: false, code: 'BRACKETS_TOO_MANY' });
  });

  it('pct fora de [0,50] ⇒ INVALID_BRACKETS com index', () => {
    const b: CommissionBracket[] = [{ min_value: 0, max_value: 1000, pct: 99 }];
    expect(validateBrackets(b)).toMatchObject({ ok: false, code: 'INVALID_BRACKETS', index: 0 });
  });

  it('faixas fora de ordem ⇒ BRACKETS_OUT_OF_ORDER', () => {
    const b: CommissionBracket[] = [
      { min_value: 1000, max_value: 2000, pct: 5 },
      { min_value: 500, max_value: 3000, pct: 6 },
    ];
    expect(validateBrackets(b)).toMatchObject({
      ok: false,
      code: 'BRACKETS_OUT_OF_ORDER',
      index: 1,
    });
  });

  it('faixas contíguas e crescentes ⇒ ok', () => {
    const b: CommissionBracket[] = [
      { min_value: 0, max_value: 1000, pct: 5 },
      { min_value: 1000, max_value: 5000, pct: 10 },
    ];
    expect(validateBrackets(b)).toEqual({ ok: true });
  });

  it('gap entre faixas ⇒ BRACKETS_GAP', () => {
    const b: CommissionBracket[] = [
      { min_value: 0, max_value: 1000, pct: 5 },
      { min_value: 2000, max_value: 5000, pct: 10 },
    ];
    expect(validateBrackets(b)).toMatchObject({ ok: false, code: 'BRACKETS_GAP', index: 1 });
  });
});
