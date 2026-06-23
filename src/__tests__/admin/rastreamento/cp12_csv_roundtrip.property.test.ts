// Feature: admin-rastreamento-inteligente, Property 12 (CP12): CSV Export —
// round-trip.
//
// Para toda At_Risk_List exportada, reanalisar o CSV gerado
// (parseCsv(toCsv(rows))) reproduz exatamente as mesmas linhas lógicas —
// incluindo campos com `;`, `"`, `\n` e `\r` — preservando BOM, separador `;`,
// escape RFC 4180 e quebra `\r\n` (reusa whatsapp/csv).
//
// Validates: Requirements 7.11

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  atRiskRowsToMatrix,
  buildRastreamentoCsvFilename,
  exportAtRiskCsv,
  parseCsv,
} from '../../../services/admin/rastreamento/csvExport';
import { type AtRiskRow } from '../../../services/admin/rastreamento/atRiskList';
import { RISK_BANDS, RISK_CATEGORIES, ABANDONMENT_CAUSES, CONTACT_STATUSES } from '../../../services/admin/rastreamento/domain';
import { maskedPhone } from './_generators';
import { uuidLike } from '../../_helpers/generators';

/** Texto "traiçoeiro" com curingas RFC 4180 para exercitar o escape. */
const trickyName = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    'João da Silva',
    'Empresa; LTDA',
    'Aspas "duplas" no nome',
    'Linha1\nLinha2',
    'CR\rno meio',
    'Misto; "x"\nfim',
    'Maria, a "Forte"'
  );

const trickyRowArb = (): fc.Arbitrary<AtRiskRow> =>
  fc.record({
    user_id: uuidLike(),
    risk_score: fc.integer({ min: 0, max: 100 }),
    risk_band: fc.constantFrom(...RISK_BANDS),
    abandonment_cause: fc.constantFrom(...ABANDONMENT_CAUSES),
    risk_category: fc.constantFrom(...RISK_CATEGORIES),
    contact_status: fc.constantFrom(...CONTACT_STATUSES),
    name: trickyName(),
    phone_masked: maskedPhone(),
    profile: fc.constantFrom('motorista' as const, 'embarcador' as const),
    last_activity_at: fc.integer({ min: 0, max: 1_000_000 }),
  });

describe('CP12 — CSV Export round-trip', () => {
  it('parseCsv(toCsv(rows)) reproduz a matriz lógica, com campos especiais', () => {
    fc.assert(
      fc.property(fc.array(trickyRowArb(), { minLength: 0, maxLength: 40 }), (rows) => {
        const matrix = atRiskRowsToMatrix(rows);
        const { csv } = exportAtRiskCsv(rows);
        const parsed = parseCsv(csv);
        expect(parsed).toEqual(matrix);
      }),
      { numRuns: 200 }
    );
  });

  it('filename segue rastreamento_<YYYYMMDD>_<HHmm>.csv', () => {
    const name = buildRastreamentoCsvFilename(new Date('2026-01-15T12:34:56.000Z'));
    expect(name).toBe('rastreamento_20260115_1234.csv');
    expect(name).toMatch(/^rastreamento_\d{8}_\d{4}\.csv$/);
  });
});
