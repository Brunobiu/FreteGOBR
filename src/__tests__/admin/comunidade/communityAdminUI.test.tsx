/**
 * Testes de UI Admin — Frete Comunidade (spec frete-comunidade, Fase 5 / task 17.1).
 *
 * Convenção do projeto: sem @testing-library. Render manual com
 * react-dom/client + React.act + MemoryRouter. `vi.mock` é hoisted; retornos
 * mutáveis expostos via globalThis.
 *
 * Cobre: gating → Stealth404 sem FINANCEIRO_VIEW; e o botão "Publicar" do
 * preview desabilitado enquanto não houver linha elegível (cidade resolvida).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import type { ImportRow } from '../../../utils/communitySheet';

// ── Mocks hoisted ───────────────────────────────────────────────────────────
vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__commPerms as Record<string, boolean>;
    return { allowed: !!perms?.[action], loading: false };
  },
}));

vi.mock('../../../services/admin/comunidade', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../services/admin/comunidade'
  );
  return {
    ...actual,
    getCommunityProfile: () =>
      Promise.resolve({
        photoPath: null,
        photoUrl: null,
        name: 'Comunidade FreteGO',
        secondaryName: 'sugestões',
        enabled: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    listCommunityFretes: () =>
      Promise.resolve({ rows: [], total: 0, limit: 10, offset: 0 }),
    publishCommunityFretes: () =>
      Promise.resolve({ published: 0, updated: 0, skipped: 0, errors: 0 }),
  };
});

function setPerms(perms: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__commPerms = perms;
}

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CommunityListPage — gating', () => {
  it('sem FINANCEIRO_VIEW renderiza o 404 furtivo', async () => {
    setPerms({ FINANCEIRO_VIEW: false, FINANCEIRO_EDIT: false });
    const { default: Page } = await import('../../../pages/admin/comunidade/CommunityListPage');
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(Page)));
    });
    await flush();
    expect(container.textContent ?? '').toContain('404');
  });

  it('com FINANCEIRO_VIEW NÃO mostra o 404 (renderiza os blocos)', async () => {
    setPerms({ FINANCEIRO_VIEW: true, FINANCEIRO_EDIT: true });
    const { default: Page } = await import('../../../pages/admin/comunidade/CommunityListPage');
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(Page)));
    });
    await flush();
    const text = container.textContent ?? '';
    expect(text).not.toContain('404');
    expect(text).toContain('Importação por planilha');
  });
});

describe('CommunityPreviewTable — botão Publicar', () => {
  const baseRow: ImportRow = {
    rowNumber: 1,
    carrierName: 'Transp A',
    origin: 'GYN',
    destination: 'UDI',
    originDetail: 'Fazenda',
    destinationDetail: 'Armazém',
    value: 8500,
    product: 'Soja',
    phoneRaw: '(62) 99999-8888',
    phoneNormalized: '62999998888',
  };

  it('fica desabilitado enquanto nenhuma linha tem cidade resolvida', async () => {
    const { default: PreviewTable } = await import(
      '../../../components/admin/comunidade/CommunityPreviewTable'
    );
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(PreviewTable, { initialRows: [baseRow], onPublished: () => {} })
      );
    });
    await flush();
    const publishBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /Publicar/.test(b.textContent ?? '')
    );
    expect(publishBtn).toBeDefined();
    expect((publishBtn as HTMLButtonElement).disabled).toBe(true);
    // Resumo deve indicar 0 elegíveis e 1 cidade pendente.
    expect(container.textContent ?? '').toContain('Elegíveis: 0');
  });
});
