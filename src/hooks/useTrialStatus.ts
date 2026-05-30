/**
 * useTrialStatus — estado de trial do usuário atual (FreteGO).
 *
 * Hook fino que NÃO contém lógica de datas própria: delega 100% do cálculo ao
 * núcleo puro `computeTrialState` (paridade SQL↔TS via `trialStatus.ts`). O hook
 * apenas seleciona a fonte de dados e memoiza o resultado.
 *
 * Fonte de dados (em ordem de prioridade):
 *   1. Usuário autenticado via `useAuth()` (fonte primária).
 *   2. Fallback ao cache local `fretego_user` em `localStorage` quando não há
 *      usuário autenticado (Req 3.4).
 *   3. Default seguro sem auth e sem cache (Req 3.5).
 *
 * Notas de robustez:
 * - `trialEndsAt` pode chegar como `Date` (auth ao vivo) ou `string` ISO (cache
 *   após round-trip `JSON.stringify`/`parse`); é sempre normalizado para
 *   `Date | null` antes de entrar em `computeTrialState`.
 * - Falha de parse do cache é fail-open: cai no default seguro
 *   (`isExpired: false`), nunca bloqueia indevidamente.
 */

import { useMemo } from 'react';
import { useAuth } from './useAuth';
import {
  computeTrialState,
  type SubscriptionStatus,
  type TrialComputationInput,
  type UserTypeLike,
} from '../utils/trialStatus';

/** Chave do cache de usuário em `localStorage` (espelha `USER_KEY` em useAuth). */
const USER_CACHE_KEY = 'fretego_user';

export interface UseTrialStatusResult {
  daysLeft: number;
  isExpired: boolean;
  isSubscribed: boolean;
  status: SubscriptionStatus;
}

/** Resultado seguro quando não há nenhuma fonte de dados confiável (Req 3.5). */
const SAFE_DEFAULT: UseTrialStatusResult = {
  daysLeft: 0,
  isExpired: false,
  isSubscribed: false,
  status: 'trial',
};

/** Conjunto de tipos de usuário válidos, para validar o cache. */
const VALID_USER_TYPES: readonly UserTypeLike[] = ['motorista', 'embarcador', 'admin'];

/**
 * Normaliza `trialEndsAt` para `Date | null`. Aceita `Date` (auth ao vivo),
 * `string` ISO (cache) ou `null`/`undefined`. Strings inválidas ⇒ `null`.
 */
function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Lê e normaliza o cache `fretego_user` para a entrada de `computeTrialState`.
 * Retorna `null` quando o cache não existe, é JSON inválido ou não contém um
 * `userType` reconhecível (fail-open: o chamador cai no default seguro).
 */
function readCachedTrialInput(): Omit<TrialComputationInput, 'now'> | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      userType?: unknown;
      trialEndsAt?: string | null;
      isSubscribed?: boolean;
      subscriptionStatus?: SubscriptionStatus;
    } | null;

    if (parsed == null || typeof parsed !== 'object') return null;

    const userType = parsed.userType;
    if (typeof userType !== 'string' || !VALID_USER_TYPES.includes(userType as UserTypeLike)) {
      return null;
    }

    return {
      userType: userType as UserTypeLike,
      trialEndsAt: toDateOrNull(parsed.trialEndsAt),
      isSubscribed: parsed.isSubscribed ?? false,
      subscriptionStatus: parsed.subscriptionStatus ?? 'trial',
    };
  } catch {
    // Fail-open: qualquer erro de leitura/parse ⇒ default seguro.
    return null;
  }
}

export function useTrialStatus(): UseTrialStatusResult {
  const { user } = useAuth();

  // Campos relevantes da fonte ativa (usuário autenticado), usados como
  // dependências da memoização — o hook recomputa quando qualquer um muda.
  const hasUser = user != null;
  const userType = user?.userType;
  const trialEndsAt = user?.trialEndsAt;
  const isSubscribed = user?.isSubscribed;
  const subscriptionStatus = user?.subscriptionStatus;

  return useMemo<UseTrialStatusResult>(() => {
    const now = new Date();

    // 1. Usuário autenticado: fonte primária.
    if (hasUser && userType != null) {
      const state = computeTrialState({
        userType,
        trialEndsAt: toDateOrNull(trialEndsAt),
        isSubscribed: isSubscribed ?? false,
        subscriptionStatus: subscriptionStatus ?? 'trial',
        now,
      });
      return {
        daysLeft: state.daysLeft,
        isExpired: state.isExpired,
        isSubscribed: state.isSubscribed,
        status: state.status,
      };
    }

    // 2. Fallback ao cache local `fretego_user`.
    const cached = readCachedTrialInput();
    if (cached != null) {
      const state = computeTrialState({ ...cached, now });
      return {
        daysLeft: state.daysLeft,
        isExpired: state.isExpired,
        isSubscribed: state.isSubscribed,
        status: state.status,
      };
    }

    // 3. Sem auth e sem cache: default seguro (Req 3.5).
    return SAFE_DEFAULT;
  }, [hasUser, userType, trialEndsAt, isSubscribed, subscriptionStatus]);
}
