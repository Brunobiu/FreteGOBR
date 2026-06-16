// Feature: whatsapp-automation, Property 10: Escaping de CSV conforme a convenção do projeto (round-trip)
/**
 * CP-10: Property test do escaping de CSV herdado do FreteGO.
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md Requirement 24.6
 * Design: design.md → seção CSV / `toCsv`/`parseCsv` (lógica pura, sem I/O).
 *
 * **Validates: Requirements 24.6**
 *
 * Property 10 — para qualquer matriz retangular de campos string (incluindo
 * campos com `;`, `"`, `\n`, `\r` e `\r\n`):
 *
 *  P10.1 (round-trip) `parseCsv(toCsv(rows))` reconstrói exatamente `rows`.
 *  P10.2 (escape RFC 4180) campos com `"`, `;`, `\n` ou `\r` são envolvidos
 *        em aspas duplas e a aspa interna é duplicada; demais campos ficam crus.
 *  P10.3 (separador `;` + quebra `\r\n`) a serialização usa exatamente esses
 *        delimitadores fora de aspas.
 *  P10.4 (BOM) a saída começa com o BOM UTF-8 e o parser o tolera.
 *
 * Nota sobre a ambiguidade inerente do CSV: uma matriz `[['']]` (uma única
 * linha com um único campo vazio) serializa para um corpo vazio, indistinguível
 * de um arquivo vazio (que `parseCsv` mapeia para `[]`, por convenção). Esse é
 * o único ponto em que a igualdade de round-trip não é bem definida — não é um
 * bug de escaping, e sim a limitação clássica do formato. O gerador exclui
 * exatamente esse caso degenerado para manter a propriedade bem definida
 * (conforme orientação da task: rows retangulares, round-trip bem definido).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  toCsv,
  parseCsv,
  csvEscape,
  CSV_BOM,
  CSV_SEPARATOR,
  CSV_LINE_BREAK,
} from '../../../services/admin/whatsapp/csv';

// Caracteres "perigosos" do CSV injetados deliberadamente, além de texto comum.
// NÃO usamos `fc.stringOf` (não existe no projeto): compomos cada campo a partir
// de pedaços de `fc.string(...)` e injeções via `fc.constantFrom`.
const SPECIAL_CHUNK = fc.constantFrom(
  ';', // separador
  '"', // aspa (escape RFC 4180 → duplicada)
  '""', // aspa dupla literal
  '\n', // LF dentro de campo
  '\r', // CR dentro de campo
  '\r\n', // CRLF dentro de campo
  ',', // vírgula (Dispatch_Ready_List usa, mas no CSV é campo comum)
  ' ', // espaço
  '' // vazio
);

// Um campo = concatenação de pedaços de texto livre e pedaços especiais.
const FIELD_GEN: fc.Arbitrary<string> = fc
  .array(fc.oneof(fc.string({ minLength: 0, maxLength: 6 }), SPECIAL_CHUNK), {
    minLength: 0,
    maxLength: 6,
  })
  .map((parts) => parts.join(''));

// Matriz RETANGULAR: escolhe nº de colunas e nº de linhas e gera campos.
// Garante mesma contagem de colunas em todas as linhas (round-trip bem definido).
const MATRIX_GEN: fc.Arbitrary<string[][]> = fc
  .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 8 }))
  .chain(([cols, rows]) =>
    fc.array(fc.array(FIELD_GEN, { minLength: cols, maxLength: cols }), {
      minLength: rows,
      maxLength: rows,
    })
  )
  // Exclui o único caso degenerado [['']] (corpo serializado vazio ⇒ ambíguo).
  .filter((m) => !(m.length === 1 && m[0].length === 1 && m[0][0] === ''));

const FIELD_NEEDS_QUOTING = /[";\n\r]/;

describe('CP-10: CSV escaping (round-trip) — toCsv / parseCsv', () => {
  // P10.1 — round-trip exato
  it('parseCsv(toCsv(rows)) reconstrói exatamente a matriz original', () => {
    fc.assert(
      fc.property(MATRIX_GEN, (rows) => {
        const roundTripped = parseCsv(toCsv(rows));
        expect(roundTripped).toEqual(rows);
      }),
      { numRuns: 100 }
    );
  });

  // P10.2 — escape RFC 4180 por campo
  it('campos com aspas/;/quebras são citados e aspa interna é duplicada', () => {
    fc.assert(
      fc.property(FIELD_GEN, (field) => {
        const escaped = csvEscape(field);
        if (FIELD_NEEDS_QUOTING.test(field)) {
          // Envolvido em aspas duplas.
          expect(escaped.startsWith('"')).toBe(true);
          expect(escaped.endsWith('"')).toBe(true);
          // Conteúdo interno = aspa duplicada; desfazer reconstrói o original.
          const inner = escaped.slice(1, -1);
          expect(inner.replace(/""/g, '"')).toBe(field);
        } else {
          // Campo "seguro" não é alterado.
          expect(escaped).toBe(field);
        }
      }),
      { numRuns: 100 }
    );
  });

  // P10.3 — separador ';' e quebra '\r\n' são os delimitadores
  it('usa separador ";" e quebra "\\r\\n" como delimitadores de registro', () => {
    fc.assert(
      fc.property(MATRIX_GEN, (rows) => {
        const csv = toCsv(rows);
        const body = csv.slice(CSV_BOM.length);
        // Reconstrói o corpo esperado a partir dos campos escapados.
        const expectedBody = rows
          .map((row) => row.map(csvEscape).join(CSV_SEPARATOR))
          .join(CSV_LINE_BREAK);
        expect(body).toBe(expectedBody);
        // O parser usa exatamente esses delimitadores: round-trip confirma.
        expect(parseCsv(csv)).toEqual(rows);
      }),
      { numRuns: 100 }
    );
  });

  // P10.4 — BOM presente e tolerado pelo parser
  it('prefixa BOM UTF-8 e o parser tolera tanto com quanto sem BOM', () => {
    fc.assert(
      fc.property(MATRIX_GEN, (rows) => {
        const csv = toCsv(rows);
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        // Com BOM → matriz original.
        expect(parseCsv(csv)).toEqual(rows);
        // Sem BOM → mesma matriz (BOM é opcional na entrada).
        expect(parseCsv(csv.slice(CSV_BOM.length))).toEqual(rows);
      }),
      { numRuns: 100 }
    );
  });

  // Exemplos fixos (sanidade) cobrindo os caracteres-alvo explicitamente.
  it('exemplos canônicos com ; " \\n \\r round-trip corretamente', () => {
    const cases: string[][][] = [
      [
        ['nome', 'telefone'],
        ['Maria; José', '+5511988887777'],
      ],
      [['campo "com aspas"', 'linha1\nlinha2']],
      [['cr\rinside', 'crlf\r\ninside', 'normal']],
      [
        ['', 'a', ''],
        ['b', '', 'c'],
      ],
      [['só;ponto;e;vírgula']],
    ];
    for (const rows of cases) {
      expect(parseCsv(toCsv(rows))).toEqual(rows);
    }
  });
});
