/**
 * Property-Based Test — Frete Comunidade, Property 5: Auto_Expiracao.
 *
 * Feature: frete-comunidade
 * Validates: Requirements 3.3, 11.1, 11.2, 11.5, 11.6
 *
 * Invariantes (regra transversal — vale para TODOS os fretes, não só comunidade):
 *   - `isVisibleByExpiry(refDate, now)` é true sse `now < refDate + 5 dias`.
 *   - Reiniciar a refDate para um instante posterior reabre a janela.
 *   - `daysUntilExpiry` é sempre >= 0 e coerente com a visibilidade
 *     (dias > 0 ⇒ visível; já expirado ⇒ 0 e não visível).
 *   - Idempotência: reaplicar a regra sobre um frete já expirado não muda nada.
 *   - Independe de `source` (a função só recebe datas).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  EXPIRY_DAYS,
  expiryReferenceDate,
  isVisibleByExpiry,
  daysUntilExpiry,
} from '../utils/communityExpiry';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = EXPIRY_DAYS * DAY_MS;

/** Instantes em ms dentro de uma faixa ampla mas segura (datas reais). */
const epochMsArb = fc.integer({
  min: Date.UTC(2020, 0, 1),
  max: Date.UTC(2035, 0, 1),
});

/** Deslocamento em ms relativo à janela (cobre antes, dentro e depois). */
const offsetMsArb = fc.integer({ min: -2 * WINDOW_MS, max: 2 * WINDOW_MS });

describe('Frete Comunidade — Property 5: Auto_Expiracao', () => {
  it('visível sse now < refDate + 5 dias', () => {
    fc.assert(
      fc.property(epochMsArb, offsetMsArb, (refMs, offset) => {
        const ref = new Date(refMs);
        const now = new Date(refMs + offset);
        const visible = isVisibleByExpiry(ref, now);
        expect(visible).toBe(now.getTime() < refMs + WINDOW_MS);
      }),
      { numRuns: 200 }
    );
  });

  it('reiniciar a refDate para instante posterior reabre a janela', () => {
    fc.assert(
      fc.property(
        epochMsArb,
        fc.integer({ min: 1, max: 2 * WINDOW_MS }),
        (refMs, bump) => {
          // now logo após o fim da janela original ⇒ expirado.
          const expiredNow = new Date(refMs + WINDOW_MS + 1);
          expect(isVisibleByExpiry(new Date(refMs), expiredNow)).toBe(false);
          // Edição: refDate avança para um instante >= now ⇒ janela reabre.
          const newRef = new Date(expiredNow.getTime() + bump);
          expect(isVisibleByExpiry(newRef, expiredNow)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('daysUntilExpiry é sempre >= 0 e coerente com a visibilidade', () => {
    fc.assert(
      fc.property(epochMsArb, offsetMsArb, (refMs, offset) => {
        const ref = new Date(refMs);
        const now = new Date(refMs + offset);
        const days = daysUntilExpiry(ref, now);
        expect(days).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(days)).toBe(true);
        if (days > 0) {
          // Ainda há dias restantes ⇒ deve estar visível.
          expect(isVisibleByExpiry(ref, now)).toBe(true);
        }
        if (!isVisibleByExpiry(ref, now)) {
          // Expirado ⇒ zero dias restantes.
          expect(days).toBe(0);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('idempotência: já expirado permanece não-visível com 0 dias', () => {
    fc.assert(
      fc.property(
        epochMsArb,
        fc.integer({ min: 0, max: WINDOW_MS }),
        (refMs, extra) => {
          const ref = new Date(refMs);
          const now1 = new Date(refMs + WINDOW_MS + extra);
          const now2 = new Date(now1.getTime() + extra); // tempo só avança
          expect(isVisibleByExpiry(ref, now1)).toBe(false);
          expect(isVisibleByExpiry(ref, now2)).toBe(false);
          expect(daysUntilExpiry(ref, now1)).toBe(0);
          expect(daysUntilExpiry(ref, now2)).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('expiryReferenceDate retorna o updated_at do frete', () => {
    fc.assert(
      fc.property(epochMsArb, (refMs) => {
        const d = new Date(refMs);
        expect(expiryReferenceDate({ updatedAt: d }).getTime()).toBe(refMs);
      }),
      { numRuns: 100 }
    );
  });

  it('datas inválidas (NaN) ⇒ não visível e 0 dias (fail-safe)', () => {
    const invalid = new Date(NaN);
    const valid = new Date(Date.UTC(2025, 0, 1));
    expect(isVisibleByExpiry(invalid, valid)).toBe(false);
    expect(isVisibleByExpiry(valid, invalid)).toBe(false);
    expect(daysUntilExpiry(invalid, valid)).toBe(0);
    expect(daysUntilExpiry(valid, invalid)).toBe(0);
  });
});
