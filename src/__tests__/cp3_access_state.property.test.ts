/**
 * Property-Based Tests — Máquina de estados de acesso (`src/utils/trialStatus.ts`).
 *
 * Feature: assinaturas-pagamento.
 *   - Property 2 (lado TS): determinismo de `computeAccessState`.
 *     Validates: Requirements 5.1, 5.6.
 *   - Property 3: invariante de suspensão — `suspended ⇒ vê feed ∧ não interage`;
 *     `trial/active/past_due ⇒ interage`.
 *     Validates: Requirements 6.1, 6.2, 6.6.
 *
 * A paridade SQL↔TS de `computeAccessState` (lado servidor) é coberta por teste
 * de integração em `tests/` (task 5).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  computeAccessState,
  canViewFeed,
  canInteract,
  SUBSCRIPTION_STATUSES,
  type AccessInput,
  type AccessState,
  type SubscriptionStatus,
  type UserTypeLike,
} from '../utils/trialStatus';

const DATE_RANGE = {
  min: new Date(Date.UTC(1990, 0, 1)),
  max: new Date(Date.UTC(2100, 0, 1)),
  noInvalidDate: true,
} as const;

/** Gerador de AccessInput cobrindo todos os tipos, status, e datas nulas/válidas. */
const accessInputArb: fc.Arbitrary<AccessInput> = fc.record({
  userType: fc.constantFrom<UserTypeLike>('motorista', 'embarcador', 'admin'),
  isSubscribed: fc.boolean(),
  subscriptionStatus: fc.constantFrom<SubscriptionStatus>(...SUBSCRIPTION_STATUSES),
  trialEndsAt: fc.option(fc.date(DATE_RANGE), { nil: null }),
  graceEndsAt: fc.option(fc.date(DATE_RANGE), { nil: null }),
  now: fc.date(DATE_RANGE),
});

// ============================================================================
// Feature: assinaturas-pagamento, Property 2 (TS): determinismo
// Validates: Requirements 5.1, 5.6
// ============================================================================
describe('Property 2: computeAccessState — determinismo', () => {
  it('mesmo input produz sempre o mesmo estado', () => {
    fc.assert(
      fc.property(accessInputArb, (input) => {
        expect(computeAccessState(input)).toBe(computeAccessState({ ...input }));
      })
    );
  });

  it('retorna sempre um AccessState do domínio fechado', () => {
    const domain: AccessState[] = ['trial', 'active', 'past_due', 'suspended', 'canceled'];
    fc.assert(
      fc.property(accessInputArb, (input) => {
        expect(domain).toContain(computeAccessState(input));
      })
    );
  });

  it('embarcador/admin são sempre active e sempre interagem', () => {
    fc.assert(
      fc.property(
        accessInputArb.filter((i) => i.userType !== 'motorista'),
        (input) => {
          expect(computeAccessState(input)).toBe('active');
          expect(canInteract(input)).toBe(true);
          expect(canViewFeed(input)).toBe(true);
        }
      )
    );
  });
});

// ============================================================================
// Feature: assinaturas-pagamento, Property 3: invariante de suspensão
// Validates: Requirements 6.1, 6.2, 6.6
// ============================================================================
describe('Property 3: invariante de suspensão (vê feed, não interage)', () => {
  it('para todo input: sempre pode ver o feed', () => {
    fc.assert(
      fc.property(accessInputArb, (input) => {
        expect(canViewFeed(input)).toBe(true);
      })
    );
  });

  it('suspended/canceled ⇒ NÃO interage; trial/active/past_due ⇒ interage', () => {
    fc.assert(
      fc.property(accessInputArb, (input) => {
        const state = computeAccessState(input);
        const interage = canInteract(input);
        if (state === 'suspended' || state === 'canceled') {
          expect(interage).toBe(false);
        } else {
          expect(interage).toBe(true);
        }
      })
    );
  });

  it('motorista suspenso vê o feed E não interage (invariante central)', () => {
    // Trial vencido, nunca pagou, sem grace ⇒ suspended.
    const now = new Date(Date.UTC(2025, 0, 10));
    const input: AccessInput = {
      userType: 'motorista',
      isSubscribed: false,
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.UTC(2025, 0, 1)),
      graceEndsAt: null,
      now,
    };
    expect(computeAccessState(input)).toBe('suspended');
    expect(canViewFeed(input)).toBe(true);
    expect(canInteract(input)).toBe(false);
  });

  it('motorista com subscription_status=blocked não interage mesmo com trial futuro', () => {
    // Regressão (bug 058): blocked = suspenso por assinatura; trial futuro não libera.
    const input: AccessInput = {
      userType: 'motorista',
      isSubscribed: false,
      subscriptionStatus: 'blocked',
      trialEndsAt: new Date(Date.UTC(2999, 0, 1)), // trial bem no futuro
      graceEndsAt: null,
      now: new Date(Date.UTC(2025, 0, 10)),
    };
    expect(computeAccessState(input)).toBe('suspended');
    expect(canViewFeed(input)).toBe(true);
    expect(canInteract(input)).toBe(false);
  });

  it('past_due dentro do grace interage; após o grace vira suspended', () => {
    const base: AccessInput = {
      userType: 'motorista',
      isSubscribed: false,
      subscriptionStatus: 'past_due',
      trialEndsAt: new Date(Date.UTC(2024, 0, 1)),
      graceEndsAt: new Date(Date.UTC(2025, 0, 6)),
      now: new Date(Date.UTC(2025, 0, 3)),
    };
    expect(computeAccessState(base)).toBe('past_due');
    expect(canInteract(base)).toBe(true);

    const after = { ...base, now: new Date(Date.UTC(2025, 0, 10)) };
    expect(computeAccessState(after)).toBe('suspended');
    expect(canInteract(after)).toBe(false);
  });
});
