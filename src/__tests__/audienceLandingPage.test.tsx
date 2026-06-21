/**
 * Smoke test da AudienceLandingPage (páginas públicas /para-embarcadores e
 * /para-caminhoneiros).
 *
 * Valida, para os dois públicos: headline do hero, título de benefícios,
 * todos os itens de benefício e o CTA principal apontando para /register,
 * além do link "Voltar" para a home.
 *
 * Convenção do projeto (sem @testing-library): render manual via
 * react-dom/client + React.act dentro de MemoryRouter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import AudienceLandingPage from '../pages/AudienceLandingPage';
import { CONTENT, type Audience } from '../data/audienceContent';

let container: HTMLDivElement;
let root: Root;

function renderPage(audience: Audience) {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(MemoryRouter, null, createElement(AudienceLandingPage, { audience }))
    );
  });
}

function anchors(): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'));
}

function hasHref(href: string): boolean {
  return anchors().some((a) => a.getAttribute('href') === href);
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

describe('AudienceLandingPage', () => {
  it('embarcador: headline, benefícios e CTA para /register', () => {
    renderPage('embarcador');
    const text = container.textContent ?? '';
    const cfg = CONTENT.embarcador;
    expect(text).toContain(cfg.heroTitle);
    expect(text).toContain(cfg.benefitsTitle);
    for (const b of cfg.benefits) {
      expect(text, `benefício "${b.title}" deve aparecer`).toContain(b.title);
    }
    expect(hasHref('/register')).toBe(true);
  });

  it('motorista: headline, benefícios e CTA para /register', () => {
    renderPage('motorista');
    const text = container.textContent ?? '';
    const cfg = CONTENT.motorista;
    expect(text).toContain(cfg.heroTitle);
    expect(text).toContain(cfg.benefitsTitle);
    for (const b of cfg.benefits) {
      expect(text, `benefício "${b.title}" deve aparecer`).toContain(b.title);
    }
    expect(hasHref('/register')).toBe(true);
  });

  it('tem link "Voltar" para a home (/)', () => {
    renderPage('embarcador');
    expect(hasHref('/')).toBe(true);
  });
});
