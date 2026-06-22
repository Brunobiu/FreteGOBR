/**
 * Testes da expansão das páginas públicas:
 *   - Novas seções da LandingPage (Dor, Vantagens, Funcionalidades,
 *     Depoimentos, CTA final, Sobre) e cards de Vantagens linkando para
 *     /saiba/<slug>.
 *   - Ausência de "Planos" no menu (estratégia sem plano).
 *   - SaibaMaisPage: slug válido renderiza o tópico; slug inválido cai no 404.
 *   - PublicHeader: navegação ciente da rota (#id na home, /#id fora dela).
 *
 * Convenção do projeto (sem @testing-library): render manual via
 * react-dom/client (createRoot) + React.act, dentro de MemoryRouter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mocka os números públicos (RPC) — sem rede, determinístico. Factory hoisted.
vi.mock('../services/publicStats', () => ({
  getPublicStats: () => Promise.resolve({ fretes: 340, motoristas: 152, embarcadores: 207 }),
}));

import LandingPage from '../pages/LandingPage';
import SaibaMaisPage from '../pages/SaibaMaisPage';
import PublicHeader, { NAV_LINKS } from '../components/public/PublicHeader';
import {
  PAIN_TITLE,
  BENEFITS_TITLE,
  FEATURES_TITLE,
  TESTIMONIALS_TITLE,
  FINAL_CTA_TITLE,
  ABOUT,
  BENEFITS,
  TOPICS,
} from '../data/landingContent';

let container: HTMLDivElement;
let root: Root;

function anchors(): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'));
}
function hrefs(): (string | null)[] {
  return anchors().map((a) => a.getAttribute('href'));
}

beforeEach(() => {
  // jsdom não implementa scrollIntoView (usado no header/landing) nem
  // matchMedia nem HTMLMediaElement.play (autoplay do vídeo do hero).
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
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
  (
    HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }
  ).play = vi.fn().mockResolvedValue(undefined);

  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

function renderLanding() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(LandingPage)));
  });
}

function renderSaiba(slug: string) {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/saiba/${slug}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/saiba/:slug', element: createElement(SaibaMaisPage) })
        )
      )
    );
  });
}

function renderHeaderAt(path: string) {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(PublicHeader, { variant: 'solid' })
      )
    );
  });
}

describe('LandingPage — seções novas de marketing', () => {
  it('renderiza Dor, Vantagens, Funcionalidades, Depoimentos, CTA final e Sobre', () => {
    renderLanding();
    const text = container.textContent ?? '';
    expect(text).toContain(PAIN_TITLE);
    expect(text).toContain(BENEFITS_TITLE);
    expect(text).toContain(FEATURES_TITLE);
    expect(text).toContain(TESTIMONIALS_TITLE);
    expect(text).toContain(FINAL_CTA_TITLE);
    expect(text).toContain(ABOUT.title);
  });

  it('tem a âncora #vantagens (item do menu)', () => {
    renderLanding();
    expect(container.querySelector('#vantagens')).not.toBeNull();
  });

  it('cada card de Vantagem leva para /saiba/<slug>', () => {
    renderLanding();
    const all = hrefs();
    for (const b of BENEFITS) {
      expect(all, `vantagem "${b.title}" deve linkar para /saiba/${b.slug}`).toContain(
        `/saiba/${b.slug}`
      );
    }
  });

  it('não exibe "Planos" no menu (sem planos)', () => {
    renderLanding();
    const all = hrefs();
    expect(all).not.toContain('#planos');
    expect(all).not.toContain('/#planos');
  });
});

describe('SaibaMaisPage — página de detalhe por slug', () => {
  it('slug válido renderiza título e primeiro bloco do tópico', () => {
    const topic = TOPICS['frete-na-rota'];
    renderSaiba('frete-na-rota');
    const text = container.textContent ?? '';
    expect(text).toContain(topic.title);
    expect(text).toContain(topic.blocks[0].heading);
  });

  it('slug inexistente cai no 404', () => {
    renderSaiba('slug-que-nao-existe-123');
    const text = container.textContent ?? '';
    expect(text).toContain('404');
  });
});

describe('PublicHeader — navegação ciente da rota', () => {
  it('fora da landing, os links apontam para /#secao', () => {
    renderHeaderAt('/para-embarcadores');
    const all = hrefs();
    for (const link of NAV_LINKS) {
      expect(all, `link "${link.label}" deve apontar para /#${link.id}`).toContain(`/#${link.id}`);
    }
  });

  it('na landing, os links são âncoras locais #secao', () => {
    renderHeaderAt('/');
    const all = hrefs();
    for (const link of NAV_LINKS) {
      expect(all, `link "${link.label}" deve ser âncora local #${link.id}`).toContain(
        `#${link.id}`
      );
    }
  });

  it('o menu mobile expõe o botão acessível (aria-controls)', () => {
    renderHeaderAt('/');
    const btn = container.querySelector('button[aria-controls="mobile-menu"]');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-expanded')).toBe('false');
  });
});
