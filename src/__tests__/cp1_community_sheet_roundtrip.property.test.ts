/**
 * Property-Based Test — Frete Comunidade, Property 1: Round-trip do Modelo_Planilha.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 4.2, 4.3, 4.4, 5.2, 5.3
 *
 * Invariante: serializar linhas válidas no formato do Modelo_Planilha (CSV BOM
 * UTF-8 + `;` + `\r\n`, mesma ordem de colunas) e parsear de volta com
 * `parseCommunityCsv` reproduz linhas equivalentes (mesmos campos após
 * normalização) e `templateOk = true`.
 *
 * Convenções fast-check do projeto: nunca `fc.stringOf`; PII (telefone) via
 * `fc.constantFrom` de templates válidos; texto via `fc.string().filter`.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  COMMUNITY_SHEET_HEADER,
  buildModeloPlanilhaCsv,
  parseCommunityCsv,
  parseCommunityMatrix,
  validateTemplate,
  type ImportRow,
} from '../utils/communitySheet';

const SEP = ';';
const BOM = '\uFEFF';

/** Texto seguro sem `;`, aspas e quebras (evita ambiguidade de CSV no gerador). */
function plainText(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .string({ minLength: min, maxLength: max })
    .map((s) => s.replace(/[;"\r\n\u0001]/g, ' ').trim())
    .filter((s) => s.length >= Math.max(1, min) && s.length <= max);
}

const PHONES = ['62999998888', '11987654321', '21991234567', '48988887777'];

interface SheetRowInput {
  carrier: string;
  origin: string;
  destination: string;
  originDetail: string;
  destinationDetail: string;
  value: number;
  product: string;
  phone: string;
}

const rowArb: fc.Arbitrary<SheetRowInput> = fc.record({
  carrier: plainText(1, 40),
  origin: plainText(1, 30),
  destination: plainText(1, 30),
  originDetail: plainText(1, 40),
  destinationDetail: plainText(1, 40),
  value: fc.integer({ min: 1, max: 999999 }),
  product: plainText(1, 30),
  phone: fc.constantFrom(...PHONES),
});

function csvEscape(field: string): string {
  if (/[";\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/** Serializa as linhas no formato do modelo (header + linhas), com BOM. */
function serialize(rows: SheetRowInput[]): string {
  const header = COMMUNITY_SHEET_HEADER.map(csvEscape).join(SEP);
  const body = rows
    .map((r) =>
      [
        r.carrier,
        r.origin,
        r.destination,
        r.originDetail,
        r.destinationDetail,
        String(r.value),
        r.product,
        r.phone,
      ]
        .map(csvEscape)
        .join(SEP)
    )
    .join('\r\n');
  return `${BOM}${header}\r\n${body}`;
}

describe('Frete Comunidade — Property 1: round-trip do Modelo_Planilha', () => {
  it('serializar → parsear reproduz as linhas equivalentes (templateOk)', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 30 }), (rows) => {
        const csv = serialize(rows);
        const result = parseCommunityCsv(csv);

        expect(result.templateOk).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.rows).toHaveLength(rows.length);

        result.rows.forEach((parsed: ImportRow, i) => {
          const original = rows[i];
          expect(parsed.carrierName).toBe(original.carrier);
          expect(parsed.origin).toBe(original.origin);
          expect(parsed.destination).toBe(original.destination);
          expect(parsed.originDetail).toBe(original.originDetail);
          expect(parsed.destinationDetail).toBe(original.destinationDetail);
          expect(parsed.product).toBe(original.product);
          expect(parsed.value).toBe(original.value);
          expect(parsed.phoneNormalized).toBe(original.phone);
          // Todas as linhas geradas são válidas.
          expect(result.rowValidations[i].ok).toBe(true);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('o próprio Modelo_Planilha gerado tem cabeçalho válido e 1 linha de exemplo válida', () => {
    const csv = buildModeloPlanilhaCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const result = parseCommunityCsv(csv);
    expect(result.templateOk).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rowValidations[0].ok).toBe(true);
  });

  it('o cabeçalho do modelo passa na validateTemplate', () => {
    expect(validateTemplate([...COMMUNITY_SHEET_HEADER])).toBe(true);
    // Matriz só com cabeçalho (sem dados) → templateOk mas "não contém fretes".
    const res = parseCommunityMatrix([[...COMMUNITY_SHEET_HEADER]]);
    expect(res.templateOk).toBe(true);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toContain('A planilha não contém fretes.');
  });
});
