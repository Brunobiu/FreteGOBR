/**
 * Testes de exemplo/edge — Núcleo puro do trial de motoristas
 * (`src/utils/trialStatus.ts`).
 *
 * Complementam as Correctness Properties (property tests em
 * `trialStatus.property.test.ts`) com casos pontuais e fronteiras concretas,
 * usando asserções por exemplo (sem fast-check). Cobrem:
 *   - `trialEndsAt` nulo ⇒ daysLeft 0, isExpired false.
 *   - Fronteira `now === trialEndsAt` (motorista não-assinante ⇒ bloqueado).
 *   - `subscriptionStatus` fora do domínio fechado (cache corrompido) tratado
 *     como rótulo informativo: o bloqueio NUNCA depende do rótulo.
 *   - Isenção total de embarcador/admin.
 *   - Fronteiras concretas de `selectBadgeTier` (0, 1, 4, 5, 10, 11).
 *
 * _Requirements: 2.3, 3.3_
 */

import { describe, it, expect } from 'vitest';

import {
  computeDaysLeft,
  computeTrialState,
  selectBadgeTier,
  type SubscriptionStatus,
  type TrialComputationInput,
} from '../utils/trialStatus';

/** Milissegundos em um dia (24h). */
const DAY_MS = 86_400_000;

/** Instante de referência fixo e determinístico para os exemplos. */
const NOW = new Date(Date.UTC(2025, 0, 15, 12, 0, 0));

// ============================================================================
// trialEndsAt nulo ⇒ daysLeft 0, isExpired false
// (Requirements 2.3, 3.3)
// ============================================================================
describe('trialEndsAt nulo', () => {
  it('computeDaysLeft(null, now) === 0', () => {
    expect(computeDaysLeft(null, NOW)).toBe(0);
  });

  it('motorista sem trialEndsAt ⇒ daysLeft 0 e isExpired false (não bloqueia sem data)', () => {
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt: null,
      isSubscribed: false,
      subscriptionStatus: 'trial',
      now: NOW,
    });

    expect(state.daysLeft).toBe(0);
    expect(state.isExpired).toBe(false);
  });
});

// ============================================================================
// Fronteira now === trialEndsAt
// (Requirement 2.3)
// ============================================================================
describe('fronteira now === trialEndsAt', () => {
  it('daysLeft é 0 exatamente no instante de expiração', () => {
    const trialEndsAt = new Date(NOW.getTime());
    expect(computeDaysLeft(trialEndsAt, NOW)).toBe(0);
  });

  it('motorista não-assinante no instante exato ⇒ isExpired true (bloqueado)', () => {
    const trialEndsAt = new Date(NOW.getTime());
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt,
      isSubscribed: false,
      subscriptionStatus: 'trial',
      now: NOW,
    });

    expect(state.daysLeft).toBe(0);
    expect(state.isExpired).toBe(true);
  });

  it('motorista assinante no instante exato ⇒ isExpired false (assinatura isenta)', () => {
    const trialEndsAt = new Date(NOW.getTime());
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt,
      isSubscribed: true,
      subscriptionStatus: 'active',
      now: NOW,
    });

    expect(state.daysLeft).toBe(0);
    expect(state.isExpired).toBe(false);
  });

  it('motorista com trialEndsAt 1ms no futuro ⇒ daysLeft 1 e isExpired false', () => {
    const trialEndsAt = new Date(NOW.getTime() + 1);
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt,
      isSubscribed: false,
      subscriptionStatus: 'trial',
      now: NOW,
    });

    expect(state.daysLeft).toBe(1);
    expect(state.isExpired).toBe(false);
  });
});

// ============================================================================
// subscriptionStatus fora do domínio fechado (cache corrompido)
// (Requirement 3.3) — o rótulo é informativo; o bloqueio deriva de
// trialEndsAt + isSubscribed, nunca do label.
// ============================================================================
describe('subscriptionStatus fora do domínio (cache corrompido)', () => {
  // Valor inválido que não pertence a SUBSCRIPTION_STATUSES.
  const corrupted = 'totally-bogus' as SubscriptionStatus;

  it('o status corrompido é preservado como rótulo, sem afetar o bloqueio (trial ainda válido)', () => {
    const trialEndsAt = new Date(NOW.getTime() + 10 * DAY_MS);
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt,
      isSubscribed: false,
      subscriptionStatus: corrupted,
      now: NOW,
    });

    // Bloqueio NÃO depende do rótulo: trial futuro + não-assinante ⇒ não expirado.
    expect(state.isExpired).toBe(false);
    expect(state.daysLeft).toBe(10);
    // O rótulo flui inalterado (camada de exibição decide tratá-lo como 'trial').
    expect(state.status).toBe(corrupted);
  });

  it('com trial expirado, o bloqueio ocorre independentemente do rótulo corrompido', () => {
    const trialEndsAt = new Date(NOW.getTime() - DAY_MS);
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt,
      isSubscribed: false,
      subscriptionStatus: corrupted,
      now: NOW,
    });

    expect(state.isExpired).toBe(true);
    expect(state.daysLeft).toBe(0);
  });

  it('assinante com rótulo corrompido nunca é bloqueado (isSubscribed manda)', () => {
    const trialEndsAt = new Date(NOW.getTime() - DAY_MS);
    const state = computeTrialState({
      userType: 'motorista',
      trialEndsAt,
      isSubscribed: true,
      subscriptionStatus: corrupted,
      now: NOW,
    });

    expect(state.isExpired).toBe(false);
  });
});

// ============================================================================
// Isenção total de embarcador/admin
// (Requirements 2.3, 3.3) — daysLeft 0, isExpired false sempre.
// ============================================================================
describe('isenção de embarcador/admin', () => {
  const expiredInThePast = new Date(NOW.getTime() - 100 * DAY_MS);

  it('embarcador ⇒ daysLeft 0 e isExpired false mesmo com trialEndsAt no passado', () => {
    const state = computeTrialState({
      userType: 'embarcador',
      trialEndsAt: expiredInThePast,
      isSubscribed: false,
      subscriptionStatus: 'trial',
      now: NOW,
    });

    expect(state.daysLeft).toBe(0);
    expect(state.isExpired).toBe(false);
  });

  it('admin ⇒ daysLeft 0 e isExpired false independentemente de trialEndsAt', () => {
    const future = new Date(NOW.getTime() + 100 * DAY_MS);
    const inputs: TrialComputationInput[] = [
      {
        userType: 'admin',
        trialEndsAt: expiredInThePast,
        isSubscribed: false,
        subscriptionStatus: 'trial',
        now: NOW,
      },
      {
        userType: 'admin',
        trialEndsAt: future,
        isSubscribed: false,
        subscriptionStatus: 'trial',
        now: NOW,
      },
      {
        userType: 'admin',
        trialEndsAt: null,
        isSubscribed: false,
        subscriptionStatus: 'trial',
        now: NOW,
      },
    ];

    for (const input of inputs) {
      const state = computeTrialState(input);
      expect(state.daysLeft).toBe(0);
      expect(state.isExpired).toBe(false);
    }
  });
});

// ============================================================================
// selectBadgeTier — fronteiras concretas
// daysLeft: 0 hidden, 1 red-pulse, 4 red, 5 yellow, 10 yellow, 11 green
// subscribed motorista hidden; não-motorista hidden.
// ============================================================================
describe('selectBadgeTier — fronteiras concretas', () => {
  const motorista = (daysLeft: number) =>
    selectBadgeTier({ userType: 'motorista', isSubscribed: false, daysLeft });

  it('daysLeft 0 ⇒ hidden', () => {
    expect(motorista(0)).toBe('hidden');
  });

  it('daysLeft 1 ⇒ red-pulse', () => {
    expect(motorista(1)).toBe('red-pulse');
  });

  it('daysLeft 4 ⇒ red', () => {
    expect(motorista(4)).toBe('red');
  });

  it('daysLeft 5 ⇒ yellow', () => {
    expect(motorista(5)).toBe('yellow');
  });

  it('daysLeft 10 ⇒ yellow', () => {
    expect(motorista(10)).toBe('yellow');
  });

  it('daysLeft 11 ⇒ green', () => {
    expect(motorista(11)).toBe('green');
  });

  it('motorista assinante ⇒ hidden (mesmo com daysLeft positivo)', () => {
    expect(selectBadgeTier({ userType: 'motorista', isSubscribed: true, daysLeft: 7 })).toBe(
      'hidden'
    );
  });

  it('não-motorista ⇒ hidden', () => {
    expect(selectBadgeTier({ userType: 'embarcador', isSubscribed: false, daysLeft: 7 })).toBe(
      'hidden'
    );
    expect(selectBadgeTier({ userType: 'admin', isSubscribed: false, daysLeft: 7 })).toBe('hidden');
  });
});
