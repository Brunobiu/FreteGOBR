/**
 * Testes do ScrollManager — restauração de scroll na navegação.
 *
 * jsdom não tem scroll real (window.scrollY é sempre 0), então validamos o
 * comportamento observável: ao navegar para frente (PUSH) o componente chama
 * window.scrollTo(0, 0). Stubamos window.scrollTo (jsdom não implementa).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import ScrollManager from '../components/ScrollManager';

let container: HTMLDivElement;
let root: Root;
let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollSpy = vi.fn();
  (window as unknown as Record<string, unknown>).scrollTo = scrollSpy;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

/** Botão que navega pra frente (PUSH) via useNavigate. */
function Pusher() {
  const navigate = useNavigate();
  return createElement('button', { type: 'button', onClick: () => navigate('/b') }, 'ir');
}

function render() {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/a'] },
        createElement(ScrollManager),
        createElement(Pusher),
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/a', element: createElement('div', null, 'A') }),
          createElement(Route, { path: '/b', element: createElement('div', null, 'B') })
        )
      )
    );
  });
}

describe('ScrollManager', () => {
  it('monta sem quebrar e não renderiza nada visível próprio', () => {
    render();
    expect(container.textContent).toContain('A');
  });

  it('ao navegar para uma página nova (PUSH), rola para o topo (0, 0)', () => {
    render();
    scrollSpy.mockClear(); // ignora o scroll do mount inicial

    const btn = container.querySelector('button');
    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // navegou para /b
    expect(container.textContent).toContain('B');
    // e rolou para o topo
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });
});
