/**
 * Smoke test da FretesAoVivoPage (/fretes-ao-vivo) — a vitrine pública
 * "tempo real" aberta pelo "Ver mais" da landing.
 *
 * Determinístico: mocka o hook de dados (sem Supabase/realtime) e o mapa
 * (sem Leaflet no jsdom). Verifica o que importa:
 *   - título e a lista "Últimos fretes lançados";
 *   - os cards mostram a rota e o selo "Comunidade" quando é da comunidade;
 *   - o VALOR do frete NUNCA aparece (regra de privacidade da vitrine pública).
 *
 * Convenção do projeto (sem @testing-library): render manual via
 * react-dom/client (createRoot) + React.act, dentro de MemoryRouter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// Dados fixos (sem rede/realtime). Inclui um frete de embarcador e um da
// comunidade; o valor (R$) propositalmente NÃO faz parte do shape público.
vi.mock('../hooks/usePublicFretes', () => ({
  usePublicFretes: () => ({
    fretes: [
      {
        id: '1',
        origin: 'Goiânia, GO',
        destination: 'São Paulo, SP',
        point: { latitude: -16.6, longitude: -49.2 },
        cargoType: 'Soja',
        product: 'Soja',
        vehicleType: 'Carreta',
        createdAt: new Date(),
        source: 'embarcador',
      },
      {
        id: '2',
        origin: 'Rio Verde, GO',
        destination: 'Uberlândia, MG',
        point: { latitude: -17.7, longitude: -50.9 },
        cargoType: 'Milho',
        vehicleType: 'Truck',
        createdAt: new Date(),
        source: 'comunidade',
      },
    ],
    error: false,
  }),
}));

// Evita carregar o Leaflet no jsdom — o mapa não é o foco deste teste.
vi.mock('../components/public/LandingFretesMap', () => ({
  default: () => createElement('div', { 'data-testid': 'mapa-mock' }),
}));

import FretesAoVivoPage from '../pages/FretesAoVivoPage';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  await act(async () => {
    await Promise.resolve();
  });
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

function render() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(FretesAoVivoPage)));
  });
}

describe('FretesAoVivoPage — vitrine pública de fretes em tempo real', () => {
  it('exibe o título, a lista e os cards (rota + selo comunidade)', () => {
    render();
    const text = container.textContent ?? '';
    expect(text).toContain('Veja os fretes em tempo real');
    expect(text).toContain('Últimos fretes lançados');
    expect(text).toContain('Goiânia, GO');
    expect(text).toContain('São Paulo, SP');
    expect(text).toContain('Rio Verde, GO');
    expect(text).toContain('Comunidade'); // selo do frete da comunidade
  });

  it('NÃO expõe o valor do frete na vitrine pública', () => {
    render();
    const text = container.textContent ?? '';
    expect(text).not.toContain('R$');
  });
});
