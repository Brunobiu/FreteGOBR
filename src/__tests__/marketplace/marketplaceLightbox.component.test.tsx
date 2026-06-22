/**
 * Testes do MarketplaceLightbox (galeria em tela cheia).
 *
 * Valida: contador "X de N"; navegação avança o contador; botão voltar chama
 * onClose; trava o scroll do body enquanto aberto.
 *
 * Convenção: react-dom/client + React.act (sem @testing-library).
 *
 * Validates: Requirements 8.5, 8.6, 8.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import MarketplaceLightbox from '../../components/marketplace/MarketplaceLightbox';

const PHOTOS = ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'];

let container: HTMLDivElement;
let root: Root;

function render(props: { startIndex: number; onClose: () => void }) {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MarketplaceLightbox, { photoUrls: PHOTOS, ...props }));
  });
}

function clickByLabel(label: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === label
  );
  act(() => {
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

describe('MarketplaceLightbox', () => {
  it('exibe o contador "X de N" a partir do startIndex', () => {
    render({ startIndex: 0, onClose: vi.fn() });
    expect(container.textContent).toContain('1 de 3');
  });

  it('avança para a próxima foto e atualiza o contador', () => {
    render({ startIndex: 0, onClose: vi.fn() });
    clickByLabel('Próxima foto');
    expect(container.textContent).toContain('2 de 3');
  });

  it('botão voltar chama onClose', () => {
    const onClose = vi.fn();
    render({ startIndex: 1, onClose });
    clickByLabel('Voltar');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('trava o scroll do body enquanto aberto', () => {
    render({ startIndex: 0, onClose: vi.fn() });
    expect(document.body.style.overflow).toBe('hidden');
  });
});
