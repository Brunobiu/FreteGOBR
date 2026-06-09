/**
 * Property-Based Test — Frete Comunidade, Property 3: validação de linha
 * determinística e completa.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 6.3
 *
 * Invariante: `validateImportRow(row).ok` é `true` sse todos os 8 campos
 * obrigatórios estão presentes (não vazios após trim), `value` é numérico e
 * > 0, e o telefone normalizado é BR válido (10/11 dígitos). Caso contrário
 * `ok=false` com ao menos um fieldError apontando o campo. Revalidar é estável.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { validateImportRow, type ImportRow } from '../utils/communitySheet';
import { sanitizePhone, isValidPhoneBR } from '../utils/phoneFormat';

const PHONES_VALID = ['62999998888', '11987654321', '2133334444', '4830001122'];
const PHONES_INVALID = ['', '123', '999', '000000000000000', 'abc'];

function makeRow(over: Partial<ImportRow>): ImportRow {
  const base: ImportRow = {
    rowNumber: 1,
    carrierName: 'Transp X',
    origin: 'Goiânia - GO',
    destination: 'Uberlândia - MG',
    originDetail: 'Fazenda A',
    destinationDetail: 'Armazém B',
    value: 1000,
    product: 'Soja',
    phoneRaw: '62999998888',
    phoneNormalized: '62999998888',
    ...over,
  };
  return base;
}

describe('Frete Comunidade — Property 3: validação de linha', () => {
  it('linha completa e válida ⇒ ok=true; revalidar é estável', () => {
    fc.assert(
      fc.property(
        fc.record({
          carrierName: fc.constantFrom('Transp X', 'AB', 'Comunidade Trans Ltda'),
          origin: fc.constantFrom('Goiânia - GO', 'SP', 'Rio'),
          destination: fc.constantFrom('Uberlândia - MG', 'BA', 'PR'),
          originDetail: fc.constantFrom('Fazenda A', 'Pátio 1'),
          destinationDetail: fc.constantFrom('Armazém B', 'Doca 3'),
          value: fc.integer({ min: 1, max: 999999 }),
          product: fc.constantFrom('Soja', 'Milho', 'Adubo'),
          phone: fc.constantFrom(...PHONES_VALID),
        }),
        (r) => {
          const row = makeRow({
            carrierName: r.carrierName,
            origin: r.origin,
            destination: r.destination,
            originDetail: r.originDetail,
            destinationDetail: r.destinationDetail,
            value: r.value,
            product: r.product,
            phoneRaw: r.phone,
            phoneNormalized: sanitizePhone(r.phone),
          });
          const v1 = validateImportRow(row);
          const v2 = validateImportRow(row);
          expect(v1.ok).toBe(true);
          expect(v2).toEqual(v1); // determinismo
        }
      ),
      { numRuns: 100 }
    );
  });

  it('campo de texto vazio ⇒ REQUIRED no campo correspondente', () => {
    const fields: Array<keyof ImportRow> = [
      'carrierName',
      'origin',
      'destination',
      'originDetail',
      'destinationDetail',
      'product',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...fields),
        fc.constantFrom('', '   ', '\t'),
        (field, empty) => {
          const row = makeRow({ [field]: empty } as Partial<ImportRow>);
          const v = validateImportRow(row);
          expect(v.ok).toBe(false);
          expect(v.fieldErrors[field]).toBe('REQUIRED');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valor nulo ou <= 0 ⇒ INVALID_VALUE', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(null), fc.integer({ min: -5000, max: 0 })), (bad) => {
        const row = makeRow({ value: bad as number | null });
        const v = validateImportRow(row);
        expect(v.ok).toBe(false);
        expect(v.fieldErrors.value).toBe('INVALID_VALUE');
      }),
      { numRuns: 100 }
    );
  });

  it('telefone inválido ⇒ REQUIRED (vazio) ou INVALID_PHONE', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PHONES_INVALID), (bad) => {
        const row = makeRow({ phoneRaw: bad, phoneNormalized: sanitizePhone(bad) });
        const v = validateImportRow(row);
        expect(v.ok).toBe(false);
        expect(isValidPhoneBR(row.phoneNormalized)).toBe(false);
        expect(v.fieldErrors.phoneRaw).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});
