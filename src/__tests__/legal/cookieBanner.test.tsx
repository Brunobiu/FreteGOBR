/**
 * Testes de render do CookieBanner + ponte de consentimento com o Pixel
 * (Feature 3 — legal-banner-cookies).
 *
 * Property 2: banner aparece sse e somente se não há decisão válida.
 * Property 3: o consentimento de `marketing` controla a porta do Pixel
 *   (`getConsentState` em services/marketing/consent.ts).
 *
 * Convenção do projeto: sem @testing-library; render via react-dom/client +
 * MemoryRouter.
 *
 * Validates: Requirements 1.1, 1.5, 2.1, 4.1, 4.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { CookieConsentProvider } from '../../components/cookies/CookieConsentProvider';
import CookieBanner from '../../components/cookies/CookieBanner';
import { STORAGE_KEY } from '../../services/cookieConsent';
import { getConsentState, setConsentState } from '../../services/marketing/consent';

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(CookieConsentProvider, null, createElement(CookieBanner))
      )
    );
  });
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text
  );
}

beforeEach(() => {
  localStorage.clear();
  setConsentState('denied');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe('CookieBanner', () => {
  it('Property 2: aparece quando não há decisão registrada', () => {
    render();
    expect(findButtonByText('Aceitar')).toBeDefined();
    expect(findButtonByText('Configurar')).toBeDefined();
  });

  it('contém link para a Política de Privacidade', () => {
    render();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/privacidade'
    );
    expect(link).toBeDefined();
  });

  it('Property 2: não aparece quando já há decisão válida', () => {
    render();
    act(() => {
      findButtonByText('Aceitar')!.click();
    });
    expect(findButtonByText('Aceitar')).toBeUndefined();
    expect(findButtonByText('Configurar')).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('Property 3: "Aceitar" concede marketing → porta do Pixel = granted', () => {
    render();
    act(() => {
      findButtonByText('Aceitar')!.click();
    });
    expect(getConsentState()).toBe('granted');
  });

  it('Property 3: estado inicial (sem decisão) mantém a porta do Pixel = denied', () => {
    render();
    expect(getConsentState()).toBe('denied');
  });
});
