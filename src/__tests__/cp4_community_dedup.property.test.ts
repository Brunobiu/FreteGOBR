/**
 * Property-Based Test — Frete Comunidade, Property 4: Dedup por tupla completa.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 7.1, 7.2, 7.3, 7.8, 12.1, 12.3, 12.4, 12.6
 *
 * Invariantes:
 *   - `isDuplicate(a,b)` é true sse TODOS os componentes coincidem após
 *     normalização (texto trim+colapso+lowercase; valor 2 casas; phone só
 *     dígitos). Diferir em ≥1 componente ⇒ false.
 *   - Simétrico: isDuplicate(a,b) === isDuplicate(b,a).
 *   - `computeDedupKey` é idempotente sob renormalização e estável (entradas
 *     equivalentes colidem na mesma chave).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  computeDedupKey,
  isDuplicate,
  normalizeDedupText,
  type DedupFields,
} from '../utils/communityDedup';

const fieldArb: fc.Arbitrary<DedupFields> = fc.record({
  origin: fc.constantFrom('Goiânia - GO', 'São Paulo - SP', 'Rio - RJ'),
  destination: fc.constantFrom('Uberlândia - MG', 'Curitiba - PR', 'Salvador - BA'),
  originDetail: fc.constantFrom('Fazenda A', 'Pátio Central', ''),
  destinationDetail: fc.constantFrom('Armazém B', 'Doca 3', ''),
  value: fc.integer({ min: 1, max: 99999 }),
  product: fc.constantFrom('Soja', 'Milho', 'Adubo'),
  carrierName: fc.constantFrom('Transp A', 'Transp B', 'Comunidade X'),
  contactPhone: fc.constantFrom('62999998888', '11987654321', '2133334444'),
});

const COMPONENT_KEYS: Array<keyof DedupFields> = [
  'origin',
  'destination',
  'originDetail',
  'destinationDetail',
  'value',
  'product',
  'carrierName',
  'contactPhone',
];

describe('Frete Comunidade — Property 4: dedup por tupla completa', () => {
  it('tuplas idênticas ⇒ duplicado; simétrico', () => {
    fc.assert(
      fc.property(fieldArb, (f) => {
        const copy = { ...f };
        expect(isDuplicate(f, copy)).toBe(true);
        expect(isDuplicate(copy, f)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('diferir em UM único componente ⇒ NÃO duplicado', () => {
    fc.assert(
      fc.property(fieldArb, fc.constantFrom(...COMPONENT_KEYS), (f, key) => {
        const other: DedupFields = { ...f };
        if (key === 'value') {
          other.value = f.value + 1; // garante diferença numérica
        } else if (key === 'contactPhone') {
          // telefone normaliza para só dígitos: anexar dígito garante diferença
          other.contactPhone = `${f.contactPhone}9`;
        } else {
          // muda o texto para algo garantidamente diferente após normalização
          other[key] = (String(f[key]) + ' ZZZ') as never;
        }
        expect(isDuplicate(f, other)).toBe(false);
        expect(isDuplicate(other, f)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('chave é estável sob variação de caixa e espaços (equivalentes colidem)', () => {
    fc.assert(
      fc.property(fieldArb, (f) => {
        const noisy: DedupFields = {
          ...f,
          origin: `  ${f.origin.toUpperCase()}  `,
          destination: f.destination.replace(/ /g, '   '),
          carrierName: ` ${f.carrierName} `,
          contactPhone: `(${f.contactPhone.slice(0, 2)}) ${f.contactPhone.slice(2)}`,
          value: f.value, // mesmo valor
        };
        expect(computeDedupKey(noisy)).toBe(computeDedupKey(f));
        expect(isDuplicate(noisy, f)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('computeDedupKey é idempotente sob renormalização do texto', () => {
    fc.assert(
      fc.property(fieldArb, (f) => {
        const renorm: DedupFields = {
          ...f,
          origin: normalizeDedupText(f.origin),
          destination: normalizeDedupText(f.destination),
          originDetail: normalizeDedupText(f.originDetail),
          destinationDetail: normalizeDedupText(f.destinationDetail),
          product: normalizeDedupText(f.product),
          carrierName: normalizeDedupText(f.carrierName),
        };
        expect(computeDedupKey(renorm)).toBe(computeDedupKey(f));
      }),
      { numRuns: 100 }
    );
  });
});
