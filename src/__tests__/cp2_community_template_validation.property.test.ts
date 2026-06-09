/**
 * Property-Based Test — Frete Comunidade, Property 2: Template_Validation exata.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 5.9, 5.10
 *
 * Invariante: `validateTemplate(header)` é `true` se e somente se `header` é
 * exatamente igual a COMMUNITY_SHEET_HEADER (mesmas colunas, mesma ordem, após
 * trim/lowercase). Qualquer coluna faltando, sobrando, renomeada ou fora de
 * ordem ⇒ `false`, e o parse sinaliza erro de template (INVALID_TEMPLATE).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  COMMUNITY_SHEET_HEADER,
  validateTemplate,
  parseCommunityMatrix,
} from '../utils/communitySheet';

const HEADER = [...COMMUNITY_SHEET_HEADER];

describe('Frete Comunidade — Property 2: Template_Validation exata', () => {
  it('aceita o cabeçalho canônico mesmo com variação de caixa/espaços', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: HEADER.length, maxLength: HEADER.length }),
        (upper) => {
          const noisy = HEADER.map((c, i) => {
            const cased = upper[i] ? c.toUpperCase() : c;
            return `  ${cased}  `; // espaços nas pontas são tolerados (trim)
          });
          expect(validateTemplate(noisy)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejeita cabeçalho com coluna faltando, sobrando, renomeada ou fora de ordem', () => {
    const mutations: fc.Arbitrary<string[]> = fc.oneof(
      // coluna faltando
      fc.integer({ min: 0, max: HEADER.length - 1 }).map((i) => HEADER.filter((_, idx) => idx !== i)),
      // coluna sobrando
      fc.constant<string[]>([...HEADER, 'coluna extra']),
      // coluna renomeada
      fc.integer({ min: 0, max: HEADER.length - 1 }).map((i) =>
        HEADER.map((c, idx) => (idx === i ? c + '_x' : c))
      ),
      // duas colunas trocadas de ordem
      fc
        .tuple(
          fc.integer({ min: 0, max: HEADER.length - 1 }),
          fc.integer({ min: 0, max: HEADER.length - 1 })
        )
        .filter(([a, b]) => a !== b)
        .map(([a, b]) => {
          const copy = [...HEADER];
          const tmp = copy[a];
          copy[a] = copy[b];
          copy[b] = tmp;
          return copy;
        })
    );

    fc.assert(
      fc.property(mutations, (badHeader) => {
        expect(validateTemplate(badHeader)).toBe(false);
        const res = parseCommunityMatrix([badHeader, ['x', 'x', 'x', 'x', 'x', '1', 'x', '62999998888']]);
        expect(res.templateOk).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
        expect(res.rows).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('matriz vazia ⇒ templateOk false', () => {
    expect(parseCommunityMatrix([]).templateOk).toBe(false);
  });
});
