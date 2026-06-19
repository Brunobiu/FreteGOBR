/**
 * Testes de UI da Central de Operação (Task 6.7). Render manual
 * (react-dom/client + React.act + MemoryRouter) — o projeto NÃO usa
 * @testing-library/react. Mocks via vi.mock hoisted + spies no globalThis.
 *
 * Valida: gating (Stealth_404 sem DASHBOARD_VIEW/ALERT_VIEW/LOG_VIEW); KPI
 * `indisponível` ≠ 0; degradação parcial por grupo; visibilidade de
 * Reconhecer/Resolver por permissão; logs somente-leitura + estado vazio;
 * filtro inválido bloqueia "Aplicar" + mensagem pt-BR; paginação default 10;
 * ausência de <h1>; item "Operacao" na sidebar (gated DASHBOARD_VIEW).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/supabase', () => ({
  supabase: {
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
  },
}));

vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__opPerms as
      | Record<string, boolean>
      | undefined;
    return { allowed: perms ? Boolean(perms[action]) : false, roles: [] };
  },
}));

vi.mock('../../../components/admin/AdminProvider', () => ({
  useAdminContext: () => ({
    session: { displayName: 'Admin', photoUrl: null },
    logout: () => {},
    roles: [],
  }),
  AdminProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('../../../services/admin/users', () => ({
  countUsersWithPendingDocuments: () => Promise.resolve(0),
}));

vi.mock('../../../services/admin/operacao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/operacao')>();
  const g = globalThis as Record<string, unknown>;
  const getMetricsSpy = vi.fn();
  const listAlertsSpy = vi.fn();
  const listLogsSpy = vi.fn();
  const triggerEvalSpy = vi.fn();
  const ackSpy = vi.fn();
  const resolveSpy = vi.fn();
  g.__getMetricsSpy = getMetricsSpy;
  g.__listAlertsSpy = listAlertsSpy;
  g.__listLogsSpy = listLogsSpy;
  g.__triggerEvalSpy = triggerEvalSpy;
  g.__ackSpy = ackSpy;
  g.__resolveSpy = resolveSpy;
  return {
    ...actual,
    getOperationsMetrics: (...a: unknown[]) => getMetricsSpy(...a),
    listAlerts: (...a: unknown[]) => listAlertsSpy(...a),
    listLogs: (...a: unknown[]) => listLogsSpy(...a),
    triggerEvaluate: (...a: unknown[]) => triggerEvalSpy(...a),
    acknowledgeAlert: (...a: unknown[]) => ackSpy(...a),
    resolveAlert: (...a: unknown[]) => resolveSpy(...a),
  };
});

import OperacaoKpiCard from '../../../components/admin/operacao/OperacaoKpiCard';
import OperacaoKpiGrid from '../../../components/admin/operacao/OperacaoKpiGrid';
import AlertActionsCell from '../../../components/admin/operacao/AlertActionsCell';
import LogsFiltersPopover from '../../../components/admin/operacao/LogsFiltersPopover';
import AdminSidebar from '../../../components/admin/AdminSidebar';
import OperacaoDashboardPage from '../../../pages/admin/operacao/OperacaoDashboardPage';
import OperacaoAlertasPage from '../../../pages/admin/operacao/OperacaoAlertasPage';
import OperacaoLogsPage from '../../../pages/admin/operacao/OperacaoLogsPage';
import { adaptOperationsBundle } from '../../../services/admin/operacao/metricsShape';
import type { SystemAlert, LogFilters } from '../../../services/admin/operacao';

function spy(name: string): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)[name] as ReturnType<typeof vi.fn>;
}
function setPerms(p: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__opPerms = p;
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
function render(node: unknown) {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, node as never));
  });
}
function clickButton(label: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}
function clickByAria(label: string) {
  const btn = container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`button[aria-label=${label}] not found`);
  act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const noop = () => {};

function makeAlert(over: Partial<SystemAlert> = {}): SystemAlert {
  return {
    id: 'a1',
    alert_type: 'WHATSAPP_DISCONNECTED',
    severity: 'CRITICAL',
    state: 'OPEN',
    source_type: 'whatsapp_session',
    source_id: 'inst-1',
    dedup_key: 'WHATSAPP_DISCONNECTED:whatsapp_session:inst-1',
    title: 'WhatsApp desconectado',
    detail: {},
    first_seen_at: '2026-06-19T11:00:00Z',
    last_seen_at: '2026-06-19T12:00:00Z',
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_at: null,
    resolved_by: null,
    created_at: '2026-06-19T11:00:00Z',
    updated_at: '2026-06-19T12:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

// ─── OperacaoKpiCard: indisponível ≠ 0 ───────────────────────────────────────

describe('OperacaoKpiCard — indisponível nunca é 0', () => {
  it('available=false ⇒ "indisponível" (sem 0)', () => {
    render(createElement(OperacaoKpiCard, { label: 'Usuários online', kpi: { value: null, available: false } }));
    const text = container.textContent ?? '';
    expect(text).toContain('indisponível');
    expect(text).not.toContain('0');
  });

  it('available=true com value 0 ⇒ "0" (distinto de indisponível)', () => {
    render(createElement(OperacaoKpiCard, { label: 'Cadastros hoje', kpi: { value: 0, available: true } }));
    const text = container.textContent ?? '';
    expect(text).toContain('0');
    expect(text).not.toContain('indisponível');
  });
});

// ─── OperacaoKpiGrid: degradação parcial por grupo ───────────────────────────

describe('OperacaoKpiGrid — degradação parcial isolada por grupo', () => {
  it('grupo em errors mostra bloco de erro; demais grupos seguem', () => {
    const bundle = adaptOperationsBundle({
      meta: { generatedAt: '2026-06-19T12:00:00Z', onlineWindowSec: 300 },
      kpis: { USERS_TOTAL: { value: 7, available: true } },
      errors: { messages: 'Bloco indisponível.' },
    });
    render(createElement(OperacaoKpiGrid, { bundle, loading: false, onRetry: noop }));
    const text = container.textContent ?? '';
    expect(text).toContain('Usuários totais'); // grupo users OK
    expect(text).toContain('Bloco indisponível.'); // grupo messages degradado
    expect(text).toContain('Tentar novamente');
    expect(text).not.toContain('Enviadas hoje'); // KPI do grupo degradado não renderiza
  });
});

// ─── AlertActionsCell: visibilidade por permissão + estado ───────────────────

describe('AlertActionsCell — gating de UI dos botões', () => {
  it('ALERT_ACK + ALERT_RESOLVE e estado OPEN ⇒ ambos os botões', () => {
    setPerms({ ALERT_ACK: true, ALERT_RESOLVE: true });
    render(
      createElement(AlertActionsCell, { alert: makeAlert(), busy: false, onAck: noop, onResolve: noop })
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Reconhecer');
    expect(text).toContain('Resolver');
  });

  it('sem ALERT_ACK ⇒ esconde Reconhecer (mantém Resolver)', () => {
    setPerms({ ALERT_ACK: false, ALERT_RESOLVE: true });
    render(
      createElement(AlertActionsCell, { alert: makeAlert(), busy: false, onAck: noop, onResolve: noop })
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('Reconhecer');
    expect(text).toContain('Resolver');
  });

  it('estado RESOLVED ⇒ nenhum botão (terminal)', () => {
    setPerms({ ALERT_ACK: true, ALERT_RESOLVE: true });
    render(
      createElement(AlertActionsCell, {
        alert: makeAlert({ state: 'RESOLVED' }),
        busy: false,
        onAck: noop,
        onResolve: noop,
      })
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('Reconhecer');
    expect(text).not.toContain('Resolver');
  });
});

// ─── LogsFiltersPopover: validação bloqueia + mensagem pt-BR ──────────────────

describe('LogsFiltersPopover — filtro inválido bloqueia Aplicar + mensagem pt-BR', () => {
  it('ator não-UUID ⇒ Aplicar desabilitado, mensagem exibida, onApply não chamado', () => {
    const onApply = vi.fn();
    render(createElement(LogsFiltersPopover, { filters: {} as LogFilters, onApply }));
    clickByAria('Abrir filtros');
    const actor = container.querySelector(
      'input[placeholder="00000000-0000-0000-0000-000000000000"]'
    ) as HTMLInputElement;
    typeInto(actor, 'nao-e-uuid');
    expect(container.textContent ?? '').toContain('O ator deve ser um UUID válido.');
    const aplicar = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Aplicar'
    ) as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    clickButton('Aplicar');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('ator UUID válido ⇒ Aplicar habilitado e chama onApply', () => {
    const onApply = vi.fn();
    render(createElement(LogsFiltersPopover, { filters: {} as LogFilters, onApply }));
    clickByAria('Abrir filtros');
    const actor = container.querySelector(
      'input[placeholder="00000000-0000-0000-0000-000000000000"]'
    ) as HTMLInputElement;
    typeInto(actor, '11111111-1111-4111-8111-111111111111');
    clickButton('Aplicar');
    expect(onApply).toHaveBeenCalledWith({ actor: '11111111-1111-4111-8111-111111111111' });
  });
});

// ─── Páginas: gating Stealth_404 ─────────────────────────────────────────────

describe('Páginas — Stealth_404 sem permissão', () => {
  it('OperacaoDashboardPage sem DASHBOARD_VIEW ⇒ 404 e não busca métricas', async () => {
    setPerms({ DASHBOARD_VIEW: false });
    render(createElement(OperacaoDashboardPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
    expect(spy('__getMetricsSpy')).not.toHaveBeenCalled();
  });

  it('OperacaoAlertasPage sem ALERT_VIEW ⇒ 404 e não lista alertas', async () => {
    setPerms({ ALERT_VIEW: false });
    render(createElement(OperacaoAlertasPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
    expect(spy('__listAlertsSpy')).not.toHaveBeenCalled();
  });

  it('OperacaoLogsPage sem LOG_VIEW ⇒ 404 e não lista logs', async () => {
    setPerms({ LOG_VIEW: false });
    render(createElement(OperacaoLogsPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
    expect(spy('__listLogsSpy')).not.toHaveBeenCalled();
  });
});

// ─── OperacaoDashboardPage: render + sem <h1> ────────────────────────────────

describe('OperacaoDashboardPage — render com permissão', () => {
  it('renderiza os KPIs, sem <h1> grande (padrão compacto)', async () => {
    setPerms({ DASHBOARD_VIEW: true });
    spy('__getMetricsSpy').mockResolvedValue(
      adaptOperationsBundle({
        meta: { generatedAt: '2026-06-19T12:00:00Z', onlineWindowSec: 300 },
        kpis: { USERS_TOTAL: { value: 5, available: true } },
        errors: {},
      })
    );
    render(createElement(OperacaoDashboardPage));
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Usuários totais');
    expect(text).toContain('5');
    expect(container.querySelector('h1')).toBeNull();
    expect(spy('__getMetricsSpy')).toHaveBeenCalled();
  });
});

// ─── OperacaoAlertasPage: ack wiring + paginação default 10 ──────────────────

describe('OperacaoAlertasPage — ack wiring e paginação default 10', () => {
  it('lista um alerta e o botão Reconhecer chama acknowledgeAlert(id, updated_at)', async () => {
    setPerms({ ALERT_VIEW: true, ALERT_ACK: true, ALERT_RESOLVE: true });
    spy('__listAlertsSpy').mockResolvedValue({ items: [makeAlert()], total: 1 });
    spy('__ackSpy').mockResolvedValue({ ok: true, updated_at: '2026-06-19T13:00:00Z' });
    render(createElement(OperacaoAlertasPage));
    await flush();
    expect(container.textContent ?? '').toContain('WhatsApp desconectado');
    // paginação default 10
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('10');
    // ack
    clickButton('Reconhecer');
    await flush();
    expect(spy('__ackSpy')).toHaveBeenCalledWith('a1', '2026-06-19T12:00:00Z');
  });
});

// ─── OperacaoLogsPage: somente-leitura + estado vazio ────────────────────────

describe('OperacaoLogsPage — somente-leitura e estado vazio', () => {
  it('estado vazio exibe "Nenhum registro encontrado." e não há controles de mutação', async () => {
    setPerms({ LOG_VIEW: true });
    spy('__listLogsSpy').mockResolvedValue({ items: [], total: 0 });
    render(createElement(OperacaoLogsPage));
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Nenhum registro encontrado.');
    expect(text).not.toContain('Reconhecer');
    expect(text).not.toContain('Resolver');
  });

  it('renderiza o resumo canônico do log', async () => {
    setPerms({ LOG_VIEW: true });
    spy('__listLogsSpy').mockResolvedValue({
      items: [
        {
          occurred_at: '2026-06-19T12:00:00Z',
          event_type: 'LOGIN',
          actor: 'admin-1',
          target_type: null,
          target_id: null,
          summary: 'Login realizado',
        },
      ],
      total: 1,
    });
    render(createElement(OperacaoLogsPage));
    await flush();
    expect(container.textContent ?? '').toContain('Login realizado');
  });
});

// ─── AdminSidebar: item "Operacao" gated DASHBOARD_VIEW ──────────────────────

describe('AdminSidebar — item "Operacao"', () => {
  it('com DASHBOARD_VIEW exibe o item e o link /admin/operacao', async () => {
    setPerms({ DASHBOARD_VIEW: true });
    render(createElement(AdminSidebar, { open: true, onClose: noop }));
    await flush();
    const link = container.querySelector('a[href="/admin/operacao"]');
    expect(link).not.toBeNull();
    expect(container.textContent ?? '').toContain('Operacao');
  });

  it('sem DASHBOARD_VIEW oculta o item', async () => {
    setPerms({ DASHBOARD_VIEW: false });
    render(createElement(AdminSidebar, { open: true, onClose: noop }));
    await flush();
    expect(container.querySelector('a[href="/admin/operacao"]')).toBeNull();
  });
});
