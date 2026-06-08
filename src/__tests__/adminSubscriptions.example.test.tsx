/**
 * Testes do módulo admin Assinaturas (Tarefa 17.1).
 *
 * Feature: assinaturas-pagamento (Fase 6).
 * Valida (Req 13.x):
 *   - Filtros: parse/serialize round-trip e saneamento de valores fora do domínio.
 *   - Mapeamento de erro: 42501/permission_denied => PERMISSION_DENIED (pt-BR).
 *   - Gating de UI: sem FINANCEIRO_VIEW a página renderiza o Stealth_404
 *     (NotFoundPage) — não revela que a rota existe.
 *
 * Convenção do projeto: sem @testing-library. Render manual com
 * `react-dom/client` + `React.act` + `MemoryRouter`. `vi.mock` hoisted com
 * retornos expostos via globalThis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import {
  parseSubscriptionFiltersFromQuery,
  serializeSubscriptionFiltersToQuery,
  DEFAULT_SUBSCRIPTION_FILTERS,
  SubscriptionAdminError,
  type SubscriptionFilters,
} from '../services/admin/subscriptions';

// ── Mock do hook de permissão (hoisted) ─────────────────────────────────────
vi.mock('../hooks/useAdminPermission', () => ({
  useAdminPermission: () => (globalThis as Record<string, unknown>).__adminPermReturn,
}));

// Evita dependência do supabase real na importação da página/serviço.
vi.mock('../services/supabase', () => ({
  supabase: { rpc: () => Promise.resolve({ data: { rows: [], total: 0 }, error: null }) },
}));

function setPerm(allowed: boolean) {
  (globalThis as Record<string, unknown>).__adminPermReturn = { allowed, loading: false };
}

// ============================================================================
// Filtros puros — parse/serialize
// ============================================================================
describe('admin assinaturas — filtros', () => {
  it('default quando query vazio', () => {
    const f = parseSubscriptionFiltersFromQuery('');
    expect(f).toEqual(DEFAULT_SUBSCRIPTION_FILTERS);
  });

  it('saneia grupo/sort/pageSize fora do domínio', () => {
    const f = parseSubscriptionFiltersFromQuery('group=hacker&sort=xyz&pageSize=999&page=-3');
    expect(f.group).toBe('todos');
    expect(f.sort).toBe('next_charge_asc');
    expect(f.pageSize).toBe(10);
    expect(f.page).toBe(1);
  });

  it('round-trip serialize→parse preserva os campos não-default', () => {
    const original: SubscriptionFilters = {
      group: 'inadimplentes',
      q: 'joao',
      sort: 'started_desc',
      page: 3,
      pageSize: 50,
    };
    const qs = serializeSubscriptionFiltersToQuery(original);
    const parsed = parseSubscriptionFiltersFromQuery(qs);
    expect(parsed).toEqual(original);
  });

  it('omite defaults na URL (URL limpa)', () => {
    const qs = serializeSubscriptionFiltersToQuery(DEFAULT_SUBSCRIPTION_FILTERS);
    expect(qs.toString()).toBe('');
  });
});

// ============================================================================
// Erro tipado
// ============================================================================
describe('SubscriptionAdminError', () => {
  it('PERMISSION_DENIED tem mensagem pt-BR', () => {
    const e = new SubscriptionAdminError('PERMISSION_DENIED');
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.message).toMatch(/permissão/i);
  });
});

// ============================================================================
// Gating de UI — Stealth_404 sem permissão
// ============================================================================
describe('SubscriptionsListPage — gating', () => {
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

  async function renderPage() {
    // Import dinâmico após os mocks estarem ativos.
    const { default: SubscriptionsListPage } =
      await import('../pages/admin/subscriptions/SubscriptionsListPage');
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(SubscriptionsListPage)));
    });
  }

  it('sem FINANCEIRO_VIEW renderiza o 404 furtivo (não revela a rota)', async () => {
    setPerm(false);
    await renderPage();
    // NotFoundPage exibe "404" em algum lugar do conteúdo.
    expect(container.textContent ?? '').toContain('404');
  });

  it('com FINANCEIRO_VIEW NÃO mostra o 404 (renderiza a listagem)', async () => {
    setPerm(true);
    await renderPage();
    expect(container.textContent ?? '').not.toContain('404');
  });
});
