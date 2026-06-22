/**
 * Testes do AccessChoice — modal "Baixar o app ou continuar na web" disparado
 * pelos CTAs que levam a cadastro/login.
 *
 * Convenção do projeto (sem @testing-library): render manual via
 * react-dom/client (createRoot) + React.act, dentro de MemoryRouter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AccessChoiceProvider, AccessButton } from '../components/public/AccessChoice';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}
function anchors(): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'));
}
function clickButton(text: string) {
  const btn = buttons().find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`Botão "${text}" não encontrado`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Provider + rotas: '/' tem o CTA; '/register' marca que navegou. */
function renderWithProvider(to: string, label: string) {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        createElement(
          AccessChoiceProvider,
          null,
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/',
              element: createElement(AccessButton, { to, children: label }),
            }),
            createElement(Route, {
              path: '/register',
              element: createElement('div', null, 'PAGINA_REGISTER'),
            }),
            createElement(Route, {
              path: '/fretes',
              element: createElement('div', null, 'PAGINA_FRETES'),
            })
          )
        )
      )
    );
  });
}

describe('AccessChoice — CTA de cadastro abre o modal de escolha', () => {
  it('clicar num CTA para /register abre o modal com App Store, Google Play e opção web', () => {
    renderWithProvider('/register', 'Criar conta grátis');
    // antes do clique, sem modal
    expect(container.textContent).not.toContain('Como você prefere usar o FreteGO?');

    clickButton('Criar conta grátis');

    const text = container.textContent ?? '';
    expect(text).toContain('Como você prefere usar o FreteGO?');
    expect(text).toContain('App Store');
    expect(text).toContain('Google Play');
    expect(text).toContain('Continuar na versão web');
    // os botões de loja apontam para a página "app em breve"
    const storeHrefs = anchors().map((a) => a.getAttribute('href'));
    expect(storeHrefs).toContain('/links/app.html');
  });

  it('"Continuar na versão web" navega para o destino original', () => {
    renderWithProvider('/register', 'Criar conta grátis');
    clickButton('Criar conta grátis');
    expect(container.textContent).toContain('Como você prefere usar o FreteGO?');

    clickButton('Continuar na versão web');

    const text = container.textContent ?? '';
    expect(text).toContain('PAGINA_REGISTER');
    expect(text).not.toContain('Como você prefere usar o FreteGO?');
  });

  it('CTA para rota não-auth (/fretes) é link normal, sem modal', () => {
    renderWithProvider('/fretes', 'Ver fretes');
    // renderiza como <a href="/fretes">, não como botão que abre modal
    const link = anchors().find((a) => a.getAttribute('href') === '/fretes');
    expect(link).toBeDefined();
    expect(container.textContent).not.toContain('Como você prefere usar o FreteGO?');
  });
});

describe('AccessChoice — fallback sem provider', () => {
  it('sem o provider, AccessButton vira um <Link> normal (não quebra)', () => {
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(AccessButton, { to: '/register', children: 'Entrar' })
        )
      );
    });
    const link = anchors().find((a) => a.getAttribute('href') === '/register');
    expect(link).toBeDefined();
    expect(link!.textContent).toContain('Entrar');
  });
});
