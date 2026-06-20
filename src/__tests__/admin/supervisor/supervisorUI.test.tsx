/**
 * Testes de UI da IA Supervisora (Task 8). Render manual (react-dom/client +
 * React.act + MemoryRouter) — o projeto NÃO usa @testing-library/react. Mocks
 * via vi.mock hoisted + spies no globalThis.
 *
 * Valida: gating (Stealth_404 sem SUPERVISOR_VIEW nas 4 páginas); chat read-only
 * (askSupervisor wiring + estado "IA indisponível"); diagnóstico somente-leitura
 * + estado vazio; visibilidade de Reconhecer/Descartar por permissão; filtro de
 * diagnóstico inválido bloqueia "Aplicar" + mensagem pt-BR; paginação default 10;
 * ausência de <h1>; item "Supervisor IA" na sidebar (gated SUPERVISOR_VIEW).
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
    const perms = (globalThis as Record<string, unknown>).__supPerms as
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

vi.mock('../../../services/admin/supervisor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/supervisor')>();
  const g = globalThis as Record<string, unknown>;
  const listDiagSpy = vi.fn();
  const listInsightsSpy = vi.fn();
  const askSpy = vi.fn();
  const ackSpy = vi.fn();
  const dismissSpy = vi.fn();
  const evalSpy = vi.fn();
  const genSpy = vi.fn();
  const createSessionSpy = vi.fn();
  const listSessionsSpy = vi.fn();
  const listMessagesSpy = vi.fn();
  const appendMsgSpy = vi.fn();
  const renameSpy = vi.fn();
  const deleteSpy = vi.fn();
  g.__listDiagSpy = listDiagSpy;
  g.__listInsightsSpy = listInsightsSpy;
  g.__askSpy = askSpy;
  g.__ackSpy = ackSpy;
  g.__dismissSpy = dismissSpy;
  g.__evalSpy = evalSpy;
  g.__genSpy = genSpy;
  g.__createSessionSpy = createSessionSpy;
  g.__listSessionsSpy = listSessionsSpy;
  g.__listMessagesSpy = listMessagesSpy;
  g.__appendMsgSpy = appendMsgSpy;
  g.__renameSpy = renameSpy;
  g.__deleteSpy = deleteSpy;
  return {
    ...actual,
    listDiagnostics: (...a: unknown[]) => listDiagSpy(...a),
    listInsights: (...a: unknown[]) => listInsightsSpy(...a),
    askSupervisor: (...a: unknown[]) => askSpy(...a),
    acknowledgeInsight: (...a: unknown[]) => ackSpy(...a),
    dismissInsight: (...a: unknown[]) => dismissSpy(...a),
    triggerEvaluate: (...a: unknown[]) => evalSpy(...a),
    generateSummary: (...a: unknown[]) => genSpy(...a),
    createChatSession: (...a: unknown[]) => createSessionSpy(...a),
    listChatSessions: (...a: unknown[]) => listSessionsSpy(...a),
    listChatMessages: (...a: unknown[]) => listMessagesSpy(...a),
    appendChatMessage: (...a: unknown[]) => appendMsgSpy(...a),
    renameChatSession: (...a: unknown[]) => renameSpy(...a),
    deleteChatSession: (...a: unknown[]) => deleteSpy(...a),
  };
});

import InsightActionsCell from '../../../components/admin/supervisor/InsightActionsCell';
import DiagnosticsFiltersPopover from '../../../components/admin/supervisor/DiagnosticsFiltersPopover';
import AdminSidebar from '../../../components/admin/AdminSidebar';
import SupervisorChatPage from '../../../pages/admin/supervisor/SupervisorChatPage';
import SupervisorDiagnosticsPage from '../../../pages/admin/supervisor/SupervisorDiagnosticsPage';
import SupervisorInsightsPage from '../../../pages/admin/supervisor/SupervisorInsightsPage';
import SupervisorSummaryPage from '../../../pages/admin/supervisor/SupervisorSummaryPage';
import type { SupervisorInsight, DiagnosticFilters } from '../../../services/admin/supervisor';

function spy(name: string): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)[name] as ReturnType<typeof vi.fn>;
}
function setPerms(p: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__supPerms = p;
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

function makeInsight(over: Partial<SupervisorInsight> = {}): SupervisorInsight {
  return {
    id: 'i1',
    insight_type: 'ANOMALY',
    severity: 'CRITICAL',
    state: 'OPEN',
    title: 'Erros recorrentes em whatsapp (7x)',
    detail: {},
    dedup_key: 'ANOMALY:diagnostic:whatsapp:send:TIMEOUT',
    source: 'anomaly_detector',
    first_seen_at: '2026-06-19T11:00:00Z',
    last_seen_at: '2026-06-19T12:00:00Z',
    acknowledged_at: null,
    acknowledged_by: null,
    dismissed_at: null,
    dismissed_by: null,
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

// ─── InsightActionsCell: gating de UI ────────────────────────────────────────

describe('InsightActionsCell — gating de UI', () => {
  it('SUPERVISOR_MANAGE + OPEN ⇒ Reconhecer + Descartar', () => {
    setPerms({ SUPERVISOR_MANAGE: true });
    render(createElement(InsightActionsCell, { insight: makeInsight(), busy: false, onAck: noop, onDismiss: noop }));
    const text = container.textContent ?? '';
    expect(text).toContain('Reconhecer');
    expect(text).toContain('Descartar');
  });
  it('sem SUPERVISOR_MANAGE ⇒ nenhum botão', () => {
    setPerms({ SUPERVISOR_MANAGE: false });
    render(createElement(InsightActionsCell, { insight: makeInsight(), busy: false, onAck: noop, onDismiss: noop }));
    const text = container.textContent ?? '';
    expect(text).not.toContain('Reconhecer');
    expect(text).not.toContain('Descartar');
  });
  it('estado DISMISSED ⇒ nenhum botão (terminal)', () => {
    setPerms({ SUPERVISOR_MANAGE: true });
    render(
      createElement(InsightActionsCell, {
        insight: makeInsight({ state: 'DISMISSED' }),
        busy: false,
        onAck: noop,
        onDismiss: noop,
      })
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('Reconhecer');
    expect(text).not.toContain('Descartar');
  });
});

// ─── DiagnosticsFiltersPopover: validação bloqueia + mensagem pt-BR ──────────

describe('DiagnosticsFiltersPopover — datas inválidas bloqueiam Aplicar', () => {
  it('from > to ⇒ Aplicar desabilitado + mensagem pt-BR; onApply não chamado', () => {
    const onApply = vi.fn();
    render(createElement(DiagnosticsFiltersPopover, { filters: {} as DiagnosticFilters, onApply }));
    clickByAria('Abrir filtros');
    const dates = container.querySelectorAll('input[type="date"]');
    typeInto(dates[0] as HTMLInputElement, '2026-06-20'); // De
    typeInto(dates[1] as HTMLInputElement, '2026-06-10'); // Até
    expect(container.textContent ?? '').toContain('A data inicial deve ser menor ou igual à final.');
    const aplicar = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Aplicar'
    ) as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    clickButton('Aplicar');
    expect(onApply).not.toHaveBeenCalled();
  });
});

// ─── Páginas: gating Stealth_404 ─────────────────────────────────────────────

describe('Páginas — Stealth_404 sem SUPERVISOR_VIEW', () => {
  it('Chat sem permissão ⇒ 404', async () => {
    setPerms({ SUPERVISOR_VIEW: false });
    render(createElement(SupervisorChatPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
  });
  it('Diagnóstico sem permissão ⇒ 404 e não lista', async () => {
    setPerms({ SUPERVISOR_VIEW: false });
    render(createElement(SupervisorDiagnosticsPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
    expect(spy('__listDiagSpy')).not.toHaveBeenCalled();
  });
  it('Insights sem permissão ⇒ 404 e não lista', async () => {
    setPerms({ SUPERVISOR_VIEW: false });
    render(createElement(SupervisorInsightsPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
    expect(spy('__listInsightsSpy')).not.toHaveBeenCalled();
  });
  it('Resumo sem permissão ⇒ 404', async () => {
    setPerms({ SUPERVISOR_VIEW: false });
    render(createElement(SupervisorSummaryPage));
    await flush();
    expect(container.textContent ?? '').toContain('404');
  });
});

// ─── Chat: wiring + degradação + sem <h1> ────────────────────────────────────

describe('SupervisorChatPage — chat read-only', () => {
  it('pergunta chama askSupervisor e mostra a resposta; sem <h1>', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__askSpy').mockResolvedValue({ answer: 'Hoje entraram 37 usuários.', degraded: false });
    render(createElement(SupervisorChatPage));
    await flush();
    expect(container.querySelector('h1')).toBeNull();
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    typeInto(input, 'quantos usuários hoje?');
    clickButton('Perguntar');
    await flush();
    expect(spy('__askSpy')).toHaveBeenCalledWith('quantos usuários hoje?');
    expect(container.textContent ?? '').toContain('37');
  });

  it('resposta degradada mostra "IA indisponível"', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__askSpy').mockResolvedValue({ answer: 'IA indisponível no momento.', degraded: true });
    render(createElement(SupervisorChatPage));
    await flush();
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    typeInto(input, 'e aí?');
    clickButton('Perguntar');
    await flush();
    expect(container.textContent ?? '').toContain('IA indisponível');
  });
});

// ─── Chat: histórico de conversas (119) ─────────────────────────────────────

describe('SupervisorChatPage — histórico de conversas', () => {
  it('lista as conversas na lateral + botão "Nova conversa"', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__listSessionsSpy').mockResolvedValue([
      { id: 's1', admin_id: 'a', title: 'Erros de pagamento', created_at: 't', updated_at: 't' },
      { id: 's2', admin_id: 'a', title: 'Status do WhatsApp', created_at: 't', updated_at: 't' },
    ]);
    render(createElement(SupervisorChatPage));
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Erros de pagamento');
    expect(text).toContain('Status do WhatsApp');
    expect(text).toContain('Nova conversa');
  });

  it('selecionar conversa carrega as mensagens (listChatMessages)', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__listSessionsSpy').mockResolvedValue([
      { id: 's1', admin_id: 'a', title: 'Conversa 1', created_at: 't', updated_at: 't' },
    ]);
    spy('__listMessagesSpy').mockResolvedValue([
      { id: 'm1', session_id: 's1', role: 'user', content: 'pergunta antiga', created_at: 't' },
      { id: 'm2', session_id: 's1', role: 'ai', content: 'resposta antiga', created_at: 't' },
    ]);
    render(createElement(SupervisorChatPage));
    await flush();
    clickButton('Conversa 1');
    await flush();
    expect(spy('__listMessagesSpy')).toHaveBeenCalledWith('s1');
    const text = container.textContent ?? '';
    expect(text).toContain('pergunta antiga');
    expect(text).toContain('resposta antiga');
  });

  it('perguntar sem sessão ativa cria a sessão e persiste user + ai', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__listSessionsSpy').mockResolvedValue([]);
    spy('__createSessionSpy').mockResolvedValue({ id: 'new1', title: 'quantos…' });
    spy('__appendMsgSpy').mockResolvedValue({ id: 'mx' });
    spy('__askSpy').mockResolvedValue({ answer: 'Resposta da IA.', degraded: false });
    render(createElement(SupervisorChatPage));
    await flush();
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    typeInto(input, 'quantos usuários hoje?');
    clickButton('Perguntar');
    await flush();
    expect(spy('__createSessionSpy')).toHaveBeenCalledWith('quantos usuários hoje?');
    expect(spy('__appendMsgSpy')).toHaveBeenCalledWith('new1', 'user', 'quantos usuários hoje?');
    expect(spy('__appendMsgSpy')).toHaveBeenCalledWith('new1', 'ai', 'Resposta da IA.');
  });
});

// ─── Diagnóstico: somente-leitura + estado vazio ─────────────────────────────

describe('SupervisorDiagnosticsPage — somente-leitura', () => {
  it('estado vazio + sem controles de mutação', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__listDiagSpy').mockResolvedValue({ items: [], total: 0 });
    render(createElement(SupervisorDiagnosticsPage));
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Nenhum diagnóstico encontrado.');
    expect(text).not.toContain('Reconhecer');
    expect(text).not.toContain('Descartar');
  });
});

// ─── Insights: ack wiring + paginação default 10 ─────────────────────────────

describe('SupervisorInsightsPage — ack wiring e paginação default 10', () => {
  it('lista um insight; Reconhecer chama acknowledgeInsight(id, updated_at)', async () => {
    setPerms({ SUPERVISOR_VIEW: true, SUPERVISOR_MANAGE: true });
    spy('__listInsightsSpy').mockResolvedValue({ items: [makeInsight()], total: 1 });
    spy('__ackSpy').mockResolvedValue({ ok: true, updated_at: '2026-06-19T13:00:00Z' });
    render(createElement(SupervisorInsightsPage));
    await flush();
    expect(container.textContent ?? '').toContain('Erros recorrentes em whatsapp');
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('10');
    clickButton('Reconhecer');
    await flush();
    expect(spy('__ackSpy')).toHaveBeenCalledWith('i1', '2026-06-19T12:00:00Z');
  });
});

// ─── Resumo: estado vazio + Gerar agora ──────────────────────────────────────

describe('SupervisorSummaryPage', () => {
  it('estado vazio + "Gerar agora" chama generateSummary', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    spy('__listInsightsSpy').mockResolvedValue({ items: [], total: 0 });
    spy('__genSpy').mockResolvedValue({ id: 's1', skipped: false });
    render(createElement(SupervisorSummaryPage));
    await flush();
    expect(container.textContent ?? '').toContain('Nenhum resumo gerado ainda');
    clickButton('Gerar agora');
    await flush();
    expect(spy('__genSpy')).toHaveBeenCalled();
  });
});

// ─── Sidebar: item "Supervisor IA" gated ─────────────────────────────────────

describe('AdminSidebar — item "Supervisor IA"', () => {
  it('com SUPERVISOR_VIEW exibe o item', async () => {
    setPerms({ SUPERVISOR_VIEW: true });
    render(createElement(AdminSidebar, { open: true, onClose: noop }));
    await flush();
    expect(container.querySelector('a[href="/admin/supervisor"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('Supervisor IA');
  });
  it('sem SUPERVISOR_VIEW oculta o item', async () => {
    setPerms({ SUPERVISOR_VIEW: false });
    render(createElement(AdminSidebar, { open: true, onClose: noop }));
    await flush();
    expect(container.querySelector('a[href="/admin/supervisor"]')).toBeNull();
  });
});
