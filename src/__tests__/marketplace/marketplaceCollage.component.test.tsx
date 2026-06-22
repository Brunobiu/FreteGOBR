/**
 * Testes de render do MarketplacePhotoCollage (estilo Facebook).
 *
 * Valida: no máximo 4 quadros; overlay "+N" no último quando há mais de 4;
 * tocar em um quadro chama onOpen com o índice da foto.
 *
 * Convenção: react-dom/client + React.act (sem @testing-library).
 *
 * Validates: Requirements 8.1, 8.2, 8.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import MarketplacePhotoCollage from '../../components/marketplace/MarketplacePhotoCollage';

function urls(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `https://cdn/p${i}.jpg`);
}

let container: HTMLDivElement;
let root: Root;

function render(photoUrls: string[], onOpen: (i: number) => void) {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MarketplacePhotoCollage, { photoUrls, onOpen }));
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

describe('MarketplacePhotoCollage', () => {
  it('10 fotos ⇒ 4 quadros e overlay "+6" no último', () => {
    render(urls(10), vi.fn());
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(4);
    expect(container.textContent).toContain('+6');
  });

  it('2 fotos ⇒ 2 quadros e sem overlay', () => {
    render(urls(2), vi.fn());
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.textContent).not.toContain('+');
  });

  it('4 fotos ⇒ 4 quadros e sem overlay', () => {
    render(urls(4), vi.fn());
    expect(container.querySelectorAll('button')).toHaveLength(4);
    expect(container.textContent).not.toContain('+');
  });

  it('tocar em um quadro chama onOpen com o índice', () => {
    const onOpen = vi.fn();
    render(urls(3), onOpen);
    const buttons = container.querySelectorAll('button');
    act(() => {
      buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
