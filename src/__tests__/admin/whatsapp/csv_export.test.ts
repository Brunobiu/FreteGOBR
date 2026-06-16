// Feature: whatsapp-automation, Task 8.3: CSV_Export (contatos e resultados)
/**
 * Testes do CSV_Export do WhatsApp_Module.
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md Requirements 24.6, 24.7, 24.8
 * Design: design.md → seção CSV / `CSV_Export` (lógica pura, sem I/O).
 *
 * Cobre, sobre as funções puras de `csv.ts`:
 *  - escape RFC 4180 + BOM + separador `;` + quebra `\r\n` (Req 24.6) —
 *    reusa `toCsv`, já property-tested em P10 (cp10);
 *  - truncamento em 10000 linhas com `truncated:true` (Req 24.7);
 *  - filename `whatsapp_<YYYYMMDD>_<HHmm>.csv` (Req 24.8);
 *  - distinção da Dispatch_Ready_List separada por vírgula (Req 17.7): o
 *    separador do export é sempre `;`.
 *
 * **Validates: Requirements 24.6, 24.7, 24.8**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildWhatsappCsvFilename,
  buildCsvExport,
  exportContactsCsv,
  exportDispatchResultsCsv,
  parseCsv,
  CSV_BOM,
  CSV_MAX_ROWS,
  CSV_EXPORT_CONTACT_PHONE_HEADER,
  CSV_EXPORT_RESULT_HEADER,
} from '../../../services/admin/whatsapp/csv';

const FILENAME_RE = /^whatsapp_\d{8}_\d{4}\.csv$/;

describe('CSV_Export — filename whatsapp_<YYYYMMDD>_<HHmm>.csv (Req 24.8)', () => {
  it('deriva o filename em UTC a partir de uma data fixa', () => {
    const date = new Date('2024-01-15T12:34:56.789Z');
    expect(buildWhatsappCsvFilename(date)).toBe('whatsapp_20240115_1234.csv');
  });

  it('zera segundos/milissegundos (precisão de minuto)', () => {
    const date = new Date('2026-12-31T23:59:01.500Z');
    expect(buildWhatsappCsvFilename(date)).toBe('whatsapp_20261231_2359.csv');
  });

  it('property: qualquer data produz o padrão whatsapp_<YYYYMMDD>_<HHmm>.csv', () => {
    fc.assert(
      fc.property(
        // Datas válidas dentro de um intervalo razoável (epoch ms).
        fc.integer({ min: 0, max: 4_102_444_800_000 }), // 1970..2100
        (ms) => {
          const filename = buildWhatsappCsvFilename(new Date(ms));
          expect(filename).toMatch(FILENAME_RE);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('CSV_Export — truncamento em 10000 linhas (Req 24.7)', () => {
  it('não trunca quando o total (cabeçalho incluído) é <= 10000 linhas', () => {
    // 9999 linhas de dados + 1 cabeçalho = 10000 linhas exatas.
    const rows = [['h']].concat(Array.from({ length: CSV_MAX_ROWS - 1 }, (_, i) => [String(i)]));
    const result = buildCsvExport(rows);
    expect(result.truncated).toBe(false);
    expect(parseCsv(result.csv)).toHaveLength(CSV_MAX_ROWS);
  });

  it('trunca e marca truncated=true quando excede 10000 linhas', () => {
    const rows = [['h']].concat(Array.from({ length: CSV_MAX_ROWS }, (_, i) => [String(i)]));
    const result = buildCsvExport(rows);
    expect(result.truncated).toBe(true);
    // O conteúdo serializado tem no máximo 10000 linhas (cabeçalho incluído).
    expect(parseCsv(result.csv)).toHaveLength(CSV_MAX_ROWS);
  });
});

describe('CSV_Export — convenção herdada (Req 24.6) e distinção da vírgula (Req 17.7)', () => {
  it('prefixa BOM, usa separador ";" e escapa RFC 4180', () => {
    const { csv } = buildCsvExport([
      ['telefone', 'nome'],
      ['+5511988887777', 'Maria; José'],
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(CSV_BOM.length);
    // Campo com `;` é citado; o separador real é `;`.
    expect(body).toContain('telefone;nome');
    expect(body).toContain('"Maria; José"');
    // Round-trip confirma a estrutura.
    expect(parseCsv(csv)).toEqual([
      ['telefone', 'nome'],
      ['+5511988887777', 'Maria; José'],
    ]);
  });
});

describe('CSV_Export — contatos (Req 24.6, 24.10)', () => {
  it('cabeçalho = telefone + união determinística das chaves de Recipient_Data', () => {
    const result = exportContactsCsv([
      { phone: '+5511988887777', recipientData: { nome: 'Ana', empresa: 'Acme' } },
      { phone: '+5511977776666', recipientData: { nome: 'Beto', cidade: 'SP' } },
    ]);
    const parsed = parseCsv(result.csv);
    expect(parsed[0]).toEqual([CSV_EXPORT_CONTACT_PHONE_HEADER, 'nome', 'empresa', 'cidade']);
    // Chave ausente para um contato vira célula vazia (empresa do 2º contato).
    expect(parsed[1]).toEqual(['+5511988887777', 'Ana', 'Acme', '']);
    expect(parsed[2]).toEqual(['+5511977776666', 'Beto', '', 'SP']);
    expect(result.filename).toMatch(FILENAME_RE);
  });

  it('lista vazia gera apenas o cabeçalho de telefone', () => {
    const result = exportContactsCsv([]);
    expect(parseCsv(result.csv)).toEqual([[CSV_EXPORT_CONTACT_PHONE_HEADER]]);
    expect(result.truncated).toBe(false);
  });
});

describe('CSV_Export — resultados de disparo (Req 24.6, 24.10)', () => {
  it('usa cabeçalho fixo e preenche campos opcionais ausentes com vazio', () => {
    const result = exportDispatchResultsCsv([
      {
        target: '+5511988887777',
        targetKind: 'CONTACT',
        status: 'SENT',
        contentLabel: 'Conteúdo 1',
        sentAt: '2024-01-15T12:00:00.000Z',
      },
      { target: '12036304@g.us', targetKind: 'GROUP', status: 'FAILED', error: 'timeout' },
    ]);
    const parsed = parseCsv(result.csv);
    expect(parsed[0]).toEqual([...CSV_EXPORT_RESULT_HEADER]);
    expect(parsed[1]).toEqual([
      '+5511988887777',
      'CONTACT',
      'SENT',
      'Conteúdo 1',
      '',
      '2024-01-15T12:00:00.000Z',
    ]);
    expect(parsed[2]).toEqual(['12036304@g.us', 'GROUP', 'FAILED', '', 'timeout', '']);
  });
});
