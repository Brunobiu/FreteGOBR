/**
 * Property-Based Test — Frete Comunidade, Property 7: City_Resolution é
 * pré-condição de publicação.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 6.7, 8.3, 15.4, 15.5, 15.8
 *
 * Invariante: uma Import_Row é elegível para publicação sse:
 *   - `validateImportRow(row).ok` (todos os campos válidos), E
 *   - origem E destino estão resolvidas (coordenadas), E
 *   - não foi marcada como excluída.
 * Linha com cidade pendente NUNCA é elegível; o km só importa quando ambas
 * as cidades estão resolvidas.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  type ImportRow,
  type RowPublishState,
  validateImportRow,
  isRowPublishable,
  normalizeCommunityPhone,
} from '../utils/communitySheet';

/** Gera uma ImportRow potencialmente válida ou inválida. */
const importRowArb: fc.Arbitrary<ImportRow> = fc
  .record({
    carrierName: fc.constantFrom('Transp A', 'Transp B', '', '   '),
    origin: fc.constantFrom('Goiânia - GO', 'GYN', ''),
    destination: fc.constantFrom('Uberlândia - MG', 'UDI', ''),
    originDetail: fc.constantFrom('Fazenda A', ''),
    destinationDetail: fc.constantFrom('Armazém B', ''),
    value: fc.constantFrom(8500, 0, -10, null),
    product: fc.constantFrom('Soja', ''),
    phone: fc.constantFrom('(62) 99999-8888', '62999998888', '123', ''),
  })
  .map((r): ImportRow => ({
    rowNumber: 1,
    carrierName: r.carrierName,
    origin: r.origin,
    destination: r.destination,
    originDetail: r.originDetail,
    destinationDetail: r.destinationDetail,
    value: r.value as number | null,
    product: r.product,
    phoneRaw: r.phone,
    phoneNormalized: normalizeCommunityPhone(r.phone),
  }));

const stateArb: fc.Arbitrary<RowPublishState> = fc.record({
  originResolved: fc.boolean(),
  destinationResolved: fc.boolean(),
  excluded: fc.boolean(),
});

describe('Frete Comunidade — Property 7: City_Resolution pré-condição', () => {
  it('elegível sse válida E ambas cidades resolvidas E não excluída', () => {
    fc.assert(
      fc.property(importRowArb, stateArb, (row, state) => {
        const expected =
          !state.excluded &&
          state.originResolved &&
          state.destinationResolved &&
          validateImportRow(row).ok;
        expect(isRowPublishable(row, state)).toBe(expected);
      }),
      { numRuns: 300 }
    );
  });

  it('cidade pendente (origem OU destino não resolvida) ⇒ NUNCA elegível', () => {
    fc.assert(
      fc.property(
        importRowArb,
        fc.boolean(),
        fc.boolean(),
        (row, originResolved, destinationResolved) => {
          // Pelo menos uma pendente.
          if (originResolved && destinationResolved) return; // caso fora do escopo
          const state: RowPublishState = {
            originResolved,
            destinationResolved,
            excluded: false,
          };
          expect(isRowPublishable(row, state)).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('excluída ⇒ nunca elegível, mesmo válida e resolvida', () => {
    fc.assert(
      fc.property(importRowArb, (row) => {
        const state: RowPublishState = {
          originResolved: true,
          destinationResolved: true,
          excluded: true,
        };
        expect(isRowPublishable(row, state)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('linha totalmente válida + resolvida + não excluída ⇒ elegível', () => {
    const validRow: ImportRow = {
      rowNumber: 1,
      carrierName: 'Transportadora Exemplo',
      origin: 'Goiânia - GO',
      destination: 'Uberlândia - MG',
      originDetail: 'Fazenda Boa Vista',
      destinationDetail: 'Armazém Central',
      value: 8500,
      product: 'Soja em grãos',
      phoneRaw: '(62) 99999-8888',
      phoneNormalized: normalizeCommunityPhone('(62) 99999-8888'),
    };
    expect(validateImportRow(validRow).ok).toBe(true);
    expect(
      isRowPublishable(validRow, {
        originResolved: true,
        destinationResolved: true,
        excluded: false,
      })
    ).toBe(true);
  });
});
