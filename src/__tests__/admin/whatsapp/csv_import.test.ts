// Feature: whatsapp-automation, Task 8.4: testes unitários de CSV_Import
/**
 * Testes do CSV_Import do WhatsApp_Module (`parseContactsCsv`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md Requirements 24.1–24.5, 24.9, 24.10
 * Design: design.md → seção CSV / `CSV_Import` (lógica pura, sem I/O).
 *
 * Cobre, sobre a função pura `parseContactsCsv` de `csv.ts`:
 *  - leitura do Contact_Number + colunas mapeadas de Recipient_Data (Req 24.1, 24.2);
 *  - linha inválida reportada com nº da linha + motivo, SEM descarte silencioso
 *    (Req 24.3): ausente / inválido / duplicado;
 *  - arquivo inválido ou sem coluna de Contact_Number ⇒ Canonical_Message pt-BR
 *    `Não foi possível importar o arquivo.` (Req 24.4);
 *  - resumo lido/importado/inválido (Req 24.5);
 *  - tolerância a BOM UTF-8 e a `\r\n` (convenção herdada, Req 24.6).
 *
 * **Validates: Requirements 24.3, 24.4** (complementa o CSV_Export coberto em
 * `csv_export.test.ts` e o round-trip de escaping em `cp10_csv_escaping`).
 *
 * Convenções (project-conventions / testing-governance):
 *  - mensagens user-facing em pt-BR; NUNCA `fc.stringOf`; telefones de templates
 *    fixos via `fc.constantFrom`; `parseContactsCsv` é PURA — sem mocks.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  parseContactsCsv,
  toCsv,
  CSV_BOM,
  CSV_SEPARATOR,
  WHATSAPP_CSV_IMPORT_ERROR_MESSAGE,
} from '../../../services/admin/whatsapp/csv';
import { normalizeNumbers } from '../../../services/admin/whatsapp/validation';

/** Motivos canônicos (pt-BR) espelhando os reportados pela implementação. */
const REASON = {
  MISSING: 'Número de telefone ausente.',
  INVALID: 'Número de telefone inválido.',
  DUPLICATE: 'Número duplicado.',
} as const;

const E164_BR = /^\+55\d{10,11}$/;

/* -------------------------------------------------------------------------- *
 * Arquivo inválido / sem coluna (Req 24.4)                                   *
 * -------------------------------------------------------------------------- */

describe('CSV_Import — arquivo inválido ⇒ Canonical_Message pt-BR (Req 24.4)', () => {
  it('exporta a Canonical_Message esperada', () => {
    expect(WHATSAPP_CSV_IMPORT_ERROR_MESSAGE).toBe('Não foi possível importar o arquivo.');
  });

  it('texto vazio (sem cabeçalho) lança a Canonical_Message', () => {
    expect(() => parseContactsCsv('')).toThrow(WHATSAPP_CSV_IMPORT_ERROR_MESSAGE);
  });

  it('apenas o BOM (conteúdo vazio) lança a Canonical_Message', () => {
    expect(() => parseContactsCsv(CSV_BOM)).toThrow(WHATSAPP_CSV_IMPORT_ERROR_MESSAGE);
  });

  it('cabeçalho sem coluna de Contact_Number detectável lança a Canonical_Message', () => {
    const csv = toCsv([
      ['nome', 'cidade'],
      ['Ana', 'SP'],
    ]);
    expect(() => parseContactsCsv(csv)).toThrow(WHATSAPP_CSV_IMPORT_ERROR_MESSAGE);
  });

  it('columnMap.contactNumber apontando para header inexistente lança a Canonical_Message', () => {
    const csv = toCsv([
      ['telefone', 'nome'],
      ['11987654321', 'Ana'],
    ]);
    expect(() => parseContactsCsv(csv, { contactNumber: 'coluna_que_nao_existe' })).toThrow(
      WHATSAPP_CSV_IMPORT_ERROR_MESSAGE
    );
  });
});

/* -------------------------------------------------------------------------- *
 * Detecção de coluna de Contact_Number (Req 24.1)                            *
 * -------------------------------------------------------------------------- */

describe('CSV_Import — detecção da coluna de Contact_Number (Req 24.1)', () => {
  it('detecta a coluna por nome comum, ignorando acentos/caixa/espaços', () => {
    // "Número " normaliza para "numero" (candidato reconhecido).
    const csv = toCsv([
      ['Nome', 'Número '],
      ['Ana', '11987654321'],
    ]);
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([{ phone: '+5511987654321', recipientData: { Nome: 'Ana' } }]);
  });

  it('respeita columnMap.contactNumber explícito (sobrepõe a detecção)', () => {
    const csv = toCsv([
      ['telefone', 'celular_real'],
      ['00000', '11987654321'],
    ]);
    // Sem map, "telefone" (idx 0) seria detectado; o map força a 2ª coluna.
    const result = parseContactsCsv(csv, { contactNumber: 'celular_real' });
    expect(result.contacts.map((c) => c.phone)).toEqual(['+5511987654321']);
  });
});

/* -------------------------------------------------------------------------- *
 * Linha inválida reportada com nº + motivo, sem descarte silencioso (24.3)   *
 * -------------------------------------------------------------------------- */

describe('CSV_Import — linha inválida reportada (nº + motivo), sem descarte (Req 24.3)', () => {
  it('reporta ausente / inválido / duplicado com o número de linha correto', () => {
    // Linha 1 = cabeçalho. Dados começam na linha 2.
    const csv = toCsv([
      ['telefone', 'nome'], // linha 1
      ['11987654321', 'Ana'], // linha 2 — válido
      ['', 'SemNumero'], // linha 3 — ausente
      ['123', 'Invalido'], // linha 4 — inválido
      ['(11) 98765-4321', 'Duplicado'], // linha 5 — dup de +5511987654321
    ]);

    const result = parseContactsCsv(csv);

    expect(result.contacts).toEqual([{ phone: '+5511987654321', recipientData: { nome: 'Ana' } }]);
    expect(result.invalidRows).toEqual([
      { line: 3, value: '', reason: REASON.MISSING },
      { line: 4, value: '123', reason: REASON.INVALID },
      { line: 5, value: '(11) 98765-4321', reason: REASON.DUPLICATE },
    ]);
    // Resumo (Req 24.5): nada é descartado em silêncio.
    expect(result.totalRead).toBe(4);
    expect(result.importedCount).toBe(1);
    expect(result.invalidCount).toBe(3);
    expect(result.importedCount + result.invalidCount).toBe(result.totalRead);
  });

  it('célula só com espaços conta como número ausente (trim)', () => {
    const csv = toCsv([
      ['telefone', 'nome'],
      ['   ', 'Espacos'],
    ]);
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([]);
    expect(result.invalidRows).toEqual([{ line: 2, value: '', reason: REASON.MISSING }]);
  });
});

/* -------------------------------------------------------------------------- *
 * Recipient_Data — automático e via columnMap (Req 24.2)                     *
 * -------------------------------------------------------------------------- */

describe('CSV_Import — Recipient_Data das colunas mapeadas (Req 24.2)', () => {
  it('sem columnMap: todas as colunas não-telefone viram Recipient_Data pelo header', () => {
    const csv = toCsv([
      ['telefone', 'nome', 'empresa'],
      ['11987654321', 'Ana', 'Acme'],
      ['(62) 99999-8888', 'Beto', 'Beta'],
    ]);
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([
      { phone: '+5511987654321', recipientData: { nome: 'Ana', empresa: 'Acme' } },
      { phone: '+5562999998888', recipientData: { nome: 'Beto', empresa: 'Beta' } },
    ]);
  });

  it('células vazias de Recipient_Data são ignoradas (não viram chave vazia)', () => {
    const csv = toCsv([
      ['telefone', 'nome', 'empresa'],
      ['11987654321', '', 'Acme'],
    ]);
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([
      { phone: '+5511987654321', recipientData: { empresa: 'Acme' } },
    ]);
  });

  it('headers vazios são ignorados na detecção automática de Recipient_Data', () => {
    // Header do meio é vazio: não deve virar chave de Recipient_Data.
    const csv = toCsv([
      ['telefone', '', 'nome'],
      ['11987654321', 'lixo', 'Ana'],
    ]);
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([{ phone: '+5511987654321', recipientData: { nome: 'Ana' } }]);
  });

  it('columnMap.recipientData mapeia chaves de negócio para headers do arquivo', () => {
    const csv = toCsv([
      ['phone', 'Full Name', 'Company'],
      ['11987654321', 'Maria', 'Acme'],
    ]);
    const result = parseContactsCsv(csv, {
      contactNumber: 'phone',
      recipientData: { nome: 'Full Name', empresa: 'Company' },
    });
    expect(result.contacts).toEqual([
      { phone: '+5511987654321', recipientData: { nome: 'Maria', empresa: 'Acme' } },
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * Tolerância a BOM e \r\n; arquivo só com cabeçalho (Req 24.5, 24.6)         *
 * -------------------------------------------------------------------------- */

describe('CSV_Import — BOM, \\r\\n e arquivo só com cabeçalho', () => {
  it('tolera o BOM UTF-8 e a quebra \\r\\n produzidos pela convenção do projeto', () => {
    // Construído manualmente para garantir BOM + CRLF explícitos.
    const csv = `${CSV_BOM}telefone${CSV_SEPARATOR}nome\r\n11987654321${CSV_SEPARATOR}Ana\r\n`;
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([{ phone: '+5511987654321', recipientData: { nome: 'Ana' } }]);
    expect(result.invalidRows).toEqual([]);
  });

  it('arquivo só com cabeçalho (sem linhas de dados) não lança e retorna resumo zerado', () => {
    const csv = toCsv([['telefone', 'nome']]);
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([]);
    expect(result.invalidRows).toEqual([]);
    expect(result.totalRead).toBe(0);
    expect(result.importedCount).toBe(0);
    expect(result.invalidCount).toBe(0);
  });

  it('linhas totalmente em branco são ignoradas (não inflam totalRead/inválidos)', () => {
    // Quebra de linha final + linha vazia no meio: nenhuma vira "número ausente".
    const csv = `${CSV_BOM}telefone${CSV_SEPARATOR}nome\r\n11987654321${CSV_SEPARATOR}Ana\r\n\r\n`;
    const result = parseContactsCsv(csv);
    expect(result.contacts).toEqual([{ phone: '+5511987654321', recipientData: { nome: 'Ana' } }]);
    expect(result.invalidRows).toEqual([]);
    expect(result.totalRead).toBe(1);
  });
});

/* -------------------------------------------------------------------------- *
 * Property: nenhuma linha de dados é descartada em silêncio (Req 24.3)       *
 * -------------------------------------------------------------------------- */

// Templates fixos (válidos/inválidos/ausente). Telefones via constantFrom —
// nunca dígitos aleatórios; NUNCA `fc.stringOf`.
type CellItem =
  | { kind: 'valid'; raw: string; e164: string }
  | { kind: 'invalid'; raw: string }
  | { kind: 'missing'; raw: string };

const VALID: Array<{ raw: string; e164: string }> = [
  { raw: '11987654321', e164: '+5511987654321' },
  { raw: '(62) 99999-8888', e164: '+5562999998888' },
  { raw: '5562999998888', e164: '+5562999998888' }, // dup do anterior
  { raw: '48 98888-7777', e164: '+5548988887777' },
];
const INVALID: string[] = ['123', 'abc', '5511', '12345678'];
const MISSING: string[] = ['', '   ', '\t'];

const cellArb: fc.Arbitrary<CellItem> = fc.oneof(
  fc.constantFrom(...VALID).map((t): CellItem => ({ kind: 'valid', ...t })),
  fc.constantFrom(...INVALID).map((s): CellItem => ({ kind: 'invalid', raw: s })),
  fc.constantFrom(...MISSING).map((s): CellItem => ({ kind: 'missing', raw: s }))
);

describe('CSV_Import — Property: cada linha de dados é contato OU inválida (Req 24.3)', () => {
  it('importedCount + invalidCount === totalRead (sem descarte silencioso)', () => {
    fc.assert(
      fc.property(fc.array(cellArb, { minLength: 1, maxLength: 40 }), (cells) => {
        const rows: string[][] = [['telefone', 'nome']];
        cells.forEach((c, i) => rows.push([c.raw, `n${i}`]));
        const csv = toCsv(rows);

        const result = parseContactsCsv(csv);

        // Toda linha de dados foi contabilizada exatamente uma vez.
        expect(result.totalRead).toBe(cells.length);
        expect(result.importedCount + result.invalidCount).toBe(result.totalRead);
        expect(result.importedCount).toBe(result.contacts.length);
        expect(result.invalidCount).toBe(result.invalidRows.length);

        // Contatos: E.164 BR, sem duplicatas.
        for (const c of result.contacts) expect(c.phone).toMatch(E164_BR);
        const phones = result.contacts.map((c) => c.phone);
        expect(new Set(phones).size).toBe(phones.length);

        // Inválidos: linha no intervalo [2, totalRead+1], crescente, motivo canônico.
        const reasons = new Set<string>([REASON.MISSING, REASON.INVALID, REASON.DUPLICATE]);
        let prevLine = 1;
        for (const row of result.invalidRows) {
          expect(row.line).toBeGreaterThanOrEqual(2);
          expect(row.line).toBeLessThanOrEqual(cells.length + 1);
          expect(row.line).toBeGreaterThan(prevLine);
          prevLine = row.line;
          expect(reasons.has(row.reason)).toBe(true);
        }

        // Total de válidos = nº de E.164 únicos entre as células válidas.
        const expectedUnique = new Set(
          cells
            .filter((c): c is Extract<CellItem, { kind: 'valid' }> => c.kind === 'valid')
            .map((c) => c.e164)
        );
        expect(result.importedCount).toBe(expectedUnique.size);
      }),
      { numRuns: 100 }
    );
  });

  it('coerência com normalizeNumbers: o conjunto de contatos = válidos únicos', () => {
    fc.assert(
      fc.property(fc.array(cellArb, { minLength: 1, maxLength: 40 }), (cells) => {
        const rows: string[][] = [['telefone']];
        cells.forEach((c) => rows.push([c.raw]));
        const result = parseContactsCsv(toCsv(rows));

        // Renormalizar os telefones colados deve produzir o mesmo conjunto.
        const joined = cells.map((c) => c.raw).join('\n');
        const { valid } = normalizeNumbers(joined);
        expect(new Set(result.contacts.map((c) => c.phone))).toEqual(new Set(valid));
      }),
      { numRuns: 100 }
    );
  });
});
