/**
 * Smoke test da LandingPage (porta de entrada pública, rota `/`).
 *
 * Cobre a estrutura entregue no redesign:
 *   - Headline autoral do hero ("Sem intermediário.").
 *   - Logo no header.
 *   - Links de navegação (NAV_LINKS) presentes.
 *   - Botões de loja (App Store / Google Play) apontando para as URLs
 *     configuradas (APP_STORE_URL / PLAY_STORE_URL).
 *   - Botão "Entrar" navegando para /login.
 *   - Hambúrguer mobile abre/fecha o menu (aria-expanded + #mobile-menu).
 *
 * Convenção do projeto (sem @testing-library): render manual via
 * `react-dom/client` (`createRoot`) + `React.act`, dentro de `MemoryRouter`
 * (mesma abordagem de trialExpiredPage / motorista_bottom_nav).
 *
 * jsdom não implementa `scrollIntoView`; o `goToSection` da página chama esse
 * método, então o stubamos por um `vi.fn()` no setup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// Mocka os números públicos (RPC) com dados fixos — sem rede, determinístico.
// Factory hoisted: não referencia variáveis externas.
vi.mock('../services/publicStats', () => ({
  getPublicStats: () => Promise.resolve({ fretes: 340, motoristas: 152, embarcadores: 207 }),
}));

import LandingPage, { NAV_LINKS, APP_STORE_URL, PLAY_STORE_URL } from '../pages/LandingPage';

let container: HTMLDivElement;
let root: Root;

function renderPage() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(LandingPage)));
  });
}

/** Render assíncrono + flush do getPublicStats (para asserções dos números). */
async function renderPageAsync() {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(LandingPage)));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Todas as âncoras renderizadas (logo, nav, badges, CTAs, footer...). */
function anchors(): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'));
}

/** Primeira âncora cujo texto (trim) bate exatamente. */
function anchorByText(text: string): HTMLAnchorElement | undefined {
  return anchors().find((a) => a.textContent?.trim() === text);
}

/** Primeira âncora que contém o trecho de texto informado. */
function anchorContaining(text: string): HTMLAnchorElement | undefined {
  return anchors().find((a) => a.textContent?.includes(text));
}

beforeEach(() => {
  // jsdom não implementa scrollIntoView — stub para o goToSection não quebrar.
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
  // jsdom não implementa matchMedia (guard de prefers-reduced-motion do hero)
  // nem HTMLMediaElement.play (autoplay do vídeo de fundo) — stubamos ambos.
  if (!window.matchMedia) {
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q: string) =>
      ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList;
  }
  (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = vi
    .fn()
    .mockResolvedValue(undefined);
  // jsdom não implementa IntersectionObserver (usado pelo SocialRail) — stub.
  if (!('IntersectionObserver' in window)) {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  // Flush de updates assíncronos (getPublicStats) dentro de act, evitando
  // warning de "act(...)" quando a promise resolve após um teste síncrono.
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

describe('LandingPage — hero e conteúdo', () => {
  it('exibe a headline autoral do hero', () => {
    renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Fretes que ficam');
    expect(text).toContain('Sem intermediário.');
  });

  it('renderiza a logo do FreteGO no header', () => {
    renderPage();
    const logo = container.querySelector('img[alt="FreteGO"]');
    expect(logo).not.toBeNull();
  });

  it('usa vídeo de fundo em loop (mudo, autoplay, playsInline) com poster', () => {
    renderPage();
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.hasAttribute('loop')).toBe(true);
    expect(video!.hasAttribute('autoplay')).toBe(true);
    expect(video!.getAttribute('poster')).toBe('/landing-hero-poster.jpg');
    const source = video!.querySelector('source');
    expect(source?.getAttribute('src')?.startsWith('/landing-hero.mp4')).toBe(true);
  });
});

describe('LandingPage — navegação', () => {
  it('renderiza todos os links de navegação (NAV_LINKS) com âncora correta', () => {
    renderPage();
    for (const link of NAV_LINKS) {
      const a = anchorByText(link.label);
      expect(a, `link "${link.label}" deve existir`).toBeDefined();
      expect(a!.getAttribute('href')).toBe(`#${link.id}`);
    }
  });

  it('possui botão "Entrar" que aponta para /login', () => {
    renderPage();
    const entrar = anchorByText('Entrar');
    expect(entrar).toBeDefined();
    expect(entrar!.getAttribute('href')).toBe('/login');
  });
});

describe('LandingPage — botões de loja', () => {
  it('renderiza o botão da App Store apontando para APP_STORE_URL', () => {
    renderPage();
    const appStore = anchorContaining('App Store');
    expect(appStore).toBeDefined();
    expect(appStore!.getAttribute('href')).toBe(APP_STORE_URL);
  });

  it('renderiza o botão do Google Play apontando para PLAY_STORE_URL', () => {
    renderPage();
    const play = anchorContaining('Google Play');
    expect(play).toBeDefined();
    expect(play!.getAttribute('href')).toBe(PLAY_STORE_URL);
  });
});

describe('LandingPage — menu mobile (hambúrguer)', () => {
  function menuButton(): HTMLButtonElement {
    const btn = container.querySelector(
      'button[aria-controls="mobile-menu"]'
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    return btn!;
  }

  it('inicia fechado (aria-expanded=false e sem #mobile-menu)', () => {
    renderPage();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });

  it('abre ao clicar no hambúrguer e fecha ao clicar de novo', () => {
    renderPage();

    act(() => {
      menuButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#mobile-menu')).not.toBeNull();

    act(() => {
      menuButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });

  it('fecha o menu ao clicar em um link de navegação', () => {
    renderPage();

    act(() => {
      menuButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const menu = container.querySelector('#mobile-menu');
    expect(menu).not.toBeNull();

    const firstLink = menu!.querySelector('a') as HTMLAnchorElement;
    act(() => {
      firstLink.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });
});

describe('LandingPage — números públicos (RPC public_stats)', () => {
  it('exibe as contagens reais de fretes, caminhoneiros e embarcadores', async () => {
    await renderPageAsync();
    const text = container.textContent ?? '';
    expect(text).toContain('Nossos números');
    expect(text).toContain('340'); // fretes
    expect(text).toContain('152'); // caminhoneiros
    expect(text).toContain('207'); // embarcadores
    expect(text).toContain('Caminhoneiros');
    expect(text).toContain('Embarcadores');
  });

  it('mantém a seção visível mesmo durante o carregamento (sempre renderizada)', () => {
    renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Nossos números');
    expect(text).toContain('Fretes ativos');
  });
});
