/**
 * Feature: startup-performance-optimization
 *
 * Property 1: Hidratação otimista de auth
 *   Para qualquer Cached_Session válida persistida em `localStorage`
 *   (`fretego_user` + `fretego_access_token` parseáveis), a inicialização do
 *   `AuthProvider` deve produzir `isAuthenticated = true` e `isLoading = false`
 *   de forma SÍNCRONA, sem aguardar nem depender da conclusão de qualquer
 *   Supabase_Query de verificação.
 *
 * Property 2: Verificação inválida limpa a sessão
 *   Para qualquer estado hidratado a partir de uma Cached_Session, quando a
 *   verificação em segundo plano retorna o resultado explícito "sessão
 *   inválida", o estado final deve ser `user = null`
 *   (`isAuthenticated = false`) e a Cached_Session deve ser removida do
 *   `localStorage`.
 *
 * Property 3: Erro de rede preserva a sessão
 *   Para qualquer estado hidratado a partir de uma Cached_Session, quando a
 *   verificação em segundo plano falha por erro de rede/transporte, o
 *   Auth_State deve permanecer idêntico ao derivado da Cached_Session (usuário
 *   NÃO é deslogado) e a Cached_Session é preservada.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 *
 * Nota de convenção: o projeto NÃO usa @testing-library/react (a lib não está
 * instalada e nenhum `.test.tsx` pré-existente a utiliza). Para não introduzir
 * dependência nova, renderizamos com `react-dom/client` + `React.act` sobre o
 * ambiente jsdom já configurado no vitest — mesmo padrão de
 * `trialExpiredPage.test.tsx`.
 *
 * Mocks (steering): `vi.mock` é hoisted — NÃO referenciar variáveis externas
 * no factory. Os spies/estado mutável são expostos via
 * `(globalThis as Record<string, unknown>).__verifySessionSpy` e
 * `...__verifyBehavior`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as fc from 'fast-check';

import type { User } from '../types';
import type { SessionVerification } from '../services/authSession';

// ---------------------------------------------------------------------------
// Mocks (factories hoisted — sem referência a variáveis externas)
// ---------------------------------------------------------------------------

// `verifySessionForBootstrap`: spy controlável por run. O comportamento é
// definido via `globalThis.__verifyBehavior`:
//   - 'pending'  → Promise que NUNCA resolve (prova a sincronicidade da P1).
//   - objeto SessionVerification → Promise resolvida com esse resultado.
vi.mock('../services/authSession', () => {
  const spy = vi.fn(() => {
    const g = globalThis as Record<string, unknown>;
    const behavior = g.__verifyBehavior;
    if (behavior === 'pending') {
      return new Promise(() => {
        /* nunca resolve */
      });
    }
    return Promise.resolve(behavior);
  });
  (globalThis as Record<string, unknown>).__verifySessionSpy = spy;
  return { verifySessionForBootstrap: spy };
});

// `../services/auth`: importado estaticamente pelo AuthProvider. Mockado para
// evitar a inicialização do cliente Supabase e efeitos colaterais de rede.
vi.mock('../services/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  refreshToken: vi.fn(),
}));

// `../services/pushNotifications`: importado dinamicamente em
// `clearAuthData`/`saveAuthData`. Mockado para evitar efeitos nativos/rede.
vi.mock('../services/pushNotifications', () => ({
  registerForPush: vi.fn(async () => undefined),
  unregisterPush: vi.fn(async () => undefined),
}));

// Importado APÓS os mocks (vi.mock é hoisted de qualquer forma).
import { AuthProvider, useAuth } from '../hooks/useAuth';

// ---------------------------------------------------------------------------
// Chaves de localStorage (espelham as constantes internas do useAuth)
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'fretego_access_token';
const USER_KEY = 'fretego_user';

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------
function setVerifyBehavior(behavior: SessionVerification | 'pending'): void {
  (globalThis as Record<string, unknown>).__verifyBehavior = behavior;
}

function verifySpy(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>).__verifySessionSpy as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Geradores fast-check (convenção: fc.constantFrom para PII; sem fc.stringOf)
// ---------------------------------------------------------------------------

/**
 * Templates fixos de User válidos. PII (phone/cpf/email) com valores válidos
 * conforme convenção do projeto — evita strings aleatórias inválidas.
 */
const USER_TEMPLATES: User[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    phone: '11999990001',
    userType: 'motorista',
    name: 'Motorista Um',
    email: 'motorista1@example.com',
    cpf: '12345678901',
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    trialEndsAt: null,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    phone: '21988880002',
    userType: 'embarcador',
    name: 'Embarcador Dois',
    email: 'embarcador2@example.com',
    cpf: '98765432100',
    isActive: true,
    createdAt: new Date('2023-06-15T12:30:00.000Z'),
    updatedAt: new Date('2023-06-16T12:30:00.000Z'),
    trialEndsAt: null,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    phone: '31977770003',
    userType: 'motorista',
    name: 'Motorista Tres',
    email: 'motorista3@example.com',
    cpf: '11144477735',
    isActive: true,
    createdAt: new Date('2022-12-31T23:59:59.000Z'),
    updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    trialEndsAt: null,
  },
];

const userArb = fc.constantFrom(...USER_TEMPLATES);

/** Tokens fixos não vazios (Cached_Session exige token presente). */
const tokenArb = fc.constantFrom('tok_aaa111', 'tok_bbb222', 'tok_ccc333', 'tok_ddd444');

// ---------------------------------------------------------------------------
// Render manual (react-dom/client + React.act)
// ---------------------------------------------------------------------------

interface CapturedState {
  isAuthenticated: boolean;
  isLoading: boolean;
  hasUser: boolean;
}

/**
 * Monta o AuthProvider com um consumidor de `useAuth` que registra o estado a
 * cada render. `renders[0]` é o PRIMEIRO render (hidratação síncrona).
 */
function mountProvider(container: HTMLDivElement): {
  root: Root;
  renders: CapturedState[];
  latest: () => CapturedState;
} {
  const renders: CapturedState[] = [];

  function Consumer(): null {
    const auth = useAuth();
    renders.push({
      isAuthenticated: auth.isAuthenticated,
      isLoading: auth.isLoading,
      hasUser: auth.user !== null,
    });
    return null;
  }

  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(createElement(AuthProvider, null, createElement(Consumer)));
  });

  return {
    root,
    renders,
    latest: () => renders[renders.length - 1],
  };
}

/** Avança microtasks + macrotask (setTimeout 0) dentro de `act` para o flush. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Aguarda a condição (estilo waitFor) flushando entre tentativas. */
async function waitForCondition(predicate: () => boolean, maxFlushes = 20): Promise<void> {
  for (let i = 0; i < maxFlushes; i += 1) {
    if (predicate()) return;
    await flush();
  }
  if (!predicate()) {
    throw new Error('Condição não satisfeita após o flush da verificação em background');
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  verifySpy().mockClear();
  setVerifyBehavior('pending');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  localStorage.clear();
});

/** Persiste uma Cached_Session válida (user parseável + token) no localStorage. */
function seedCachedSession(user: User, token: string): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(TOKEN_KEY, token);
}

// ===========================================================================
// Property 1: Hidratação otimista de auth (Requirements 1.1, 1.2)
// ===========================================================================
describe('AuthProvider — Property 1: hidratação otimista de auth', () => {
  it('com Cached_Session válida, o PRIMEIRO render expõe isAuthenticated=true e isLoading=false SEM aguardar a verificação', async () => {
    await fc.assert(
      fc.asyncProperty(userArb, tokenArb, async (user, token) => {
        // Isolamento entre runs.
        localStorage.clear();
        verifySpy().mockClear();
        // 'pending' garante que a verificação NUNCA resolve durante o render:
        // se o estado já é autenticado no 1º render, prova que é síncrono.
        setVerifyBehavior('pending');

        seedCachedSession(user, token);

        const localContainer = document.createElement('div');
        document.body.appendChild(localContainer);

        const { root, renders } = mountProvider(localContainer);

        // Estado do PRIMEIRO render (hidratação síncrona), antes de qualquer
        // resolução da Supabase_Query de verificação.
        const first = renders[0];
        expect(first).toBeDefined();
        expect(first.isAuthenticated).toBe(true);
        expect(first.isLoading).toBe(false);
        expect(first.hasUser).toBe(true);

        act(() => {
          root.unmount();
        });
        localContainer.remove();
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 2: Verificação inválida limpa a sessão (Requirement 1.3)
// ===========================================================================
describe('AuthProvider — Property 2: verificação inválida limpa a sessão', () => {
  it('quando verifySessionForBootstrap resolve {kind:"invalid"}, o estado final é deslogado e a Cached_Session é removida', async () => {
    await fc.assert(
      fc.asyncProperty(userArb, tokenArb, async (user, token) => {
        localStorage.clear();
        verifySpy().mockClear();
        setVerifyBehavior({ kind: 'invalid' });

        seedCachedSession(user, token);

        const localContainer = document.createElement('div');
        document.body.appendChild(localContainer);

        const { root, latest } = mountProvider(localContainer);

        // Após o flush da verificação em background: estado deslogado.
        await waitForCondition(() => latest().isAuthenticated === false);

        expect(latest().isAuthenticated).toBe(false);
        expect(latest().hasUser).toBe(false);

        // Cached_Session removida do localStorage.
        expect(localStorage.getItem(USER_KEY)).toBeNull();
        expect(localStorage.getItem(TOKEN_KEY)).toBeNull();

        act(() => {
          root.unmount();
        });
        localContainer.remove();
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Property 3: Erro de rede preserva a sessão (Requirement 1.4)
// ===========================================================================
describe('AuthProvider — Property 3: erro de rede preserva a sessão', () => {
  it('quando verifySessionForBootstrap resolve {kind:"network-error"}, a sessão hidratada é preservada', async () => {
    await fc.assert(
      fc.asyncProperty(userArb, tokenArb, async (user, token) => {
        localStorage.clear();
        verifySpy().mockClear();
        setVerifyBehavior({ kind: 'network-error' });

        seedCachedSession(user, token);

        const localContainer = document.createElement('div');
        document.body.appendChild(localContainer);

        const { root, latest } = mountProvider(localContainer);

        // Deixa a verificação em background resolver completamente.
        await flush();
        await flush();

        // A verificação foi de fato disparada (background, não bloqueante).
        expect(verifySpy()).toHaveBeenCalled();

        // Estado permanece idêntico ao hidratado: usuário NÃO é deslogado.
        expect(latest().isAuthenticated).toBe(true);
        expect(latest().hasUser).toBe(true);

        // Cached_Session preservada no localStorage.
        expect(localStorage.getItem(USER_KEY)).not.toBeNull();
        expect(localStorage.getItem(TOKEN_KEY)).toBe(token);

        act(() => {
          root.unmount();
        });
        localContainer.remove();
      }),
      { numRuns: 100 }
    );
  });
});
