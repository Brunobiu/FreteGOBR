/**
 * Testes de render/navegação da TrialExpiredPage (Tarefa 6.7 — opcional).
 *
 * Feature: trial-e-bloqueio
 * Valida:
 *   - Mensagem exata de bloqueio (Req 5.3)
 *   - Botão "Assinar" navega para /motorista/plano (Req 5.4)
 *   - Presença dos valores informativos de PLAN_INFO (Req 5.5)
 *
 * Nota de convenção: o projeto não usa @testing-library/react (não há nenhum
 * `.test.tsx` pré-existente e a lib não está instalada). Para não introduzir
 * dependência nova, renderizamos com `react-dom/client` + `React.act` sobre o
 * ambiente jsdom já configurado no vitest.
 *
 * Mock de `useNavigate` (steering): `vi.mock` é hoisted — NÃO referenciar
 * variáveis externas no factory. Expomos o spy via
 * `(globalThis as Record<string, unknown>).__navigateSpy`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import TrialExpiredPage, { PLAN_INFO } from '../pages/TrialExpiredPage';

// Mock parcial de react-router-dom: mantém MemoryRouter real e substitui
// apenas useNavigate por um spy exposto no globalThis (factory hoisted).
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  const spy = vi.fn();
  (globalThis as Record<string, unknown>).__navigateSpy = spy;
  return {
    ...actual,
    useNavigate: () => spy,
  };
});

function getNavigateSpy(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>).__navigateSpy as ReturnType<typeof vi.fn>;
}

let container: HTMLDivElement;
let root: Root;

function renderPage() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(TrialExpiredPage)));
  });
}

beforeEach(() => {
  getNavigateSpy().mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('TrialExpiredPage — render e navegação', () => {
  it('exibe a mensagem exata de bloqueio (Req 5.3)', () => {
    renderPage();
    expect(container.textContent).toContain('Seu teste expirou. Assine para continuar.');
  });

  it('possui botão "Assinar" que navega para /motorista/plano ao clicar (Req 5.4)', () => {
    renderPage();

    const buttons = Array.from(container.querySelectorAll('button'));
    const assinarBtn = buttons.find((b) => b.textContent?.trim() === 'Assinar');
    expect(assinarBtn).toBeDefined();

    act(() => {
      assinarBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getNavigateSpy()).toHaveBeenCalledTimes(1);
    expect(getNavigateSpy()).toHaveBeenCalledWith('/motorista/plano');
  });

  it('exibe os valores informativos dos planos PLAN_INFO (Req 5.5)', () => {
    renderPage();
    const text = container.textContent ?? '';

    // Valores principais
    expect(text).toContain('R$ 39,00');
    expect(text).toContain('R$ 87,00');
    expect(text).toContain('R$ 150,00');
    // Equivalentes mensais dos planos pagos de uma vez
    expect(text).toContain('R$ 29,00');
    expect(text).toContain('R$ 25,00');

    // Nomes dos planos derivados da constante exportada
    for (const plan of PLAN_INFO) {
      expect(text).toContain(plan.name);
      expect(text).toContain(plan.priceLabel);
      if (plan.detail) {
        expect(text).toContain(plan.detail);
      }
    }
  });
});
