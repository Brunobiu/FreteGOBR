/**
 * Testes de bloqueio de interação do LikeButton (Tarefa 15.1).
 *
 * Feature: assinaturas-pagamento
 * Valida (Req 6.1, 6.2, 6.3, 15.x):
 *   - Motorista suspenso/cancelado NÃO dispara a curtida (toggleFreteLike não
 *     é chamado) e recebe a mensagem pt-BR via onBlocked.
 *   - Motorista ativo/trial dispara a curtida normalmente.
 *   - Embarcador não interage (silencioso, sem chamar o serviço).
 *
 * Convenção do projeto: sem @testing-library. Render manual com
 * `react-dom/client` (createRoot) + `React.act`. `vi.mock` é hoisted: os
 * retornos mutáveis são expostos via globalThis e os spies idem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import LikeButton, { SUSPENDED_INTERACTION_MESSAGE } from '../components/LikeButton';
import type { UseTrialStatusResult } from '../hooks/useTrialStatus';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => (globalThis as Record<string, unknown>).__likeAuthReturn,
}));

vi.mock('../hooks/useTrialStatus', () => ({
  useTrialStatus: () => (globalThis as Record<string, unknown>).__likeTrialReturn,
}));

// useNavigate: spy exposto via globalThis (sem referência externa no factory).
vi.mock('react-router-dom', () => ({
  useNavigate: () => (globalThis as Record<string, unknown>).__likeNavigateSpy,
}));

// Serviço de like: spy exposto via globalThis.
vi.mock('../services/likes', () => ({
  toggleFreteLike: (...args: unknown[]) =>
    (
      (globalThis as Record<string, unknown>).__toggleLikeSpy as (
        ...a: unknown[]
      ) => Promise<unknown>
    )(...args),
}));

type AuthReturn = {
  user: { userType: 'motorista' | 'embarcador' | 'admin' } | null;
  isAuthenticated: boolean;
};

function setAuth(value: AuthReturn) {
  (globalThis as Record<string, unknown>).__likeAuthReturn = value;
}
function setTrial(value: UseTrialStatusResult) {
  (globalThis as Record<string, unknown>).__likeTrialReturn = value;
}

let container: HTMLDivElement;
let root: Root;
let toggleSpy: ReturnType<typeof vi.fn>;
let navigateSpy: ReturnType<typeof vi.fn>;

function renderButton(
  auth: AuthReturn,
  trial: UseTrialStatusResult,
  onBlocked?: (m: string) => void
) {
  setAuth(auth);
  setTrial(trial);
  act(() => {
    root = createRoot(container);
    root.render(createElement(LikeButton, { freteId: 'frete-1', onBlocked }));
  });
}

function clickButton() {
  const btn = container.querySelector('button');
  act(() => {
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const TRIAL_ATIVO: UseTrialStatusResult = {
  daysLeft: 10,
  isExpired: false,
  isSubscribed: false,
  status: 'trial',
};
const SUSPENSO: UseTrialStatusResult = {
  daysLeft: 0,
  isExpired: true,
  isSubscribed: false,
  status: 'blocked',
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  toggleSpy = vi.fn().mockResolvedValue({ liked: true, total: 1 });
  navigateSpy = vi.fn();
  (globalThis as Record<string, unknown>).__toggleLikeSpy = toggleSpy;
  (globalThis as Record<string, unknown>).__likeNavigateSpy = navigateSpy;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

describe('LikeButton — bloqueio de interação do suspenso', () => {
  it('motorista suspenso NÃO dispara a curtida e recebe aviso pt-BR (Req 6.3)', () => {
    const onBlocked = vi.fn();
    renderButton({ user: { userType: 'motorista' }, isAuthenticated: true }, SUSPENSO, onBlocked);

    clickButton();

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith(SUSPENDED_INTERACTION_MESSAGE);
    expect(SUSPENDED_INTERACTION_MESSAGE).toMatch(/suspensa/i);
  });

  it('motorista suspenso sem onBlocked é levado para a página de planos (CTA)', () => {
    renderButton({ user: { userType: 'motorista' }, isAuthenticated: true }, SUSPENSO);

    clickButton();

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/motorista/plano');
  });

  it('motorista em trial ativo dispara a curtida normalmente', () => {
    renderButton({ user: { userType: 'motorista' }, isAuthenticated: true }, TRIAL_ATIVO);

    clickButton();

    expect(toggleSpy).toHaveBeenCalledWith('frete-1');
  });

  it('visitante não autenticado é levado ao login (sem curtir)', () => {
    renderButton({ user: null, isAuthenticated: false }, TRIAL_ATIVO);

    clickButton();

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });

  it('embarcador não interage (silencioso, sem chamar o serviço)', () => {
    const onBlocked = vi.fn();
    renderButton(
      { user: { userType: 'embarcador' }, isAuthenticated: true },
      { daysLeft: 0, isExpired: false, isSubscribed: false, status: 'trial' },
      onBlocked
    );

    clickButton();

    expect(toggleSpy).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
