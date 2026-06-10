/**
 * Property-based tests do núcleo puro de revalidação de documentos (30 dias).
 *
 * Alvo: src/utils/docRevalidation.ts. Verifica os invariantes da janela de
 * 30 dias por grupo: vencimento, dias restantes, lista de vencidos e o
 * predicado agregado needsRevalidation.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  REVALIDATION_GROUPS,
  REVALIDATION_DAYS,
  isGroupExpired,
  groupDaysLeft,
  computeExpiredGroups,
  needsRevalidation,
  type GroupConfirmations,
  type RevalidationGroup,
} from '../utils/docRevalidation';

const DAY_MS = 86_400_000;
const WINDOW_MS = REVALIDATION_DAYS * DAY_MS;

/** `now` determinístico fixo para evitar flakiness. */
const NOW = new Date('2026-06-10T12:00:00.000Z');

/** Gerador de offset (em ms) relativo ao NOW, cobrindo passado e futuro. */
const offsetMs = fc.integer({ min: -120 * 24, max: 120 * 24 }).map((h) => h * 3_600_000);

describe('docRevalidation — isGroupExpired', () => {
  it('null/inválido sempre vence', () => {
    expect(isGroupExpired(null, NOW)).toBe(true);
    expect(isGroupExpired('not-a-date', NOW)).toBe(true);
  });

  it('vence sse now - confirmedAt > 30 dias', () => {
    fc.assert(
      fc.property(offsetMs, (off) => {
        const confirmedAt = new Date(NOW.getTime() - WINDOW_MS - off);
        const expected = NOW.getTime() - confirmedAt.getTime() > WINDOW_MS;
        expect(isGroupExpired(confirmedAt, NOW)).toBe(expected);
      })
    );
  });

  it('confirmado agora nunca está vencido', () => {
    expect(isGroupExpired(NOW, NOW)).toBe(false);
  });

  it('exatamente nos 30 dias ainda é válido; 1ms depois vence', () => {
    const exact = new Date(NOW.getTime() - WINDOW_MS);
    expect(isGroupExpired(exact, NOW)).toBe(false);
    const justAfter = new Date(NOW.getTime() - WINDOW_MS - 1);
    expect(isGroupExpired(justAfter, NOW)).toBe(true);
  });
});

describe('docRevalidation — groupDaysLeft', () => {
  it('é sempre inteiro >= 0', () => {
    fc.assert(
      fc.property(fc.option(offsetMs, { nil: undefined }), (off) => {
        const confirmedAt = off === undefined ? null : new Date(NOW.getTime() - off);
        const d = groupDaysLeft(confirmedAt, NOW);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('vencido ⇒ daysLeft === 0 (consistência com isGroupExpired)', () => {
    fc.assert(
      fc.property(offsetMs, (off) => {
        const confirmedAt = new Date(NOW.getTime() - WINDOW_MS - off);
        if (isGroupExpired(confirmedAt, NOW)) {
          expect(groupDaysLeft(confirmedAt, NOW)).toBe(0);
        }
      })
    );
  });

  it('confirmado agora ⇒ 30 dias restantes', () => {
    expect(groupDaysLeft(NOW, NOW)).toBe(REVALIDATION_DAYS);
  });

  it('null ⇒ 0', () => {
    expect(groupDaysLeft(null, NOW)).toBe(0);
  });
});

/** Gera um mapa de confirmações com offsets independentes por grupo. */
const confirmationsArb: fc.Arbitrary<GroupConfirmations> = fc
  .record(
    Object.fromEntries(
      REVALIDATION_GROUPS.map((g) => [
        g,
        fc
          .option(offsetMs, { nil: null })
          .map((off) => (off === null ? null : new Date(NOW.getTime() - off))),
      ])
    ) as Record<RevalidationGroup, fc.Arbitrary<Date | null>>
  )
  .map((r) => r as GroupConfirmations);

describe('docRevalidation — computeExpiredGroups / needsRevalidation', () => {
  it('expiredGroups é subconjunto dos grupos canônicos, na ordem canônica', () => {
    fc.assert(
      fc.property(confirmationsArb, (conf) => {
        const expired = computeExpiredGroups(conf, NOW);
        // subconjunto
        expired.forEach((g) => expect(REVALIDATION_GROUPS).toContain(g));
        // ordem canônica preservada
        const idx = expired.map((g) => REVALIDATION_GROUPS.indexOf(g));
        const sorted = [...idx].sort((a, b) => a - b);
        expect(idx).toEqual(sorted);
        // sem duplicatas
        expect(new Set(expired).size).toBe(expired.length);
      })
    );
  });

  it('um grupo está em expiredGroups sse isGroupExpired(grupo)', () => {
    fc.assert(
      fc.property(confirmationsArb, (conf) => {
        const expired = computeExpiredGroups(conf, NOW);
        REVALIDATION_GROUPS.forEach((g) => {
          expect(expired.includes(g)).toBe(isGroupExpired(conf[g], NOW));
        });
      })
    );
  });

  it('needsRevalidation sse expiredGroups não-vazio', () => {
    fc.assert(
      fc.property(confirmationsArb, (conf) => {
        expect(needsRevalidation(conf, NOW)).toBe(computeExpiredGroups(conf, NOW).length > 0);
      })
    );
  });

  it('todos confirmados agora ⇒ nenhum vencido', () => {
    const conf = Object.fromEntries(REVALIDATION_GROUPS.map((g) => [g, NOW])) as GroupConfirmations;
    expect(computeExpiredGroups(conf, NOW)).toEqual([]);
    expect(needsRevalidation(conf, NOW)).toBe(false);
  });

  it('todos null ⇒ todos vencidos', () => {
    const conf = Object.fromEntries(
      REVALIDATION_GROUPS.map((g) => [g, null])
    ) as GroupConfirmations;
    expect(computeExpiredGroups(conf, NOW)).toEqual([...REVALIDATION_GROUPS]);
    expect(needsRevalidation(conf, NOW)).toBe(true);
  });
});
