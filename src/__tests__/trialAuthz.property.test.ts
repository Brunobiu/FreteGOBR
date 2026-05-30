/**
 * Property-Based Tests — Predicados de autorização espelhados (`src/utils/trialStatus.ts`).
 *
 * Arquivo compartilhado pelas Correctness Properties de autorização da spec
 * `trial-e-bloqueio` (Design Section "Correctness Properties"). Cada propriedade é
 * implementada por um único property test (fast-check, >= 100 iterações) e tagueada
 * com o comentário `Feature: trial-e-bloqueio, Property {n}`.
 *
 * Os predicados testados (`canAccessFrete`, `canAcceptNewFrete`, `isMotoristaBlocked`)
 * são a especificação executável (paridade SQL↔TS) da `fretes_select_policy`, do guard
 * de `toggle_frete_like` e de `is_motorista_trial_blocked`. O cliente NUNCA é a fonte
 * de verdade; estes testes garantem que UX e autoridade do servidor concordam.
 *
 * Layout do arquivo (um `describe` de topo por propriedade; seções claramente
 * separadas para que as próximas tarefas adicionem blocos sem conflito):
 *   - Property 5:  continuidade de fretes em andamento   (esta tarefa — 6.5)
 *   - Property 6:  negação de novo aceite (bloqueado)     (tarefa 6.6)
 *   - Property 13: extensão para o futuro desbloqueia     (tarefa 8.6)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  canAccessFrete,
  canAcceptNewFrete,
  computeTrialState,
  isMotoristaBlocked,
  SUBSCRIPTION_STATUSES,
  type AuthzCaller,
  type FreteAuthzInput,
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

/** Domínio fechado de `fretes.status`. */
const FRETE_STATUSES = ['ativo', 'encerrado', 'cancelado'] as const;

/** Pool pequeno de ids para permitir colisões ocasionais caller.id ⇄ embarcadorId. */
const ID_POOL = ['u1', 'u2', 'u3', 'u4'] as const;

/**
 * Gerador de chamador arbitrário (qualquer papel, qualquer estado de bloqueio).
 * Cobre motorista/embarcador/admin, assinante ou não, `trialEndsAt` nulo/passado/futuro
 * e `now` arbitrário — exercitando todas as combinações de bloqueio.
 */
const callerArb: fc.Arbitrary<AuthzCaller> = fc.record({
  id: fc.constantFrom(...ID_POOL),
  userType: fc.constantFrom<UserTypeLike>('motorista', 'embarcador', 'admin'),
  trialEndsAt: fc.option(fc.date(DATE_RANGE), { nil: null }),
  isSubscribed: fc.boolean(),
  subscriptionStatus: fc.constantFrom(...SUBSCRIPTION_STATUSES),
  now: fc.date(DATE_RANGE),
});

/** Gerador de frete arbitrário (status e dono arbitrários). */
const freteArb = (hasOwnConversation: fc.Arbitrary<boolean>): fc.Arbitrary<FreteAuthzInput> =>
  fc.record({
    embarcadorId: fc.constantFrom(...ID_POOL),
    status: fc.constantFrom(...FRETE_STATUSES),
    hasOwnConversation,
  });

/**
 * Gerador de motorista BLOQUEADO: `userType='motorista'`, `isSubscribed=false`,
 * `trialEndsAt != null` e `trialEndsAt <= now` (offset >= 0 no passado a partir de `now`).
 */
const blockedMotoristaArb: fc.Arbitrary<AuthzCaller> = fc
  .record({
    id: fc.constantFrom('m1', 'm2'),
    subscriptionStatus: fc.constantFrom(...SUBSCRIPTION_STATUSES),
    now: fc.date(DATE_RANGE),
    pastOffsetMs: fc.integer({ min: 0, max: 400 * DAY_MS }),
  })
  .map(({ id, subscriptionStatus, now, pastOffsetMs }) => ({
    id,
    userType: 'motorista' as const,
    isSubscribed: false,
    subscriptionStatus,
    now,
    // trialEndsAt <= now garante bloqueio (com offset 0 cobre a fronteira de igualdade).
    trialEndsAt: new Date(now.getTime() - pastOffsetMs),
  }));

// ============================================================================
// Feature: trial-e-bloqueio, Property 5: Continuidade de fretes em andamento
// Validates: Requirements 6.1, 6.2, 9.4
//
// For any conjunto de fretes onde um subconjunto possui uma conversation ligada
// ao motorista chamador, e for any estado de bloqueio do motorista, canAccessFrete
// SHALL permitir acesso a TODO frete que possua conversa própria do chamador,
// independentemente do bloqueio e do papel.
// ============================================================================
describe('Property 5: continuidade de fretes em andamento', () => {
  it('permite acesso a TODO frete com conversa própria, para qualquer caller (qualquer papel/bloqueio)', () => {
    fc.assert(
      fc.property(
        callerArb,
        // Frete com conversa própria garantida (continuidade).
        freteArb(fc.constant(true)),
        (caller, frete) => {
          expect(canAccessFrete(frete, caller)).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('em um conjunto misto de fretes, TODO frete com conversa própria é acessível independentemente do bloqueio', () => {
    fc.assert(
      fc.property(
        callerArb,
        // Subconjunto arbitrário possui conversa própria (hasOwnConversation booleano livre).
        fc.array(freteArb(fc.boolean()), { minLength: 1, maxLength: 12 }),
        (caller, fretes) => {
          for (const frete of fretes) {
            if (frete.hasOwnConversation) {
              expect(canAccessFrete(frete, caller)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('motorista BLOQUEADO acessa frete com conversa própria mesmo fora do feed (continuidade > bloqueio)', () => {
    fc.assert(
      fc.property(blockedMotoristaArb, fc.constantFrom(...FRETE_STATUSES), (motorista, status) => {
        // Pré-condição: o gerador realmente produz um motorista bloqueado.
        expect(isMotoristaBlocked(motorista)).toBe(true);

        // Frete de OUTRO embarcador (não-dono), com conversa própria do motorista.
        const freteEmAndamento: FreteAuthzInput = {
          embarcadorId: 'e_outro',
          status,
          hasOwnConversation: true,
        };
        expect(canAccessFrete(freteEmAndamento, motorista)).toBe(true);

        // Contraste: o MESMO frete sem conversa própria e sem ser feed acessível
        // (motorista bloqueado) é negado — confirma que a continuidade é o que concede.
        const semConversa: FreteAuthzInput = { ...freteEmAndamento, hasOwnConversation: false };
        expect(canAccessFrete(semConversa, motorista)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 6: Negação de novo aceite por motorista
// bloqueado
// Validates: Requirements 5.6, 6.3, 9.1, 9.2
//
// For any motorista bloqueado (com ou sem fretes em andamento) e for any frete
// 'ativo' SEM conversa própria:
//   - canAcceptNewFrete(caller) SHALL ser false (novo aceite negado — guard de
//     `toggle_frete_like`), mesmo que o motorista possua fretes em andamento;
//   - canAccessFrete de um frete de feed (status 'ativo', hasOwnConversation
//     false, não-dono) SHALL ser false (feed negado na leitura — RLS).
// Contraste: motorista não-bloqueado / embarcador / admin SHALL poder aceitar
// (canAcceptNewFrete true).
// ============================================================================

/** Frete de feed: `'ativo'`, SEM conversa própria, dono em ID_POOL (não o caller bloqueado). */
const feedFreteArb: fc.Arbitrary<FreteAuthzInput> = fc.record({
  embarcadorId: fc.constantFrom(...ID_POOL),
  status: fc.constant('ativo'),
  hasOwnConversation: fc.constant(false),
});

/**
 * Chamador NÃO bloqueado: qualquer caller de {@link callerArb} cujo predicado
 * de bloqueio é falso (embarcador, admin, motorista assinante, motorista com
 * `trialEndsAt` nulo/futuro). Garante o contraste da Property 6.
 */
const nonBlockedCallerArb: fc.Arbitrary<AuthzCaller> = callerArb.filter(
  (c) => !isMotoristaBlocked(c)
);

describe('Property 6: negação de novo aceite por motorista bloqueado', () => {
  it('motorista BLOQUEADO não pode aceitar novo frete e tem o feed ativo (sem conversa própria) negado', () => {
    fc.assert(
      fc.property(blockedMotoristaArb, feedFreteArb, (motorista, feedFrete) => {
        // Pré-condição: o gerador realmente produz um motorista bloqueado.
        expect(isMotoristaBlocked(motorista)).toBe(true);
        // Pré-condição: frete de feed não pertence ao motorista (não-dono).
        expect(feedFrete.embarcadorId).not.toBe(motorista.id);

        // Novo aceite negado (guard de toggle_frete_like).
        expect(canAcceptNewFrete(motorista)).toBe(false);
        // Feed 'ativo' sem conversa própria negado na leitura (RLS).
        expect(canAccessFrete(feedFrete, motorista)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it('o novo aceite continua negado mesmo que o motorista bloqueado possua fretes em andamento (conversas próprias)', () => {
    fc.assert(
      fc.property(
        blockedMotoristaArb,
        // Conjunto de fretes em andamento: subconjunto com conversa própria (livre).
        fc.array(freteArb(fc.boolean()), { minLength: 0, maxLength: 12 }),
        feedFreteArb,
        (motorista, fretesEmAndamento, feedFrete) => {
          expect(isMotoristaBlocked(motorista)).toBe(true);

          // Possuir fretes em andamento (conversas próprias) NÃO habilita novo aceite.
          expect(canAcceptNewFrete(motorista)).toBe(false);

          // Cada frete em andamento com conversa própria permanece acessível
          // (continuidade), mas isso não muda a negação do novo aceite acima.
          for (const frete of fretesEmAndamento) {
            if (frete.hasOwnConversation) {
              expect(canAccessFrete(frete, motorista)).toBe(true);
            }
          }

          // O feed 'ativo' sem conversa própria segue negado.
          expect(canAccessFrete(feedFrete, motorista)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('contraste: motorista não-bloqueado, embarcador e admin PODEM aceitar novo frete', () => {
    fc.assert(
      fc.property(nonBlockedCallerArb, (caller) => {
        // Pré-condição: chamador não está bloqueado.
        expect(isMotoristaBlocked(caller)).toBe(false);
        // Novo aceite permitido para todos os não-bloqueados.
        expect(canAcceptNewFrete(caller)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});

// ============================================================================
// Feature: trial-e-bloqueio, Property 13: Extensão para o futuro desbloqueia
// Validates: Requirements 11.4
//
// For any motorista BLOQUEADO (userType 'motorista', isSubscribed false,
// trialEndsAt != null e trialEndsAt <= now), após `admin_extend_trial` definir
// `trial_ends_at` para um instante ESTRITAMENTE futuro (now + offset, offset > 0),
// o predicado de bloqueio SHALL retornar false na avaliação seguinte:
//   - isMotoristaBlocked(novoInput) === false
//   - computeTrialState(novoInput).isExpired === false
//   - daysLeft >= 1 (enquanto trialEndsAt > now)
//
// Modela a composição do predicado puro de bloqueio com a extensão: a partir de
// um motorista comprovadamente bloqueado, aplica a extensão (paridade com
// `admin_extend_trial`) e verifica que a próxima avaliação o classifica como não
// bloqueado, sem necessidade de campo de bloqueio explícito.
// ============================================================================
describe('Property 13: extensão para o futuro desbloqueia', () => {
  it('motorista bloqueado, após extensão para o futuro (now + offset, offset > 0), deixa de estar bloqueado e tem daysLeft >= 1', () => {
    fc.assert(
      fc.property(
        blockedMotoristaArb,
        // Offset estritamente positivo: trial_ends_at definido para o futuro.
        fc.integer({ min: 1, max: 400 * DAY_MS }),
        (motorista, futureOffsetMs) => {
          // Pré-condição: o gerador realmente produz um motorista bloqueado.
          expect(isMotoristaBlocked(motorista)).toBe(true);

          // Extensão: novo trial_ends_at estritamente futuro relativo a `now`.
          const extended: AuthzCaller = {
            ...motorista,
            trialEndsAt: new Date(motorista.now!.getTime() + futureOffsetMs),
          };

          // Pós-condição: a próxima avaliação não classifica como bloqueado.
          expect(isMotoristaBlocked(extended)).toBe(false);

          const state = computeTrialState(extended);
          expect(state.isExpired).toBe(false);
          // Enquanto trial_ends_at > now, daysLeft é sempre >= 1 (ceil).
          expect(state.daysLeft).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('o desbloqueio independe do subscription_status informado (a extensão da data basta)', () => {
    fc.assert(
      fc.property(
        blockedMotoristaArb,
        fc.integer({ min: 1, max: 400 * DAY_MS }),
        fc.constantFrom(...SUBSCRIPTION_STATUSES),
        (motorista, futureOffsetMs, status) => {
          expect(isMotoristaBlocked(motorista)).toBe(true);

          const extended: AuthzCaller = {
            ...motorista,
            subscriptionStatus: status,
            // is_subscribed permanece false: somente a data futura desbloqueia.
            isSubscribed: false,
            trialEndsAt: new Date(motorista.now!.getTime() + futureOffsetMs),
          };

          expect(isMotoristaBlocked(extended)).toBe(false);
          expect(computeTrialState(extended).isExpired).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});
