// Feature: marketplace, Property 3
/**
 * CP-3: Relative_Age monotônica e não-negativa
 *
 * Para qualquer par `(createdAt, now)` com `createdAt <= now`,
 * `formatRelativeAge`:
 *  - produz um rótulo pt-BR cuja "quantidade" é não-negativa;
 *  - é não-decrescente conforme `now` avança (em granularidade de dias);
 *  - respeita as fronteiras (hoje / há N h / há N dias);
 *  - sanea diferença negativa (skew de relógio) para "hoje";
 *  - é determinística.
 *
 * Lógica pura (sem I/O), então não há mocks. Datas geradas a partir de epoch-ms
 * inteiro (evita Invalid Date que `fc.date()` pode emitir).
 *
 * Validates: Requirements 7.5 (Property 3)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { formatRelativeAge } from '../../utils/marketplacePost';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Epoch-ms num intervalo seguro para aritmética (2005..2100). */
const baseMsGen = fc.integer({ min: Date.UTC(2005, 0, 1), max: Date.UTC(2100, 0, 1) });

/** Dias embutidos no rótulo ("há N dias"); 0 para "hoje"/"há N h". */
function daysInLabel(label: string): number {
  const match = label.match(/^há (\d+) dias?$/);
  return match ? Number(match[1]) : 0;
}

describe('CP-3: formatRelativeAge', () => {
  it('é determinística', () => {
    fc.assert(
      fc.property(baseMsGen, fc.integer({ min: 0, max: 200 * DAY }), (baseMs, offsetMs) => {
        const createdAt = new Date(baseMs);
        const now = new Date(baseMs + offsetMs);
        expect(formatRelativeAge(createdAt, now)).toBe(formatRelativeAge(createdAt, now));
      }),
      { numRuns: 100 }
    );
  });

  it('nunca embute número negativo e sanea skew (now < createdAt ⇒ "hoje")', () => {
    fc.assert(
      fc.property(baseMsGen, fc.integer({ min: 1, max: 10 * DAY }), (baseMs, skewMs) => {
        const createdAt = new Date(baseMs);
        const now = new Date(baseMs - skewMs); // relógio adiantado
        const label = formatRelativeAge(createdAt, now);
        expect(label).toBe('hoje');

        const anyNumber = label.match(/\d+/);
        if (anyNumber) {
          expect(Number(anyNumber[0])).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('fronteira [0, 1h) ⇒ "hoje"', () => {
    fc.assert(
      fc.property(baseMsGen, fc.integer({ min: 0, max: HOUR - 1 }), (baseMs, offsetMs) => {
        expect(formatRelativeAge(new Date(baseMs), new Date(baseMs + offsetMs))).toBe('hoje');
      }),
      { numRuns: 100 }
    );
  });

  it('fronteira [1h, 24h) ⇒ "há N h"', () => {
    fc.assert(
      fc.property(baseMsGen, fc.integer({ min: 1, max: 23 }), (baseMs, hours) => {
        expect(formatRelativeAge(new Date(baseMs), new Date(baseMs + hours * HOUR))).toBe(
          `há ${hours} h`
        );
      }),
      { numRuns: 100 }
    );
  });

  it('fronteira [1 dia, ...) ⇒ "há 1 dia" / "há N dias"', () => {
    fc.assert(
      fc.property(baseMsGen, fc.integer({ min: 1, max: 365 }), (baseMs, days) => {
        const expected = days === 1 ? 'há 1 dia' : `há ${days} dias`;
        expect(formatRelativeAge(new Date(baseMs), new Date(baseMs + days * DAY))).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('monotônica em granularidade de dias (now2 >= now1 ⇒ dias não diminuem)', () => {
    fc.assert(
      fc.property(
        baseMsGen,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: DAY - 1 }),
        fc.integer({ min: 0, max: DAY - 1 }),
        (baseMs, k1, k2, intra1, intra2) => {
          const lo = Math.min(k1, k2);
          const hi = Math.max(k1, k2);
          const createdAt = new Date(baseMs);
          const d1 = daysInLabel(formatRelativeAge(createdAt, new Date(baseMs + lo * DAY + intra1)));
          const d2 = daysInLabel(formatRelativeAge(createdAt, new Date(baseMs + hi * DAY + intra2)));
          expect(d2).toBeGreaterThanOrEqual(d1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
