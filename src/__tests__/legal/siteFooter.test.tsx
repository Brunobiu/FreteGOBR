/**
 * Testes de render do SiteFooter (Feature 1 — legal, Tarefa 8).
 *
 * Property 3: links do rodapé apontam para as rotas legais corretas.
 *
 * Convenção (sem @testing-library): render via react-dom/client + MemoryRouter.
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import SiteFooter from '../../components/SiteFooter';
import { LEGAL_DOCS } from '../../data/legal';

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(SiteFooter)));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SiteFooter', () => {
  it('renderiza link para Termos com href correto', () => {
    render();
    const links = Array.from(container.querySelectorAll('a'));
    const termos = links.find((a) => a.getAttribute('href') === LEGAL_DOCS.terms.route);
    expect(termos).toBeDefined();
    expect(termos!.textContent).toContain('Termos de Uso');
  });

  it('renderiza link para Privacidade com href correto', () => {
    render();
    const links = Array.from(container.querySelectorAll('a'));
    const priv = links.find((a) => a.getAttribute('href') === LEGAL_DOCS.privacy.route);
    expect(priv).toBeDefined();
    expect(priv!.textContent).toContain('Política de Privacidade');
  });

  it('exibe o ano corrente no copyright', () => {
    render();
    expect(container.textContent).toContain(String(new Date().getFullYear()));
    expect(container.textContent).toContain('FreteGO');
  });
});
