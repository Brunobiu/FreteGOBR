/**
 * Property-Based Tests — Billing_Notifier (`src/utils/billingNotifier.ts`).
 *
 * Feature: assinaturas-pagamento (Fase 4, task 12.1).
 *   - Property 5 (lado TS): seleção anti-disparo-em-massa do aviso de trial.
 *     A idempotência real (no máx. 1 notificação não-lida por user+type) é
 *     garantida pelo índice único parcial `uq_notifications_user_plan_unread`
 *     no banco (migration 041/059) e validada por smoke test SQL na aplicação
 *     da migration. Aqui cobrimos a lógica PURA de seleção: quem entra e quem
 *     fica de fora da janela.
 *     Validates: Requirements 10.3, 10.4, 10.6.
 *
 * Espelho de `run_billing_notifications()` (migration 059).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  shouldNotifyTrialExpiring,
  shouldSuspendForGrace,
  type TrialExpiringInput,
  type SuspensionCandidateInput,
} from '../utils/billingNotifier';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));

const DATE_RANGE = {
  min: new Date(Date.UTC(2020, 0, 1)),
  max: new Date(Date.UTC(2030, 0, 1)),
  noInvalidDate: true,
} as const;

const trialInputArb: fc.Arbitrary<TrialExpiringInput> = fc.record({
  userType: fc.constantFrom<TrialExpiringInput['userType']>('motorista', 'embarcador', 'admin'),
  isSubscribed: fc.boolean(),
  subscriptionStatus: fc.constantFrom<TrialExpiringInput['subscriptionStatus']>(
    'trial',
    'active',
    'past_due',
    'canceled',
    'blocked'
  ),
  trialEndsAt: fc.option(fc.date(DATE_RANGE), { nil: null }),
});

const suspensionInputArb: fc.Arbitrary<SuspensionCandidateInput> = fc.record({
  status: fc.constantFrom<SuspensionCandidateInput['status']>(
    'active',
    'past_due',
    'suspended',
    'canceled'
  ),
  graceEndsAt: fc.option(fc.date(DATE_RANGE), { nil: null }),
});

// ============================================================================
// Property 5 (TS): seleção de trial vencendo — determinismo + janela fechada
// Validates: Requirements 10.3, 10.4, 10.6
// ============================================================================
describe('Property 5: shouldNotifyTrialExpiring — seleção anti-disparo-em-massa', () => {
  it('é determinístico para o mesmo input', () => {
    fc.assert(
      fc.property(trialInputArb, (input) => {
        expect(shouldNotifyTrialExpiring(input, NOW)).toBe(shouldNotifyTrialExpiring(input, NOW));
      })
    );
  });

  it('quem é selecionado SEMPRE é motorista, não-assinante, em trial, na janela [now+1d, now+2d]', () => {
    fc.assert(
      fc.property(trialInputArb, (input) => {
        if (!shouldNotifyTrialExpiring(input, NOW)) return;
        // Condições necessárias para entrar na seleção.
        expect(input.userType).toBe('motorista');
        expect(input.isSubscribed).toBe(false);
        expect(input.subscriptionStatus).toBe('trial');
        expect(input.trialEndsAt).not.toBeNull();
        const t = (input.trialEndsAt as Date).getTime();
        expect(t).toBeGreaterThanOrEqual(NOW.getTime() + DAY_MS);
        expect(t).toBeLessThanOrEqual(NOW.getTime() + 2 * DAY_MS);
      })
    );
  });

  it('NUNCA seleciona embarcador, admin, assinante ou status != trial', () => {
    fc.assert(
      fc.property(
        trialInputArb.filter(
          (i) => i.userType !== 'motorista' || i.isSubscribed || i.subscriptionStatus !== 'trial'
        ),
        (input) => {
          expect(shouldNotifyTrialExpiring(input, NOW)).toBe(false);
        }
      )
    );
  });
});

describe('shouldNotifyTrialExpiring — casos de borda da janela', () => {
  const base: TrialExpiringInput = {
    userType: 'motorista',
    isSubscribed: false,
    subscriptionStatus: 'trial',
    trialEndsAt: null,
  };

  it('exatamente now+1d: incluído (limite inferior fechado)', () => {
    expect(
      shouldNotifyTrialExpiring({ ...base, trialEndsAt: new Date(NOW.getTime() + DAY_MS) }, NOW)
    ).toBe(true);
  });

  it('exatamente now+2d: incluído (limite superior fechado)', () => {
    expect(
      shouldNotifyTrialExpiring({ ...base, trialEndsAt: new Date(NOW.getTime() + 2 * DAY_MS) }, NOW)
    ).toBe(true);
  });

  it('now+12h (antes da janela): excluído', () => {
    expect(
      shouldNotifyTrialExpiring({ ...base, trialEndsAt: new Date(NOW.getTime() + DAY_MS / 2) }, NOW)
    ).toBe(false);
  });

  it('now+3d (depois da janela): excluído', () => {
    expect(
      shouldNotifyTrialExpiring({ ...base, trialEndsAt: new Date(NOW.getTime() + 3 * DAY_MS) }, NOW)
    ).toBe(false);
  });

  it('trial já vencido (passado): excluído', () => {
    expect(
      shouldNotifyTrialExpiring({ ...base, trialEndsAt: new Date(NOW.getTime() - DAY_MS) }, NOW)
    ).toBe(false);
  });

  it('trial_ends_at null: excluído', () => {
    expect(shouldNotifyTrialExpiring(base, NOW)).toBe(false);
  });
});

// ============================================================================
// Reconciliação de suspensão por grace esgotado
// ============================================================================
describe('shouldSuspendForGrace — past_due com grace esgotado', () => {
  it('só seleciona past_due com grace_ends_at no passado', () => {
    fc.assert(
      fc.property(suspensionInputArb, (input) => {
        if (!shouldSuspendForGrace(input, NOW)) return;
        expect(input.status).toBe('past_due');
        expect(input.graceEndsAt).not.toBeNull();
        expect((input.graceEndsAt as Date).getTime()).toBeLessThan(NOW.getTime());
      })
    );
  });

  it('past_due com grace ainda futuro: NÃO suspende', () => {
    expect(
      shouldSuspendForGrace(
        { status: 'past_due', graceEndsAt: new Date(NOW.getTime() + DAY_MS) },
        NOW
      )
    ).toBe(false);
  });

  it('past_due com grace expirado: suspende', () => {
    expect(
      shouldSuspendForGrace(
        { status: 'past_due', graceEndsAt: new Date(NOW.getTime() - DAY_MS) },
        NOW
      )
    ).toBe(true);
  });

  it('status != past_due nunca suspende, mesmo com grace expirado', () => {
    fc.assert(
      fc.property(
        suspensionInputArb.filter((i) => i.status !== 'past_due'),
        (input) => {
          expect(shouldSuspendForGrace(input, NOW)).toBe(false);
        }
      )
    );
  });

  it('past_due sem grace (null): NÃO suspende', () => {
    expect(shouldSuspendForGrace({ status: 'past_due', graceEndsAt: null }, NOW)).toBe(false);
  });
});
