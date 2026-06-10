/**
 * Property tests do store de consentimento de cookies (Feature 3 —
 * legal-banner-cookies).
 *
 * Cobre as Correctness Properties do design:
 *  - Property 1: necessary sempre concedido.
 *  - Property 2: needsDecision sse ausente / versão divergente / corrompido.
 *  - Property 4: persistência reflete exatamente a escolha.
 *  - Property 5: decisão é estável entre recargas (releitura).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 3.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  readConsent,
  writeConsent,
  needsDecision,
  CONSENT_VERSION,
  STORAGE_KEY,
  type CookieCategory,
} from '../../services/cookieConsent';

beforeEach(() => {
  localStorage.clear();
});

const prefsArb = fc.record({
  analytics: fc.boolean(),
  marketing: fc.boolean(),
});

describe('cookieConsent — store (property-based)', () => {
  it('Property 1: necessary é sempre concedido em qualquer escrita', () => {
    fc.assert(
      fc.property(prefsArb, (prefs) => {
        const state = writeConsent(prefs);
        expect(state.categories.necessary).toBe(true);
        const back = readConsent();
        expect(back?.categories.necessary).toBe(true);
      })
    );
  });

  it('Property 4: persistência reflete exatamente as categorias escolhidas', () => {
    fc.assert(
      fc.property(prefsArb, (prefs) => {
        writeConsent(prefs);
        const back = readConsent();
        expect(back).not.toBeNull();
        expect(back!.categories.analytics).toBe(prefs.analytics);
        expect(back!.categories.marketing).toBe(prefs.marketing);
      })
    );
  });

  it('Property 4b: categoria ausente no payload default para false', () => {
    fc.assert(
      fc.property(fc.boolean(), (analytics) => {
        const state = writeConsent({ analytics });
        expect(state.categories.marketing).toBe(false);
        expect(state.categories.analytics).toBe(analytics);
      })
    );
  });

  it('Property 5: estado é estável entre releituras (sem reexibir banner)', () => {
    fc.assert(
      fc.property(prefsArb, (prefs) => {
        writeConsent(prefs);
        expect(needsDecision()).toBe(false);
        // Releitura múltipla não altera o estado.
        const a = readConsent();
        const b = readConsent();
        expect(a).toEqual(b);
        expect(needsDecision()).toBe(false);
      })
    );
  });
});

describe('cookieConsent — needsDecision (Property 2)', () => {
  it('é true quando não há nada persistido', () => {
    expect(readConsent()).toBeNull();
    expect(needsDecision()).toBe(true);
  });

  it('é true quando a versão persistida diverge da corrente', () => {
    const stale = {
      version: CONSENT_VERSION + 1,
      decidedAt: new Date().toISOString(),
      categories: { necessary: true, analytics: true, marketing: true },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    expect(readConsent()).toBeNull();
    expect(needsDecision()).toBe(true);
  });

  it('é true quando o JSON persistido está corrompido', () => {
    localStorage.setItem(STORAGE_KEY, '{nao-e-json-valido');
    expect(readConsent()).toBeNull();
    expect(needsDecision()).toBe(true);
  });

  it('é true quando categories está ausente/ inválido', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, decidedAt: 'x' }));
    expect(needsDecision()).toBe(true);
  });

  it('é false após uma decisão válida na versão corrente', () => {
    writeConsent({ analytics: false, marketing: false });
    expect(needsDecision()).toBe(false);
  });
});

describe('cookieConsent — formato persistido', () => {
  it('grava version corrente e decidedAt ISO', () => {
    writeConsent({ analytics: true, marketing: false });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      version: number;
      decidedAt: string;
      categories: Record<CookieCategory, boolean>;
    };
    expect(parsed.version).toBe(CONSENT_VERSION);
    expect(() => new Date(parsed.decidedAt).toISOString()).not.toThrow();
    expect(Number.isNaN(new Date(parsed.decidedAt).getTime())).toBe(false);
  });
});
