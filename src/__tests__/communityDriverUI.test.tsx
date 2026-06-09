/**
 * Testes de UI Motorista — Frete Comunidade (spec frete-comunidade, Fase 6 / task 19.1).
 *
 * Convenção do projeto: sem @testing-library. react-dom/client + React.act +
 * MemoryRouter. `vi.mock` hoisted.
 *
 * Cobre o FreteCard:
 *   - source='comunidade' exibe "Frete Comunidade" + "Frete sugerido pela comunidade";
 *   - frete normal (embarcador) NÃO exibe a identidade comunidade (não-regressão).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import type { Frete } from '../services/fretes';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'm1', userType: 'motorista', name: 'M' } }),
}));

// LikeButton importa serviços; stub simples para isolar o card.
vi.mock('../components/LikeButton', () => ({
  default: () => null,
}));

import FreteCard from '../components/FreteCard';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function baseFrete(over: Partial<Frete>): Frete {
  return {
    id: 'f1',
    embarcadorId: null,
    origin: 'Goiânia - GO',
    originLocation: { latitude: -16.6, longitude: -49.3 },
    destination: 'Uberlândia - MG',
    destinationLocation: { latitude: -18.9, longitude: -48.3 },
    cargoType: 'comunidade',
    vehicleType: 'indefinido',
    weight: 0,
    value: 8500,
    deadline: new Date('2030-01-01'),
    loadingTime: 0,
    unloadingTime: 0,
    status: 'ativo',
    viewsCount: 0,
    clicksCount: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function render(frete: Frete) {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(FreteCard, {
          frete,
          onClick: () => {},
          communityProfile: { name: 'Comunidade FreteGO', photoUrl: null },
        })
      )
    );
  });
}

describe('FreteCard — identidade comunidade', () => {
  it('source=comunidade exibe a identidade comunidade', () => {
    render(baseFrete({ source: 'comunidade', communityCarrierName: 'Transp A' }));
    const text = container.textContent ?? '';
    expect(text).toContain('Frete Comunidade');
    expect(text).toContain('Frete sugerido pela comunidade');
  });

  it('frete de embarcador NÃO exibe identidade comunidade (não-regressão)', () => {
    render(baseFrete({ source: 'embarcador', embarcadorId: 'e1' }));
    const text = container.textContent ?? '';
    expect(text).not.toContain('Frete sugerido pela comunidade');
  });
});
