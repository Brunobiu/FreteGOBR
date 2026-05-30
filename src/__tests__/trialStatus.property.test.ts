/**
 * Property-Based Tests — Núcleo puro do trial de motoristas (`src/utils/trialStatus.ts`).
 *
 * Arquivo compartilhado pelas Correctness Properties 1–4 da spec `trial-e-bloqueio`
 * (Design Section "Correctness Properties"). Cada propriedade é implementada por um
 * único property test (fast-check, >= 100 iterações) e tagueada com o comentário
 * `Feature: trial-e-bloqueio, Property {n}`.
 *
 * Layout do arquivo (um `describe` de topo por propriedade; seções claramente
 * separadas para que as próximas tarefas adicionem blocos sem conflito):
 *   - Property 1: computeDaysLeft        (esta tarefa — 1.3)
 *   - Property 2: computeTrialState      (tarefa 1.4)
 *   - Property 3: selectBadgeTier        (tarefa 1.5)
 *   - Property 4: computeTrialEndsAt     (tarefa 1.6)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  computeDaysLeft,
  computeTrialState,
  computeTrialEndsAt,
  selectBadgeTier,
  SUBSCRIPTION_STATUSES,
  type BadgeTier,
  type UserTypeLike,
} from '../utils/trialStatus';

/** Milissegundos em um dia (24h) — espelha `DAY_MS` do núcleo puro. */
const DAY_MS = 86_400_000;

/** Range de datas usado pelos geradores (1970 .. 2100), sem datas inválidas. */
const DATE_RANGE = {
  min: new Date(Date.UTC(1970, 0, 1)),
  max: new Date(Date.UTC(2100, 0, 1)),
  noInvalidDate: true,
} as const;

// ============================================================================
// Feature: trial-e-bloqueio, Property 1: Cálculo de dias restantes
// Validates: Requirements 2.1, 2.2, 2.3
//
// For any par (trialEndsAt, now) com trialEndsAt não-nulo,
//   computeDaysLeft === max(0, ceil((trialEndsAt - now) / 86400000)),
//   sempre inteiro >= 0, >= 1 quando trialEndsAt > now, 0 quando trialEndsAt <= now.
// Para trialEndsAt nulo o resultado é 0.
// ============================================================================
describe('Property 1: computeDaysLeft — cálculo de dias restantes', () => {
  it('iguala max(0, ceil((trialEndsAt - now) / 86400000)) e é sempre inteiro >= 0', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), fc.date(DATE_RANGE), (trialEndsAt, now) => {
        const result = computeDaysLeft(trialEndsAt, now);
        const expected = Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS));

        expect(result).toBe(expected);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);

        // >= 1 sempre que trialEndsAt > now; 0 sempre que trialEndsAt <= now.
        if (trialEndsAt.getTime() > now.getTime()) {
          expect(result).toBeGreaterThanOrEqual(1);
        } else {
          expect(result).toBe(0);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('retorna 0 na fronteira trialEndsAt === now', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), (instant) => {
        // Mesmo instante em duas referências distintas de Date.
        const now = new Date(instant.getTime());
        expect(computeDaysLeft(instant, now)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('arredonda diferenças sub-dia para cima (ceil): offset em (0, DAY_MS] ⇒ 1 dia', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), fc.integer({ min: 1, max: DAY_MS }), (now, offsetMs) => {
        const trialEndsAt = new Date(now.getTime() + offsetMs);
        // Qualquer fração de dia (até exatamente 1 dia) arredonda para 1.
        expect(computeDaysLeft(trialEndsAt, now)).toBe(1);
      }),
      { numRuns: 200 }
    );
  });

  it('aplica ceil corretamente para offsets futuros arbitrários (multi-dia)', () => {
    fc.assert(
      fc.property(
        fc.date(DATE_RANGE),
        fc.integer({ min: 1, max: 400 * DAY_MS }),
        (now, offsetMs) => {
          const trialEndsAt = new Date(now.getTime() + offsetMs);
          const result = computeDaysLeft(trialEndsAt, now);
          expect(result).toBe(Math.ceil(offsetMs / DAY_MS));
          expect(result).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('retorna 0 quando trialEndsAt <= now (passado ou igual)', () => {
    fc.assert(
      fc.property(
        fc.date(DATE_RANGE),
        fc.integer({ min: 0, max: 400 * DAY_MS }),
        (trialEndsAt, offsetMs) => {
          // now = trialEndsAt + offset >= trialEndsAt, logo trialEndsAt <= now.
          const now = new Date(trialEndsAt.getTime() + offsetMs);
          expect(computeDaysLeft(trialEndsAt, now)).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('retorna 0 para trialEndsAt nulo, qualquer que seja now', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), (now) => {
        expect(computeDaysLeft(null, now)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 2: Predicado de bloqueio e isenção
// Validates: Requirements 1.4, 2.4, 5.1, 7.1, 7.2, 9.3
//
// For any (userType, trialEndsAt, isSubscribed, subscriptionStatus, now),
//   computeTrialState(...).isExpired === true  IFF
//     userType === 'motorista' && trialEndsAt != null
//       && trialEndsAt <= now && isSubscribed === false.
//
// Em particular:
//   - embarcador/admin (quaisquer valores) ⇒ isExpired === false E daysLeft === 0;
//   - qualquer motorista assinante (isSubscribed === true) ⇒ isExpired === false.
// ============================================================================
describe('Property 2: computeTrialState — predicado de bloqueio e isenção', () => {
  const userTypeArb = fc.constantFrom<UserTypeLike>('motorista', 'embarcador', 'admin');
  const trialEndsAtArb = fc.option(fc.date(DATE_RANGE), { nil: null });
  const statusArb = fc.constantFrom(...SUBSCRIPTION_STATUSES);

  it('isExpired é verdadeiro se e somente se motorista não-assinante com trialEndsAt <= now', () => {
    fc.assert(
      fc.property(
        userTypeArb,
        trialEndsAtArb,
        fc.boolean(),
        statusArb,
        fc.date(DATE_RANGE),
        (userType, trialEndsAt, isSubscribed, subscriptionStatus, now) => {
          const state = computeTrialState({
            userType,
            trialEndsAt,
            isSubscribed,
            subscriptionStatus,
            now,
          });

          // Predicado de bloqueio (paridade com is_motorista_trial_blocked).
          const expectedExpired =
            userType === 'motorista' &&
            trialEndsAt != null &&
            trialEndsAt.getTime() <= now.getTime() &&
            isSubscribed === false;

          expect(state.isExpired).toBe(expectedExpired);

          // Os demais campos do estado refletem fielmente o input.
          expect(state.isSubscribed).toBe(isSubscribed);
          expect(state.status).toBe(subscriptionStatus);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('embarcador/admin nunca expiram e têm daysLeft 0 (quaisquer valores)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<UserTypeLike>('embarcador', 'admin'),
        trialEndsAtArb,
        fc.boolean(),
        statusArb,
        fc.date(DATE_RANGE),
        (userType, trialEndsAt, isSubscribed, subscriptionStatus, now) => {
          const state = computeTrialState({
            userType,
            trialEndsAt,
            isSubscribed,
            subscriptionStatus,
            now,
          });

          expect(state.isExpired).toBe(false);
          expect(state.daysLeft).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('motorista assinante nunca expira, qualquer que seja trialEndsAt/now', () => {
    fc.assert(
      fc.property(
        trialEndsAtArb,
        statusArb,
        fc.date(DATE_RANGE),
        (trialEndsAt, subscriptionStatus, now) => {
          const state = computeTrialState({
            userType: 'motorista',
            trialEndsAt,
            isSubscribed: true,
            subscriptionStatus,
            now,
          });

          expect(state.isExpired).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('motorista não-assinante: daysLeft espelha computeDaysLeft e expira no passado/fronteira', () => {
    fc.assert(
      fc.property(
        trialEndsAtArb,
        statusArb,
        fc.date(DATE_RANGE),
        (trialEndsAt, subscriptionStatus, now) => {
          const state = computeTrialState({
            userType: 'motorista',
            trialEndsAt,
            isSubscribed: false,
            subscriptionStatus,
            now,
          });

          // daysLeft delega 100% a computeDaysLeft (Property 1).
          expect(state.daysLeft).toBe(computeDaysLeft(trialEndsAt, now));

          // trialEndsAt nulo nunca bloqueia; trialEndsAt <= now bloqueia.
          if (trialEndsAt == null) {
            expect(state.isExpired).toBe(false);
          } else {
            expect(state.isExpired).toBe(trialEndsAt.getTime() <= now.getTime());
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 3: Seleção de tier do TrialBadge (função total)
// Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.4
//
// For any (userType, isSubscribed, daysLeft) com daysLeft inteiro >= 0,
//   selectBadgeTier retorna EXATAMENTE um tier, conforme:
//     'hidden'    ⟺ userType !== 'motorista' OU isSubscribed === true OU daysLeft === 0
//     'green'     ⟺ motorista não-assinante E daysLeft > 10
//     'yellow'    ⟺ motorista não-assinante E 5 <= daysLeft <= 10
//     'red'       ⟺ motorista não-assinante E 1 < daysLeft < 5
//     'red-pulse' ⟺ motorista não-assinante E daysLeft === 1
//
// A função é TOTAL: toda combinação de input produz exatamente um tier válido.
// ============================================================================
describe('Property 3: selectBadgeTier — seleção de tier do TrialBadge (função total)', () => {
  const userTypeArb = fc.constantFrom<UserTypeLike>('motorista', 'embarcador', 'admin');
  /**
   * `daysLeft` é um inteiro >= 0. Usamos `fc.nat({ max: 400 })` e injetamos
   * explicitamente as fronteiras 0, 1, 5, 10, 11 (transições entre tiers) para
   * garantir cobertura determinística dos limites.
   */
  const daysLeftArb = fc.oneof(fc.nat({ max: 400 }), fc.constantFrom(0, 1, 5, 10, 11));

  const VALID_TIERS: readonly BadgeTier[] = [
    'hidden',
    'green',
    'yellow',
    'red',
    'red-pulse',
  ] as const;

  /** Especificação independente (oráculo) do tier esperado. */
  function expectedTier(
    userType: UserTypeLike,
    isSubscribed: boolean,
    daysLeft: number
  ): BadgeTier {
    if (userType !== 'motorista') return 'hidden';
    if (isSubscribed) return 'hidden';
    if (daysLeft === 0) return 'hidden';
    if (daysLeft > 10) return 'green';
    if (daysLeft >= 5) return 'yellow';
    if (daysLeft > 1) return 'red';
    return 'red-pulse';
  }

  it('retorna exatamente o tier especificado para qualquer (userType, isSubscribed, daysLeft)', () => {
    fc.assert(
      fc.property(userTypeArb, fc.boolean(), daysLeftArb, (userType, isSubscribed, daysLeft) => {
        const tier = selectBadgeTier({ userType, isSubscribed, daysLeft });

        // Totalidade: sempre um dos 5 tiers válidos.
        expect(VALID_TIERS).toContain(tier);

        // Concorda com o oráculo independente.
        expect(tier).toBe(expectedTier(userType, isSubscribed, daysLeft));

        // Condição de ocultação (Requirements 4.2, 4.3, 4.8, 7.4).
        const shouldHide = userType !== 'motorista' || isSubscribed === true || daysLeft === 0;
        if (shouldHide) {
          expect(tier).toBe('hidden');
        } else {
          // Motorista não-assinante com daysLeft > 0: nunca 'hidden'.
          expect(tier).not.toBe('hidden');
        }
      }),
      { numRuns: 300 }
    );
  });

  it('motorista não-assinante: mapeia faixas de daysLeft para o tier de cor correto', () => {
    fc.assert(
      fc.property(daysLeftArb, (daysLeft) => {
        const tier = selectBadgeTier({
          userType: 'motorista',
          isSubscribed: false,
          daysLeft,
        });

        if (daysLeft === 0) {
          expect(tier).toBe('hidden');
        } else if (daysLeft === 1) {
          expect(tier).toBe('red-pulse');
        } else if (daysLeft > 1 && daysLeft < 5) {
          expect(tier).toBe('red');
        } else if (daysLeft >= 5 && daysLeft <= 10) {
          expect(tier).toBe('yellow');
        } else {
          // daysLeft > 10
          expect(tier).toBe('green');
        }
      }),
      { numRuns: 300 }
    );
  });

  it('não-motorista ou assinante ⇒ sempre hidden, qualquer que seja daysLeft', () => {
    fc.assert(
      fc.property(userTypeArb, fc.boolean(), daysLeftArb, (userType, isSubscribed, daysLeft) => {
        if (userType !== 'motorista' || isSubscribed) {
          expect(selectBadgeTier({ userType, isSubscribed, daysLeft })).toBe('hidden');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('cobre as fronteiras exatas 0,1,5,10,11 (motorista não-assinante)', () => {
    const base = { userType: 'motorista' as const, isSubscribed: false };
    expect(selectBadgeTier({ ...base, daysLeft: 0 })).toBe('hidden');
    expect(selectBadgeTier({ ...base, daysLeft: 1 })).toBe('red-pulse');
    expect(selectBadgeTier({ ...base, daysLeft: 5 })).toBe('yellow');
    expect(selectBadgeTier({ ...base, daysLeft: 10 })).toBe('yellow');
    expect(selectBadgeTier({ ...base, daysLeft: 11 })).toBe('green');
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 4: Concessão do trial (created_at + 30 dias)
// Validates: Requirements 1.1
//
// For any instante createdAt, a função pura computeTrialEndsAt(createdAt)
// (espelho do trigger users_set_trial_defaults) retorna EXATAMENTE
//   createdAt + 30 * 86400000 ms.
// ============================================================================
describe('Property 4: computeTrialEndsAt — concessão do trial (created_at + 30 dias)', () => {
  /** 30 dias corridos em milissegundos — espelha TRIAL_DAYS * DAY_MS do núcleo. */
  const TRIAL_MS = 30 * DAY_MS;

  it('retorna exatamente createdAt + 30 * 86400000 ms para qualquer instante', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), (createdAt) => {
        const result = computeTrialEndsAt(createdAt);

        // Igualdade exata em milissegundos com o oráculo independente.
        expect(result.getTime()).toBe(createdAt.getTime() + TRIAL_MS);

        // Retorna um Date válido e não muta a entrada.
        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it('a diferença trialEndsAt - createdAt é sempre exatamente 30 dias', () => {
    fc.assert(
      fc.property(fc.date(DATE_RANGE), (createdAt) => {
        const result = computeTrialEndsAt(createdAt);
        expect(result.getTime() - createdAt.getTime()).toBe(TRIAL_MS);
      }),
      { numRuns: 200 }
    );
  });
});
