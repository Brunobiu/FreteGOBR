/**
 * Property-Based Test — WhatsApp Automation, Property 7:
 * Dispatch_Ready_List é única, sem espaços e sem inválidos.
 *
 * Feature: whatsapp-automation, Property 7: Dispatch_Ready_List é única, sem espaços e sem inválidos
 * Validates: Requirements 17.6, 17.9, 17.10
 *
 * Invariantes verificadas (≥100 runs) sobre `buildDispatchReadyList(numbers)` e
 * `dedupValidNumbers(numbers)` de `extractor.ts`:
 *   - A Dispatch_Ready_List é uma string de Contact_Numbers válidos, em dígitos
 *     (E.164 BR sem o `+`, `/^\d{12,13}$/`), juntados por vírgula SEM espaços
 *     (Req 17.6) — a saída inteira não contém nenhum caractere de espaço.
 *   - Números INVÁLIDOS são EXCLUÍDOS (Req 17.9) e duplicatas são removidas
 *     (Req 17.10): o conjunto de saída é exatamente o conjunto de dígitos
 *     esperado dos válidos presentes, sem repetição.
 *   - `dedupValidNumbers` é IDEMPOTENTE: aplicá-la duas vezes produz o mesmo
 *     resultado que aplicá-la uma vez (Req 17.10).
 *
 * Convenções do projeto (project-conventions / testing-governance):
 *   - Telefones via `fc.constantFrom` de templates fixos (válidos e inválidos),
 *     nunca dígitos aleatórios. NUNCA `fc.stringOf`.
 *   - `buildDispatchReadyList`/`dedupValidNumbers` são PURAS — sem mocks.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildDispatchReadyList,
  dedupValidNumbers,
} from '../../../services/admin/whatsapp/extractor';

/** Formato canônico de um Contact_Number na Dispatch_Ready_List: dígitos E.164 BR sem `+`. */
const DIGITS_BR = /^\d{12,13}$/;

/**
 * Templates fixos de números VÁLIDOS, em formatos variados (com/sem máscara,
 * com/sem código de país `55`, com espaços). Cada um carrega a forma em dígitos
 * (E.164 sem `+`) esperada na Dispatch_Ready_List, para asserções exatas.
 */
interface ValidTemplate {
  raw: string;
  digits: string;
}
const VALID_TEMPLATES: ValidTemplate[] = [
  { raw: '(62) 99999-8888', digits: '5562999998888' },
  { raw: '11987654321', digits: '5511987654321' },
  // Mesmo número do primeiro, mas já com DDI 55 — deve deduplicar.
  { raw: '5562999998888', digits: '5562999998888' },
  { raw: '+55 (21) 3333-4444', digits: '552133334444' },
  { raw: '48 98888-7777', digits: '5548988887777' },
  { raw: '(11) 3030-4040', digits: '551130304040' },
];

/**
 * Templates fixos de números INVÁLIDOS. Nenhum se torna válido após remover o
 * DDI; todos devem ser EXCLUÍDOS da Dispatch_Ready_List (Req 17.9).
 */
const INVALID_TEMPLATES: string[] = [
  '123',
  '999999999999999', // 15 dígitos
  'abc', // sem dígitos
  '5511', // 4 dígitos
  '12345678', // 8 dígitos
  '+1 555 0000', // 8 dígitos, não-BR
];

type Item = { kind: 'valid'; raw: string; digits: string } | { kind: 'invalid'; raw: string };

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  fc
    .constantFrom(...VALID_TEMPLATES)
    .map((t): Item => ({ kind: 'valid', raw: t.raw, digits: t.digits })),
  fc.constantFrom(...INVALID_TEMPLATES).map((s): Item => ({ kind: 'invalid', raw: s }))
);

/** Lista bruta de Contact_Numbers (válidos/ inválidos/ duplicados misturados). */
const numbersArb = fc.array(itemArb, { minLength: 0, maxLength: 30 });

/** Conjunto de dígitos esperado (válidos presentes, deduplicados). */
function expectedDigitsSet(items: Item[]): Set<string> {
  return new Set(
    items
      .filter((i): i is Extract<Item, { kind: 'valid' }> => i.kind === 'valid')
      .map((i) => i.digits)
  );
}

describe('WhatsApp Automation — Property 7: Dispatch_Ready_List única, sem espaços, sem inválidos', () => {
  it('saída é comma-joined de válidos únicos em dígitos, SEM espaços e SEM inválidos (Req 17.6, 17.9, 17.10)', () => {
    fc.assert(
      fc.property(numbersArb, (items) => {
        const list = buildDispatchReadyList(items.map((i) => i.raw));

        // NENHUM espaço em parte alguma da string (Req 17.6).
        expect(list).not.toMatch(/\s/);

        const parts = list.length === 0 ? [] : list.split(',');

        // Cada parte é um Contact_Number válido em dígitos (sem `+`, sem máscara).
        for (const part of parts) {
          expect(part).toMatch(DIGITS_BR);
        }

        // Sem duplicatas (Req 17.10).
        expect(new Set(parts).size).toBe(parts.length);

        // Conjunto de saída == válidos esperados; inválidos foram excluídos (Req 17.9).
        expect(new Set(parts)).toEqual(expectedDigitsSet(items));
      }),
      { numRuns: 100 }
    );
  });

  it('dedupValidNumbers é idempotente: aplicar duas vezes == uma vez (Req 17.10)', () => {
    fc.assert(
      fc.property(numbersArb, (items) => {
        const once = dedupValidNumbers(items.map((i) => i.raw));
        const twice = dedupValidNumbers(once);

        // Idempotência: a forma normalizada é um ponto fixo.
        expect(twice).toEqual(once);

        // A lista é unívoca e em dígitos canônicos.
        expect(new Set(once).size).toBe(once.length);
        for (const n of once) {
          expect(n).toMatch(DIGITS_BR);
        }

        // E coincide com o conjunto de válidos esperados.
        expect(new Set(once)).toEqual(expectedDigitsSet(items));
      }),
      { numRuns: 100 }
    );
  });

  it('apenas inválidos (ou vazio) ⇒ Dispatch_Ready_List vazia (Req 17.9)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...INVALID_TEMPLATES), { minLength: 0, maxLength: 10 }),
        (invalids) => {
          expect(buildDispatchReadyList(invalids)).toBe('');
          expect(dedupValidNumbers(invalids)).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
