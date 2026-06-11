/**
 * Teste de regressão — RotaTimeline (timeline origem→destino do modal).
 *
 * Garante o comportamento pedido pelo usuário e evita regressões futuras:
 *   1. Cidades de origem e destino aparecem.
 *   2. O LOCAL de carregamento/descarga é o próprio LINK clicável (âncora),
 *      apontando para o Google Maps quando há coordenadas.
 *   3. Sem coordenadas, o local aparece como texto simples (não vira link).
 *
 * Convenção do projeto: não usa @testing-library/react. Render manual via
 * react-dom/client (createRoot) + React.act sobre o jsdom do vitest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import RotaTimeline from '../components/RotaTimeline';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function render(props: Parameters<typeof RotaTimeline>[0]) {
  act(() => {
    root = createRoot(container);
    root.render(createElement(RotaTimeline, props));
  });
}

describe('RotaTimeline', () => {
  it('exibe cidades de origem e destino', () => {
    render({
      origem: { cidade: 'Catalão, GO' },
      destino: { cidade: 'Belo Horizonte, MG' },
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Catalão, GO');
    expect(text).toContain('Belo Horizonte, MG');
  });

  it('o local de carregamento é um link clicável para o Google Maps', () => {
    render({
      origem: {
        cidade: 'Catalão, GO',
        local: 'Fazenda Boa Vista',
        lat: -18.17,
        lng: -47.94,
      },
      destino: {
        cidade: 'Belo Horizonte, MG',
        local: 'Depósito Central',
        lat: -19.92,
        lng: -43.94,
      },
    });

    const links = Array.from(container.querySelectorAll('a'));
    // O texto do local deve ser o conteúdo de uma âncora com href de mapa.
    const carregamento = links.find((a) => a.textContent === 'Fazenda Boa Vista');
    const descarga = links.find((a) => a.textContent === 'Depósito Central');

    expect(carregamento).toBeDefined();
    expect(descarga).toBeDefined();
    expect(carregamento!.getAttribute('href')).toMatch(/google\.com\/maps|maps\.google/i);
    expect(descarga!.getAttribute('href')).toMatch(/google\.com\/maps|maps\.google/i);
  });

  it('sem coordenadas, o local aparece como texto e NÃO vira link', () => {
    render({
      origem: { cidade: 'Catalão, GO', local: 'Fazenda Sem Pino' },
      destino: { cidade: 'Belo Horizonte, MG' },
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Fazenda Sem Pino');

    const links = Array.from(container.querySelectorAll('a'));
    const comoLink = links.find((a) => a.textContent === 'Fazenda Sem Pino');
    expect(comoLink).toBeUndefined();
  });

  it('modo dark: cidades usam texto claro (legível sobre o mapa)', () => {
    render({
      dark: true,
      origem: { cidade: 'Catalão, GO' },
      destino: { cidade: 'Belo Horizonte, MG' },
    });
    const paras = Array.from(container.querySelectorAll('p'));
    const cidade = paras.find((p) => p.textContent === 'Catalão, GO');
    expect(cidade).toBeDefined();
    expect(cidade!.className).toContain('text-white');
  });
});
