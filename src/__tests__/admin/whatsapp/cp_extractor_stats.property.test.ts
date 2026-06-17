/**
 * Property-Based Test + casos unitários — Extrator de Contatos (task 18.2):
 * estatísticas, deduplicação opcional entre grupos e CSV de contatos extraídos.
 *
 * Feature: whatsapp-automation, Extrator de Contatos — estatísticas e dedup
 * Validates: Requirements 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.15
 *
 * Invariantes verificadas (≥30 runs) sobre `computeExtractionStats`,
 * `dedupContactsAcrossGroups`, `buildDispatchReadyList`/`dedupValidNumbers` e
 * `buildExtractedContactsCsv` de `extractor.ts`:
 *   - **Dedup entre grupos é IDEMPOTENTE** (Req 17.9): aplicar a remoção de
 *     duplicados entre grupos duas vezes produz o mesmo resultado que aplicá-la
 *     uma vez — tanto ligada quanto desligada.
 *   - **Estatísticas consistentes** (Req 17.8, 17.10): `uniqueContacts <=
 *     totalContacts`, `totalContacts == contacts.length` e `uniqueContacts` é
 *     exatamente o nº de Contact_Numbers válidos distintos (inválidos excluídos).
 *   - **Dispatch_Ready_List** sem espaços, sem inválidos e sem duplicados
 *     (Req 17.6, 17.9, 17.10).
 *   - **CSV** distinto da Dispatch_Ready_List (Req 17.7): usa o helper do projeto
 *     (BOM UTF-8 + separador `;`), exclui inválidos e respeita a flag de dedup.
 *
 * Convenções (project-conventions / testing-governance):
 *   - Telefones via `fc.constantFrom` de templates fixos (válidos e inválidos),
 *     nunca dígitos aleatórios. NUNCA `fc.stringOf`.
 *   - Funções PURAS — sem mocks.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  buildDispatchReadyList,
  dedupValidNumbers,
  computeExtractionStats,
  dedupContactsAcrossGroups,
  buildExtractedContactsCsv,
  type ExtractedGroupContact,
} from '../../../services/admin/whatsapp/extractor';
import { CSV_BOM, CSV_SEPARATOR } from '../../../services/admin/whatsapp/csv';

/** Forma canônica de um Contact_Number na Dispatch_Ready_List: dígitos E.164 BR sem `+`. */
const DIGITS_BR = /^\d{12,13}$/;

/** Templates fixos de telefones VÁLIDOS + sua forma canônica em dígitos (E.164 sem `+`). */
interface ValidTemplate {
  raw: string;
  digits: string;
}
const VALID_TEMPLATES: ValidTemplate[] = [
  { raw: '(62) 99999-8888', digits: '5562999998888' },
  { raw: '11987654321', digits: '5511987654321' },
  // Mesmo número do primeiro, já com DDI 55 — colapsa na mesma chave de dedup.
  { raw: '5562999998888', digits: '5562999998888' },
  { raw: '+55 (21) 3333-4444', digits: '552133334444' },
  { raw: '48 98888-7777', digits: '5548988887777' },
];

/** Templates fixos de telefones INVÁLIDOS (excluídos de únicos/Dispatch_Ready_List). */
const INVALID_TEMPLATES: string[] = ['123', 'abc', '5511', '12345678', '+1 555 0000'];

/** JIDs fixos de WhatsApp_Groups de origem. */
const GROUP_JIDS: string[] = ['111111@g.us', '222222@g.us', '333333@g.us'];

type Item =
  | { kind: 'valid'; phone: string; digits: string; sourceGroupJid: string }
  | { kind: 'invalid'; phone: string; sourceGroupJid: string };

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  fc.record({
    template: fc.constantFrom(...VALID_TEMPLATES),
    sourceGroupJid: fc.constantFrom(...GROUP_JIDS),
  }).map(
    ({ template, sourceGroupJid }): Item => ({
      kind: 'valid',
      phone: template.raw,
      digits: template.digits,
      sourceGroupJid,
    })
  ),
  fc.record({
    phone: fc.constantFrom(...INVALID_TEMPLATES),
    sourceGroupJid: fc.constantFrom(...GROUP_JIDS),
  }).map(
    ({ phone, sourceGroupJid }): Item => ({ kind: 'invalid', phone, sourceGroupJid })
  )
);

/** Lista de Contact_Numbers extraídos (válidos/inválidos/duplicados misturados). */
const contactsArb = fc.array(itemArb, { minLength: 0, maxLength: 30 });

/** Converte os itens para a entrada pura `ExtractedGroupContact[]`. */
function toContacts(items: Item[]): ExtractedGroupContact[] {
  return items.map((i) => ({ phone: i.phone, sourceGroupJid: i.sourceGroupJid }));
}

/** Conjunto de dígitos válidos esperado (deduplicado), excluindo inválidos. */
function expectedValidDigits(items: Item[]): Set<string> {
  return new Set(
    items.filter((i): i is Extract<Item, { kind: 'valid' }> => i.kind === 'valid').map((i) => i.digits)
  );
}

const RUNS = { numRuns: 60 };

describe('WhatsApp Automation — Extrator de Contatos: estatísticas, dedup e CSV', () => {
  it('dedupContactsAcrossGroups(enabled) é idempotente e remove duplicados entre grupos (Req 17.9)', () => {
    fc.assert(
      fc.property(contactsArb, (items) => {
        const contacts = toContacts(items);

        const once = dedupContactsAcrossGroups(contacts, true);
        const twice = dedupContactsAcrossGroups(once, true);

        // Idempotência: f(f(x)) == f(x).
        expect(twice).toEqual(once);

        // Sem duplicados entre grupos: chaves canônicas únicas (válidos por
        // dígitos; inválidos pelo texto). O nº de válidos distintos coincide.
        const validDigits = new Set(
          once
            .map((c) => dedupValidNumbers([c.phone])[0])
            .filter((d): d is string => typeof d === 'string')
        );
        expect(validDigits).toEqual(expectedValidDigits(items));
      }),
      RUNS
    );
  });

  it('dedupContactsAcrossGroups(disabled) preserva tudo e é idempotente (Req 17.9)', () => {
    fc.assert(
      fc.property(contactsArb, (items) => {
        const contacts = toContacts(items);

        const once = dedupContactsAcrossGroups(contacts, false);
        const twice = dedupContactsAcrossGroups(once, false);

        // Preserva a lista (mesma quantidade e conteúdo, sem mutar a entrada).
        expect(once).toEqual(contacts);
        expect(twice).toEqual(once);
      }),
      RUNS
    );
  });

  it('estatísticas consistentes: uniqueContacts <= totalContacts, sem inválidos (Req 17.8, 17.10)', () => {
    fc.assert(
      fc.property(contactsArb, (items) => {
        const contacts = toContacts(items);
        const stats = computeExtractionStats(contacts);

        // total é o bruto encontrado.
        expect(stats.totalContacts).toBe(contacts.length);

        // únicos == nº de válidos distintos (inválidos excluídos — Req 17.10).
        expect(stats.uniqueContacts).toBe(expectedValidDigits(items).size);

        // Invariante central: únicos <= total.
        expect(stats.uniqueContacts).toBeLessThanOrEqual(stats.totalContacts);

        // grupos analisados == grupos distintos presentes (sem override).
        const expectedGroups = new Set(items.map((i) => i.sourceGroupJid)).size;
        expect(stats.analyzedGroups).toBe(expectedGroups);
      }),
      RUNS
    );
  });

  it('override de analyzedGroups prevalece e mantém a invariante (Req 17.8)', () => {
    fc.assert(
      fc.property(contactsArb, fc.integer({ min: 0, max: 50 }), (items, analyzed) => {
        const stats = computeExtractionStats(toContacts(items), analyzed);
        expect(stats.analyzedGroups).toBe(analyzed);
        expect(stats.uniqueContacts).toBeLessThanOrEqual(stats.totalContacts);
      }),
      RUNS
    );
  });

  it('Dispatch_Ready_List: válidos únicos em dígitos, SEM espaços/inválidos/duplicados (Req 17.6, 17.9, 17.10)', () => {
    fc.assert(
      fc.property(contactsArb, (items) => {
        const phones = toContacts(items).map((c) => c.phone);
        const list = buildDispatchReadyList(phones);

        expect(list).not.toMatch(/\s/);
        const parts = list.length === 0 ? [] : list.split(',');
        for (const part of parts) expect(part).toMatch(DIGITS_BR);
        expect(new Set(parts).size).toBe(parts.length);
        expect(new Set(parts)).toEqual(expectedValidDigits(items));
      }),
      RUNS
    );
  });

  it('CSV distinto da Dispatch_Ready_List: usa BOM + separador `;` e exclui inválidos (Req 17.7, 17.10)', () => {
    fc.assert(
      fc.property(contactsArb, (items) => {
        const contacts = toContacts(items);
        const result = buildExtractedContactsCsv(contacts, { dedupAcrossGroups: true });

        // Convenção herdada: prefixo BOM UTF-8.
        expect(result.csv.startsWith(CSV_BOM)).toBe(true);
        // Nome do arquivo no padrão whatsapp_<YYYYMMDD>_<HHmm>.csv.
        expect(result.filename).toMatch(/^whatsapp_\d{8}_\d{4}\.csv$/);

        // Linhas de dados (excluindo o cabeçalho): uma por válido único.
        const lines = result.csv.slice(CSV_BOM.length).split('\r\n');
        const header = lines[0];
        const dataLines = lines.slice(1).filter((l) => l.length > 0);

        // Cabeçalho usa o separador `;` (distinto da vírgula da Dispatch_Ready_List).
        expect(header).toContain(CSV_SEPARATOR);

        const expected = expectedValidDigits(items);
        expect(dataLines.length).toBe(expected.size);

        // Cada linha de dados começa por um telefone válido em dígitos.
        for (const line of dataLines) {
          const phone = line.split(CSV_SEPARATOR)[0];
          expect(phone).toMatch(DIGITS_BR);
          expect(expected.has(phone)).toBe(true);
        }
      }),
      RUNS
    );
  });
});

describe('WhatsApp Automation — Extrator de Contatos: casos de borda', () => {
  it('lista vazia ⇒ stats zeradas, dedup vazio, Dispatch_Ready_List vazia, CSV só com cabeçalho', () => {
    const stats = computeExtractionStats([]);
    expect(stats).toEqual({ totalContacts: 0, uniqueContacts: 0, analyzedGroups: 0 });

    expect(dedupContactsAcrossGroups([], true)).toEqual([]);
    expect(dedupContactsAcrossGroups([], false)).toEqual([]);
    expect(buildDispatchReadyList([])).toBe('');

    const csv = buildExtractedContactsCsv([]);
    const lines = csv.csv.slice(CSV_BOM.length).split('\r\n');
    expect(lines).toHaveLength(1); // apenas o cabeçalho
    expect(lines[0]).toBe(`telefone${CSV_SEPARATOR}grupo_origem`);
  });

  it('todos inválidos ⇒ uniqueContacts = 0 e Dispatch_Ready_List vazia (Req 17.10)', () => {
    const contacts: ExtractedGroupContact[] = INVALID_TEMPLATES.map((phone, idx) => ({
      phone,
      sourceGroupJid: GROUP_JIDS[idx % GROUP_JIDS.length],
    }));

    const stats = computeExtractionStats(contacts);
    expect(stats.totalContacts).toBe(contacts.length);
    expect(stats.uniqueContacts).toBe(0);

    expect(buildDispatchReadyList(contacts.map((c) => c.phone))).toBe('');

    // CSV exclui inválidos: só o cabeçalho.
    const csv = buildExtractedContactsCsv(contacts, { dedupAcrossGroups: true });
    const lines = csv.csv.slice(CSV_BOM.length).split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
  });

  it('todos duplicados (mesmo número em vários grupos) ⇒ único = 1, dedup colapsa para 1 (Req 17.9)', () => {
    const contacts: ExtractedGroupContact[] = GROUP_JIDS.map((jid) => ({
      // Mesmo número em formatos diferentes, um por grupo.
      phone: '11999998888',
      sourceGroupJid: jid,
    }));
    // Inclui também a forma com DDI, para confirmar a chave canônica única.
    contacts.push({ phone: '5511999998888', sourceGroupJid: GROUP_JIDS[0] });

    const stats = computeExtractionStats(contacts);
    expect(stats.totalContacts).toBe(contacts.length);
    expect(stats.uniqueContacts).toBe(1);
    expect(stats.analyzedGroups).toBe(GROUP_JIDS.length);

    // Dedup ligado colapsa para uma única ocorrência.
    const deduped = dedupContactsAcrossGroups(contacts, true);
    expect(deduped).toHaveLength(1);

    // Desligado preserva todas as ocorrências.
    expect(dedupContactsAcrossGroups(contacts, false)).toHaveLength(contacts.length);

    // Dispatch_Ready_List tem um único número.
    expect(buildDispatchReadyList(contacts.map((c) => c.phone))).toBe('5511999998888');
  });
});
