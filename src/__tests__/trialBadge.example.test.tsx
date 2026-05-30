/**
 * Testes de render do TrialBadge (Tarefa 5.5 — opcional).
 *
 * Feature: trial-e-bloqueio
 * Valida:
 *   - Texto exato "Teste grátis: {daysLeft} dias" para motorista não-assinante
 *     em tier visível (Req 4.1).
 *   - Mapeamento tier↔classe Tailwind (verde/amarelo/vermelho/vermelho-pulsante),
 *     incluindo `animate-pulse` em daysLeft === 1 (Req 4.4–4.7, 4.9).
 *   - Auto-ocultação (renderiza nada) quando daysLeft === 0 (Req 4.8).
 *   - Auto-ocultação para embarcador, admin e motorista assinante (Req 4.2, 4.3).
 *
 * Nota de convenção: o projeto não usa @testing-library/react. Seguimos o mesmo
 * padrão de render manual de `trialExpiredPage.test.tsx`: `react-dom/client`
 * (`createRoot`) + `React.act` sobre o ambiente jsdom já configurado no vitest.
 *
 * Mock dos hooks (steering): `vi.mock` é hoisted — NÃO referenciar variáveis
 * externas no factory. Os valores de retorno mutáveis são expostos via
 * `(globalThis as Record<string, unknown>).__trialBadgeAuthReturn` e
 * `...__trialBadgeTrialReturn`, e o componente usa a função pura REAL
 * `selectBadgeTier` (não mockada) para derivar o tier.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TrialBadge } from '../components/TrialBadge';
import type { UseTrialStatusResult } from '../hooks/useTrialStatus';

// Mock de useAuth: retorna o objeto exposto no globalThis (factory hoisted,
// sem referência a variáveis externas).
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => (globalThis as Record<string, unknown>).__trialBadgeAuthReturn,
}));

// Mock de useTrialStatus: idem. O TrialBadge usa o selectBadgeTier REAL.
vi.mock('../hooks/useTrialStatus', () => ({
  useTrialStatus: () => (globalThis as Record<string, unknown>).__trialBadgeTrialReturn,
}));

type AuthReturn = { user: { userType: 'motorista' | 'embarcador' | 'admin' } | null };

function setAuth(value: AuthReturn) {
  (globalThis as Record<string, unknown>).__trialBadgeAuthReturn = value;
}

function setTrial(value: UseTrialStatusResult) {
  (globalThis as Record<string, unknown>).__trialBadgeTrialReturn = value;
}

let container: HTMLDivElement;
let root: Root;

function renderBadge(auth: AuthReturn, trial: UseTrialStatusResult) {
  setAuth(auth);
  setTrial(trial);
  act(() => {
    root = createRoot(container);
    root.render(createElement(TrialBadge));
  });
}

/** Pílula do badge (span com role="status"), ou null quando oculto. */
function badgeEl(): HTMLSpanElement | null {
  return container.querySelector('span[role="status"]');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('TrialBadge — render e mapeamento de tier', () => {
  it('exibe o texto exato "Teste grátis: {daysLeft} dias" para motorista não-assinante (Req 4.1)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 15, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    const el = badgeEl();
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('Teste grátis: 15 dias');
  });

  it('aplica classe verde (bg-green-100) quando daysLeft > 10 (Req 4.4)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 20, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    const el = badgeEl();
    expect(el).not.toBeNull();
    expect(el!.classList.contains('bg-green-100')).toBe(true);
    expect(el!.classList.contains('animate-pulse')).toBe(false);
  });

  it('aplica classe amarela (bg-yellow-100) quando 5 <= daysLeft <= 10 (Req 4.5)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 7, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    const el = badgeEl();
    expect(el).not.toBeNull();
    expect(el!.classList.contains('bg-yellow-100')).toBe(true);
    expect(el!.classList.contains('animate-pulse')).toBe(false);
  });

  it('aplica classe vermelha (bg-red-100) quando 1 < daysLeft < 5 (Req 4.6)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 3, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    const el = badgeEl();
    expect(el).not.toBeNull();
    expect(el!.classList.contains('bg-red-100')).toBe(true);
    expect(el!.classList.contains('animate-pulse')).toBe(false);
  });

  it('aplica vermelho pulsante (animate-pulse) quando daysLeft === 1 (Req 4.7)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 1, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    const el = badgeEl();
    expect(el).not.toBeNull();
    expect(el!.classList.contains('bg-red-100')).toBe(true);
    expect(el!.classList.contains('animate-pulse')).toBe(true);
    expect(el!.textContent).toBe('Teste grátis: 1 dias');
  });

  it('renderiza nada (oculto) quando daysLeft === 0 (Req 4.8)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 0, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    expect(badgeEl()).toBeNull();
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
  });

  it('permanece oculto para embarcador (Req 4.2)', () => {
    renderBadge(
      { user: { userType: 'embarcador' } },
      { daysLeft: 15, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    expect(badgeEl()).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('permanece oculto para admin (Req 4.2)', () => {
    renderBadge(
      { user: { userType: 'admin' } },
      { daysLeft: 15, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    expect(badgeEl()).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('permanece oculto para motorista assinante (Req 4.3)', () => {
    renderBadge(
      { user: { userType: 'motorista' } },
      { daysLeft: 15, isExpired: false, isSubscribed: true, status: 'active' }
    );

    expect(badgeEl()).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('permanece oculto quando não há usuário autenticado (Req 4.2)', () => {
    renderBadge(
      { user: null },
      { daysLeft: 15, isExpired: false, isSubscribed: false, status: 'trial' }
    );

    expect(badgeEl()).toBeNull();
    expect(container.textContent).toBe('');
  });
});
