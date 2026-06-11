/**
 * Property-Based Test (opcional) — Agrupamento por categoria sem perda.
 *
 * Feature: finalizacao-lancamento, Property 9: Agrupamento por categoria.
 * Validates: Requirements 8.3.
 *
 * groupByCategory sempre retorna as 5 categorias; cada registro aparece
 * exatamente uma vez na sua categoria; categoria sem registros vira lista
 * vazia (sem erro).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  groupByCategory,
  SETTING_CATEGORIES,
  type SettingCategory,
  type SettingRecord,
} from '../../../services/admin/settings';

function makeRecord(category: SettingCategory, key: string): SettingRecord {
  return {
    key,
    category,
    valueType: 'string',
    value: '',
    enumOptions: null,
    isReadonly: false,
    isSecret: false,
    secretIsSet: false,
    maskedValue: null,
    label: key,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Property 9: agrupamento por categoria sem perda (opcional)', () => {
  it('sempre retorna as 5 categorias e não perde registros', () => {
    const recordArb = fc
      .tuple(
        fc.constantFrom<SettingCategory>(...SETTING_CATEGORIES),
        fc.string({ minLength: 1, maxLength: 12 })
      )
      .map(([cat, key]) => makeRecord(cat, key));

    fc.assert(
      fc.property(fc.array(recordArb, { maxLength: 40 }), (records) => {
        const grouped = groupByCategory(records);
        // As 5 categorias sempre presentes.
        for (const cat of SETTING_CATEGORIES) {
          expect(Array.isArray(grouped[cat])).toBe(true);
        }
        // Soma das listas = total de registros (nenhum perdido/duplicado).
        const totalAgrupado = SETTING_CATEGORIES.reduce((acc, c) => acc + grouped[c].length, 0);
        expect(totalAgrupado).toBe(records.length);
        // Cada registro está na sua categoria.
        for (const cat of SETTING_CATEGORIES) {
          for (const rec of grouped[cat]) {
            expect(rec.category).toBe(cat);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('lista vazia produz as 5 categorias vazias', () => {
    const grouped = groupByCategory([]);
    for (const cat of SETTING_CATEGORIES) {
      expect(grouped[cat]).toEqual([]);
    }
  });
});
