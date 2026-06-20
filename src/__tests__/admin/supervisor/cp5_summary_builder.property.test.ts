// Feature: admin-ia-supervisora, Property 5: Determinismo do Summary_Builder + sem PII.
//
// buildSummaryText é determinística (mesma entrada => mesmo texto) e a saída não
// contém PII/segredos; summaryDedupKey é estável por período/bucket.
//
// Validates: Requirements 8.1, 8.2, 8.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildSummaryText,
  summaryDedupKey,
  type SummaryPeriod,
} from '../../../services/admin/supervisor/summaryBuilder';
import { expectNoSecrets } from '../../_helpers/logAssertions';
import { summaryInputGen } from './_generators';

describe('CP5 supervisor: Summary_Builder determinístico e sem PII', () => {
  it('determinismo + agregados saneados (NaN/negativo => 0) + sem segredos', () => {
    fc.assert(
      fc.property(summaryInputGen, (input) => {
        const a = buildSummaryText(input);
        const b = buildSummaryText(input);
        expect(a).toBe(b);
        expectNoSecrets(a);
        // nunca emite NaN/Infinity/negativo
        expect(a).not.toContain('NaN');
        expect(a).not.toContain('Infinity');
        expect(a).not.toContain('-');
        expect(a.startsWith('Resumo do dia:')).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('summaryDedupKey estável por período/bucket', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<SummaryPeriod>('daily', 'weekly', 'monthly'),
        fc.constantFrom('2026-06-19', '2026-W25', '2026-06'),
        (period, bucket) => {
          expect(summaryDedupKey(period, bucket)).toBe(`SUMMARY:${period}:${bucket}`);
          expect(summaryDedupKey(period, bucket)).toBe(summaryDedupKey(period, bucket));
        }
      ),
      { numRuns: 100 }
    );
  });
});
