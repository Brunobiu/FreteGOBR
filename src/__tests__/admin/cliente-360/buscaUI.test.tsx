/**
 * Testes de UI da Pesquisa Global (Task 8.7). Render manual
 * (react-dom/client + React.act + MemoryRouter) — o projeto NAO usa
 * @testing-library/react. Mocks via vi.mock hoisted + spies no globalThis.
 *
 * Valida: gating por USER_VIEW (Topbar some / SearchPage => Stealth404),
 * debounce 300ms + dropdown <= 8 + "Ver todos", teclado (ArrowDown+Enter
 * navega ao cliente; Enter sem selecao vai a /admin/busca?q=; Esc fecha),
 * SearchPage reexecuta com ?q= e estado vazio.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__buscaPerms as
      | Record<string, boolean>
      | undefined;
    return { allowed: perms ? Boolean(perms[action]) : false, roles: [] };
  },
}));

vi.mock('../../../services/admin/cliente360', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/cliente360')>();
  const globalSearchSpy = vi.fn();
  (globalThis as Record<string, unknown>).__globalSearchSpy = globalSearchSpy;
  return { ...actual, globalSearch: (...a: unknown[]) => globalSearchSpy(...a) };
});

import TopbarSearch from '../../../components/admin/busca/TopbarSearch';
import SearchPage from '../../../pages/admin/busca/SearchPage';
import type { SearchResult } from '../../../services/admin/cliente360';

function spy(name: string): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)[name] as ReturnType<typeof vi.fn>;
}
function setPerms(p: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__buscaPerms = p;
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function LocationProbe() {
  const loc = useLocation();
  return createElement('div', { 'data-testid': 'loc' }, loc.pathname + loc.search);
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function pressKey(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const RESULT: SearchResult = {
  id: '11111111-1111-4111-8111-111111111111',
  user_type: 'motorista',
  name: 'João da Silva',
  email: 'joao@x.com',
  phone: '62999998888',
  company_name: null,
  matched_field: 'name',
  match_rank: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('TopbarSearch — gating e busca', () => {
  it('nao renderiza nada sem USER_VIEW', () => {
    setPerms({ USER_VIEW: false });
    act(() => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(TopbarSearch)));
    });
    expect(container.querySelector('input')).toBeNull();
  });

  it('debounce 300ms, dropdown <= 8 + "Ver todos os resultados"', async () => {
    vi.useFakeTimers();
    setPerms({ USER_VIEW: true });
    spy('__globalSearchSpy').mockResolvedValue([RESULT]);

    act(() => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(TopbarSearch)));
    });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();

    typeInto(input, 'joao');
    expect(spy('__globalSearchSpy')).not.toHaveBeenCalled(); // ainda no debounce
    act(() => vi.advanceTimersByTime(300));
    await flush();

    expect(spy('__globalSearchSpy')).toHaveBeenCalledWith('joao', { limit: 8 });
    const text = container.textContent ?? '';
    expect(text).toContain('João da Silva');
    expect(text).toContain('Ver todos os resultados');
  });

  it('Enter sem selecao navega para /admin/busca?q=', async () => {
    vi.useFakeTimers();
    setPerms({ USER_VIEW: true });
    spy('__globalSearchSpy').mockResolvedValue([RESULT]);
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(MemoryRouter, null, createElement(TopbarSearch), createElement(LocationProbe))
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    typeInto(input, 'joao');
    act(() => vi.advanceTimersByTime(300));
    await flush();
    pressKey(input, 'Enter');
    await flush();
    const loc = container.querySelector('[data-testid="loc"]')?.textContent ?? '';
    expect(loc).toContain('/admin/busca?q=joao');
  });

  it('ArrowDown + Enter navega para a Visao 360 do resultado', async () => {
    vi.useFakeTimers();
    setPerms({ USER_VIEW: true });
    spy('__globalSearchSpy').mockResolvedValue([RESULT]);
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(MemoryRouter, null, createElement(TopbarSearch), createElement(LocationProbe))
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    typeInto(input, 'joao');
    act(() => vi.advanceTimersByTime(300));
    await flush();
    pressKey(input, 'ArrowDown');
    pressKey(input, 'Enter');
    await flush();
    const loc = container.querySelector('[data-testid="loc"]')?.textContent ?? '';
    expect(loc).toContain(`/admin/users/${RESULT.id}`);
  });
});

describe('SearchPage — gating, ?q= e estado vazio', () => {
  it('Stealth404 sem USER_VIEW', () => {
    setPerms({ USER_VIEW: false });
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/admin/busca?q=ana'] }, createElement(SearchPage))
      );
    });
    expect(container.textContent ?? '').toContain('404');
    expect(spy('__globalSearchSpy')).not.toHaveBeenCalled();
  });

  it('reexecuta a busca com ?q= no load e renderiza resultados', async () => {
    setPerms({ USER_VIEW: true });
    spy('__globalSearchSpy').mockResolvedValue([RESULT]);
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/admin/busca?q=ana'] }, createElement(SearchPage))
      );
    });
    await flush();
    expect(spy('__globalSearchSpy')).toHaveBeenCalledWith('ana', { limit: 50 });
    expect(container.textContent ?? '').toContain('João da Silva');
  });

  it('estado vazio: "Nenhum cliente encontrado."', async () => {
    setPerms({ USER_VIEW: true });
    spy('__globalSearchSpy').mockResolvedValue([]);
    act(() => {
      root = createRoot(container);
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/admin/busca?q=zzz'] }, createElement(SearchPage))
      );
    });
    await flush();
    expect(container.textContent ?? '').toContain('Nenhum cliente encontrado.');
  });
});
