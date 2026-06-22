/**
 * Testes do FreteTicker (faixa de fretes do hero) e do AuthShell (moldura
 * 2 colunas das telas de login/cadastro, com a foto alternando por público).
 *
 * Convenção do projeto: render manual via react-dom/client + React.act.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import FreteTicker from '../components/public/FreteTicker';
import AuthShell, { type AuthAudience } from '../components/public/AuthShell';
import { FRETE_TICKER } from '../data/landingContent';

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

function imgSrcs(): string[] {
  return Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src') ?? '');
}

describe('FreteTicker', () => {
  it('renderiza os fretes (rota, carga e valor) e é decorativo (aria-hidden)', () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(FreteTicker));
    });
    const text = container.textContent ?? '';
    const first = FRETE_TICKER[0];
    expect(text).toContain(first.rota);
    expect(text).toContain(first.carga);
    expect(text).toContain(first.valor);
    // marcado como decorativo pra não poluir leitores de tela
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('duplica a lista para o loop sem emenda', () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(FreteTicker));
    });
    // cada item aparece 2x (lista + cópia)
    const chips = container.querySelectorAll('.frete-marquee-track > span');
    expect(chips.length).toBe(FRETE_TICKER.length * 2);
  });
});

describe('AuthShell — foto da direita alterna por público', () => {
  function renderShell(audience: AuthAudience) {
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(AuthShell, { audience, children: createElement('div', null, 'FORM_AQUI') })
        )
      );
    });
  }

  it('renderiza o formulário (children) na coluna esquerda', () => {
    renderShell('motorista');
    expect(container.textContent).toContain('FORM_AQUI');
  });

  it('caminhoneiro → foto do motorista', () => {
    renderShell('motorista');
    expect(imgSrcs()).toContain('/audience-motorista.jpg');
  });

  it('embarcador → foto do embarcador', () => {
    renderShell('embarcador');
    expect(imgSrcs()).toContain('/audience-embarcador.jpg');
  });

  it('sem escolha (null) → imagem neutra do caminhão', () => {
    renderShell(null);
    expect(imgSrcs()).toContain('/landing-fundo.jpg');
  });
});
