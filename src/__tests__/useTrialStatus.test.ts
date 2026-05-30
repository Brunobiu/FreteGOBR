/**
 * Testes do hook `useTrialStatus` (Tarefa 5.4 — opcional).
 *
 * Feature: trial-e-bloqueio
 * Valida:
 *   - Sem usuário autenticado e sem cache ⇒ default seguro (Req 3.5).
 *   - Fallback ao cache `fretego_user` (campos de motorista) deriva o estado
 *     quando não há usuário autenticado (Req 3.4).
 *   - Isenção de embarcador/admin ⇒ isExpired false, daysLeft 0 (Req 3.3).
 *
 * Nota de convenção: o projeto não usa @testing-library/react (a lib não está
 * instalada). Para não introduzir dependência nova, exercitamos o hook com o
 * mesmo padrão de `trialExpiredPage.test.tsx`: render manual via
 * `react-dom/client` + `React.act` sobre o jsdom já configurado no vitest,
 * usando um componente sonda (`Probe`) que chama o hook e captura o resultado.
 *
 * Mock de `useAuth` (steering): `vi.mock` é hoisted — NÃO referenciar variáveis
 * externas no factory. O estado de auth é criado dentro do factory e exposto
 * via `(globalThis as Record<string, unknown>).__authState` para que cada teste
 * controle o `user` retornado.
 *
 * _Requirements: 3.3, 3.4, 3.5_
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useTrialStatus, type UseTrialStatusResult } from '../hooks/useTrialStatus';
import type { User } from '../types';

// Mock de `../hooks/useAuth`: o hook sob teste importa `./useAuth` (mesmo
// módulo resolvido). O factory cria seu próprio estado mutável e o expõe no
// globalThis (não pode referenciar variáveis externas por ser hoisted).
vi.mock('../hooks/useAuth', () => {
  const state: { user: User | null } = { user: null };
  (globalThis as Record<string, unknown>).__authState = state;
  return {
    useAuth: () => ({ user: state.user }),
  };
});

/** Acessa o estado mutável do mock de auth exposto no globalThis. */
function authState(): { user: User | null } {
  return (globalThis as Record<string, unknown>).__authState as { user: User | null };
}

/** Milissegundos em um dia (24h). */
const DAY_MS = 86_400_000;

/** Chave do cache de usuário em localStorage (espelha `USER_KEY`). */
const USER_CACHE_KEY = 'fretego_user';

let container: HTMLDivElement;
let root: Root;

/**
 * Renderiza um componente sonda que chama `useTrialStatus()` e captura o
 * resultado retornado durante o render síncrono.
 */
function renderHookResult(): UseTrialStatusResult {
  let captured: UseTrialStatusResult | undefined;

  function Probe() {
    captured = useTrialStatus();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });

  if (captured === undefined) {
    throw new Error('useTrialStatus não produziu resultado no render.');
  }
  return captured;
}

/** Constrói um `User` mínimo válido, sobrescrevendo o necessário por teste. */
function makeUser(overrides: Partial<User>): User {
  return {
    id: 'u-1',
    phone: '11999990000',
    userType: 'motorista',
    name: 'Motorista Teste',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  authState().user = null;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
});

describe('useTrialStatus — seleção de fonte de dados', () => {
  // ==========================================================================
  // (a) Sem auth e sem cache ⇒ default seguro (Req 3.5)
  // ==========================================================================
  it('sem usuário autenticado e sem cache ⇒ default seguro', () => {
    const result = renderHookResult();

    expect(result).toEqual({
      daysLeft: 0,
      isExpired: false,
      isSubscribed: false,
      status: 'trial',
    });
  });

  // ==========================================================================
  // (b) Fallback ao cache `fretego_user` deriva o estado (Req 3.4)
  // ==========================================================================
  it('deriva o estado do cache `fretego_user` quando não há usuário autenticado (trial futuro)', () => {
    const base = Date.now();
    localStorage.setItem(
      USER_CACHE_KEY,
      JSON.stringify({
        userType: 'motorista',
        trialEndsAt: new Date(base + 10 * DAY_MS).toISOString(),
        isSubscribed: false,
        subscriptionStatus: 'trial',
      })
    );

    const result = renderHookResult();

    // O tempo só avança entre a montagem do cache e o `now` do hook, então a
    // diferença fica em (10 dias - epsilon, 10 dias] ⇒ ceil determinístico = 10.
    expect(result.daysLeft).toBe(10);
    expect(result.isExpired).toBe(false);
    expect(result.isSubscribed).toBe(false);
    expect(result.status).toBe('trial');
  });

  it('deriva bloqueio do cache `fretego_user` quando o trial do motorista já expirou', () => {
    localStorage.setItem(
      USER_CACHE_KEY,
      JSON.stringify({
        userType: 'motorista',
        trialEndsAt: new Date(Date.now() - DAY_MS).toISOString(),
        isSubscribed: false,
        subscriptionStatus: 'trial',
      })
    );

    const result = renderHookResult();

    expect(result.isExpired).toBe(true);
    expect(result.daysLeft).toBe(0);
  });

  it('prioriza o usuário autenticado sobre o cache local', () => {
    // Cache aponta para motorista expirado...
    localStorage.setItem(
      USER_CACHE_KEY,
      JSON.stringify({
        userType: 'motorista',
        trialEndsAt: new Date(Date.now() - DAY_MS).toISOString(),
        isSubscribed: false,
        subscriptionStatus: 'trial',
      })
    );
    // ...mas o usuário autenticado é um embarcador isento: a fonte primária vence.
    authState().user = makeUser({
      userType: 'embarcador',
      trialEndsAt: new Date(Date.now() - DAY_MS),
      isSubscribed: false,
      subscriptionStatus: 'trial',
    });

    const result = renderHookResult();

    expect(result.isExpired).toBe(false);
    expect(result.daysLeft).toBe(0);
  });

  // ==========================================================================
  // (c) Isenção de embarcador/admin ⇒ isExpired false, daysLeft 0 (Req 3.3)
  // ==========================================================================
  it('embarcador autenticado ⇒ isExpired false e daysLeft 0 mesmo com trial expirado', () => {
    authState().user = makeUser({
      userType: 'embarcador',
      trialEndsAt: new Date(Date.now() - 100 * DAY_MS),
      isSubscribed: false,
      subscriptionStatus: 'trial',
    });

    const result = renderHookResult();

    expect(result.isExpired).toBe(false);
    expect(result.daysLeft).toBe(0);
  });

  it('admin (via cache) ⇒ isExpired false e daysLeft 0 independentemente de trialEndsAt', () => {
    localStorage.setItem(
      USER_CACHE_KEY,
      JSON.stringify({
        userType: 'admin',
        trialEndsAt: new Date(Date.now() - 100 * DAY_MS).toISOString(),
        isSubscribed: false,
        subscriptionStatus: 'trial',
      })
    );

    const result = renderHookResult();

    expect(result.isExpired).toBe(false);
    expect(result.daysLeft).toBe(0);
  });
});
