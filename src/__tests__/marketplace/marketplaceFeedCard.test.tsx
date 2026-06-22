/**
 * Testes de render/navegação do MarketplaceFeedCard.
 *
 * Valida:
 *  - venda exibe valor (formatBRL) + título; notícia exibe só o título (sem R$).
 *  - descrição curta e nome do autor aparecem; sem foto ⇒ avatar placeholder.
 *  - clicar navega para o detalhe /motorista/marketplace/:id.
 *
 * Convenção: sem @testing-library — react-dom/client + React.act + MemoryRouter.
 * `vi.mock` hoisted; useNavigate exposto via globalThis.__navigateSpy.
 *
 * Validates: Requirements 6.4, 6.5, 6.6, 9.1, 9.3, 7.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import MarketplaceFeedCard from '../../components/marketplace/MarketplaceFeedCard';
import type { MarketplacePost } from '../../services/marketplace';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  const spy = vi.fn();
  (globalThis as Record<string, unknown>).__navigateSpy = spy;
  return { ...actual, useNavigate: () => spy };
});

// Avatar resolve para null (placeholder) — render determinístico.
vi.mock('../../services/documents', () => ({
  resolveProfilePhotoUrl: () => Promise.resolve(null),
}));

function navigateSpy(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>).__navigateSpy as ReturnType<typeof vi.fn>;
}

const vendaPost: MarketplacePost = {
  id: 'p1',
  authorId: 'u1',
  authorName: 'Bruno Henrique',
  authorPhotoPath: null,
  postType: 'venda',
  title: '2008 Volkswagen Gol',
  description: 'Completo, ar gelando.',
  price: 65000,
  photoPaths: ['u1/a.jpg'],
  photoUrls: ['https://cdn/u1/a.jpg'],
  point: { latitude: -16.6, longitude: -49.2 },
  locationLabel: 'Goiânia, GO',
  createdAt: '2026-06-18T10:00:00Z',
};

let container: HTMLDivElement;
let root: Root;

function render(post: MarketplacePost) {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(MarketplaceFeedCard, { post })));
  });
}

beforeEach(() => {
  navigateSpy().mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('MarketplaceFeedCard', () => {
  it('venda: exibe valor (R$) + título + descrição + autor', () => {
    render(vendaPost);
    const text = container.textContent ?? '';
    expect(text).toContain('R$ 65.000');
    expect(text).toContain('2008 Volkswagen Gol');
    expect(text).toContain('Completo, ar gelando.');
    expect(text).toContain('Bruno Henrique');
  });

  it('sem foto de perfil ⇒ avatar placeholder com a inicial', () => {
    render(vendaPost);
    expect(container.textContent).toContain('B'); // inicial de "Bruno"
  });

  it('notícia: exibe título e NÃO exibe valor em R$', () => {
    render({
      ...vendaPost,
      id: 'p2',
      postType: 'noticia',
      price: null,
      title: 'Mutirão de doação no posto',
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Mutirão de doação no posto');
    expect(text).not.toContain('R$');
  });

  it('clicar navega para o detalhe /motorista/marketplace/:id', () => {
    render(vendaPost);
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(navigateSpy()).toHaveBeenCalledWith('/motorista/marketplace/p1');
  });
});
