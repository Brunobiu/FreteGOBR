/**
 * Property-Based Test — WhatsApp Automation, Property 4:
 * Normalização, deduplicação e validação de Contact_Numbers.
 *
 * Feature: whatsapp-automation, Property 4: Normalização, dedup e validação de contatos
 * Validates: Requirements 5.1, 5.2, 5.3, 5.5, 24.2
 *
 * Invariantes verificadas (≥100 runs) sobre `normalizeNumbers(raw)`:
 *   - Para qualquer entrada com números separados por vírgula, quebra de linha
 *     ou ambos (Req 5.1), todo item em `valid` é um E.164 BR normalizado
 *     (`/^\+55\d{10,11}$/`) sem espaços/pontuação (Req 5.2).
 *   - `valid` não contém duplicatas (Req 5.3).
 *   - `invalid` corresponde exatamente aos números rejeitados, deduplicados
 *     (Req 5.5) — nenhum válido vaza para `invalid` e vice-versa.
 *   - Idempotência: renormalizar a saída válida produz o mesmo conjunto e
 *     nenhum inválido (Req 5.2/5.3 — a forma E.164 é um ponto fixo).
 *
 * Convenções do projeto (project-conventions / testing-governance):
 *   - Telefones via `fc.constantFrom` de templates fixos (válidos e inválidos),
 *     nunca dígitos aleatórios.
 *   - NUNCA `fc.stringOf`. `normalizeNumbers` é PURA — sem mocks.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { normalizeNumbers } from '../../../services/admin/whatsapp/validation';
import { sanitizePhone } from '../../../utils/phoneFormat';

/** Formato canônico esperado de um Contact_Number válido normalizado. */
const E164_BR = /^\+55\d{10,11}$/;

/**
 * Templates fixos de números VÁLIDOS, em formatos variados (com/sem máscara,
 * com/sem código de país `55`, com espaços). Cada um carrega o E.164 canônico
 * esperado para permitir asserções exatas de deduplicação.
 */
interface ValidTemplate {
  raw: string;
  e164: string;
}
const VALID_TEMPLATES: ValidTemplate[] = [
  { raw: '(62) 99999-8888', e164: '+5562999998888' },
  { raw: '11987654321', e164: '+5511987654321' },
  // Mesmo número do primeiro, mas já com DDI 55 — deve deduplicar.
  { raw: '5562999998888', e164: '+5562999998888' },
  { raw: '+55 (21) 3333-4444', e164: '+552133334444' },
  { raw: '48 98888-7777', e164: '+5548988887777' },
  { raw: '(11) 3030-4040', e164: '+551130304040' },
];

/**
 * Templates fixos de números INVÁLIDOS. Nenhum contém `,`/`\n`/`\r` (para não
 * serem quebrados pelo separador) e nenhum se torna válido após remover o DDI.
 */
const INVALID_TEMPLATES: string[] = [
  '123',
  '999999999999999', // 15 dígitos
  'abc', // sem dígitos
  '5511', // 4 dígitos
  '12345678', // 8 dígitos
  '+1 555 0000', // 8 dígitos, não-BR
];

/** Separadores que misturam vírgula, quebra de linha e ambos (Req 5.1). */
const SEPARATORS = [',', '\n', '\r', ',\n', '\n,', ', ', ' , ', '\r\n', ',,', '\n\n'];

type Item = { kind: 'valid'; raw: string; e164: string } | { kind: 'invalid'; raw: string };

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  fc
    .constantFrom(...VALID_TEMPLATES)
    .map((t): Item => ({ kind: 'valid', raw: t.raw, e164: t.e164 })),
  fc.constantFrom(...INVALID_TEMPLATES).map((s): Item => ({ kind: 'invalid', raw: s }))
);

/** Conjunto de itens + separadores por lacuna, para montar o texto bruto. */
const scenarioArb = fc.record({
  items: fc.array(itemArb, { minLength: 1, maxLength: 25 }),
  seps: fc.array(fc.constantFrom(...SEPARATORS), { minLength: 1, maxLength: 30 }),
});

/** Monta o Contact_Number_List bruto intercalando tokens e separadores. */
function buildRaw(items: Item[], seps: string[]): string {
  return items.map((it, i) => (i === 0 ? it.raw : seps[i % seps.length] + it.raw)).join('');
}

/** Chave de deduplicação de inválidos, espelhando a lógica da implementação. */
function invalidKey(raw: string): string {
  const digits = sanitizePhone(raw);
  return digits.length > 0 ? digits : raw.trim();
}

describe('WhatsApp Automation — Property 4: normalização/dedup/validação de contatos', () => {
  it('valid só contém E.164 BR normalizado, sem duplicatas (Req 5.2, 5.3)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, seps }) => {
        const { valid } = normalizeNumbers(buildRaw(items, seps));

        // Todo válido é E.164 BR (sem espaços/pontuação).
        for (const v of valid) {
          expect(v).toMatch(E164_BR);
        }
        // Sem duplicatas.
        expect(new Set(valid).size).toBe(valid.length);

        // O conjunto válido é exatamente o esperado pelos templates.
        const expectedValid = new Set(
          items
            .filter((i): i is Extract<Item, { kind: 'valid' }> => i.kind === 'valid')
            .map((i) => i.e164)
        );
        expect(new Set(valid)).toEqual(expectedValid);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid corresponde exatamente aos rejeitados, deduplicado (Req 5.5)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, seps }) => {
        const { valid, invalid } = normalizeNumbers(buildRaw(items, seps));

        const expectedInvalidKeys = new Set(
          items.filter((i) => i.kind === 'invalid').map((i) => invalidKey(i.raw))
        );

        // Quantidade de inválidos = nº de chaves únicas rejeitadas.
        expect(invalid.length).toBe(expectedInvalidKeys.size);
        // Mesmo conjunto de chaves (deduplicado).
        expect(new Set(invalid.map(invalidKey))).toEqual(expectedInvalidKeys);
        // Inválidos nunca são E.164; válidos e inválidos são disjuntos.
        for (const bad of invalid) {
          expect(bad).not.toMatch(E164_BR);
        }
        expect(valid.some((v) => invalid.includes(v))).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('renormalizar a saída válida é idempotente (Req 5.2, 5.3)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, seps }) => {
        const first = normalizeNumbers(buildRaw(items, seps));
        // Junta os E.164 válidos por vírgula e reprocessa.
        const again = normalizeNumbers(first.valid.join(','));

        expect(new Set(again.valid)).toEqual(new Set(first.valid));
        expect(again.valid.length).toBe(first.valid.length);
        expect(again.invalid).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it('entrada vazia ou só separadores ⇒ ambos vazios (Req 5.1)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SEPARATORS, '   ', ''), { minLength: 0, maxLength: 10 }),
        (chunks) => {
          const result = normalizeNumbers(chunks.join(''));
          expect(result.valid).toEqual([]);
          expect(result.invalid).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
