/**
 * Testes de UI da Central de Suporte Inteligente (Task 8.7).
 *
 * Render manual (react-dom/client + React.act + MemoryRouter) — o projeto NÃO
 * usa @testing-library/react. Mocks via vi.mock hoisted, spies no globalThis.
 *
 * Valida (Req 1.3, 1.6, 2.3, 9.6, 12.3):
 *   (a) Stealth404 quando SUPORTE_VIEW negado; listTickets não é chamado.
 *   (b) Lista compacta: SEM <h1>, paginação default 10, visitante "Sem plano",
 *       prioridade "Crítico" (Nível 3).
 *   (c) Detalhe: "Retornar para IA" oculto sem SUPORTE_REPLY; visível com ele.
 *   (d) FaqPanel: pergunta inválida bloqueia o envio E mostra erro pt-BR.
 *   (e) Badges puros (Crítico / Novo).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__suporteUIPerms as
      | Record<string, boolean>
      | undefined;
    return { allowed: perms ? Boolean(perms[action]) : false, roles: [] };
  },
}));

vi.mock('../../../services/admin/suporte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/suporte')>();
  const listTicketsSpy = vi.fn();
  const getTicketDetailSpy = vi.fn();
  const listFaqSpy = vi.fn();
  const createFaqSpy = vi.fn();
  const g = globalThis as Record<string, unknown>;
  g.__listTicketsSpy = listTicketsSpy;
  g.__getTicketDetailSpy = getTicketDetailSpy;
  g.__listFaqSpy = listFaqSpy;
  g.__createFaqSpy = createFaqSpy;
  return {
    ...actual,
    listTickets: (...a: unknown[]) => listTicketsSpy(...a),
    getTicketDetail: (...a: unknown[]) => getTicketDetailSpy(...a),
    listFaq: (...a: unknown[]) => listFaqSpy(...a),
    createFaq: (...a: unknown[]) => createFaqSpy(...a),
  };
});

import SuporteListPage from '../../../pages/admin/suporte/SuporteListPage';
import SuporteTicketDetailPage from '../../../pages/admin/suporte/SuporteTicketDetailPage';
import FaqPanel from '../../../components/admin/suporte/FaqPanel';
import { SuportePriorityBadge, SuporteStatusBadge } from '../../../components/admin/suporte/SuporteBadges';
import type { SupportConsoleTicket, SupportTicketDetail } from '../../../services/admin/suporte';

function spy(name: string): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)[name] as ReturnType<typeof vi.fn>;
}
function setPerms(p: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__suporteUIPerms = p;
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
function clickButton(label: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const guestTicket: SupportConsoleTicket = {
  id: 't-guest',
  subject: 'Visitante com problema',
  status: 'open',
  priorityLevel: 3,
  responderMode: 'ai',
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
  clientName: 'Visitante Zé',
  clientEmail: 'ze@visitante.com',
  clientWhatsapp: null,
  planoLabel: 'Sem plano',
  isGuest: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe('SuporteListPage — gating (Req 1.3)', () => {
  it('renderiza Stealth404 e NÃO chama listTickets sem SUPORTE_VIEW', () => {
    setPerms({ SUPORTE_VIEW: false });
    act(() => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(SuporteListPage)));
    });
    const text = container.textContent ?? '';
    expect(text).toContain('404');
    expect(container.querySelector('table')).toBeNull();
    expect(spy('__listTicketsSpy')).not.toHaveBeenCalled();
  });
});

describe('SuporteListPage — lista compacta (Req 2.3, padrão)', () => {
  it('sem <h1>, paginação default 10, visitante "Sem plano" e prioridade "Crítico"', async () => {
    setPerms({ SUPORTE_VIEW: true, FAQ_VIEW: true });
    spy('__listTicketsSpy').mockResolvedValue({ items: [guestTicket], total: 1 });

    act(() => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(SuporteListPage)));
    });
    await flush();

    const text = container.textContent ?? '';
    expect(container.querySelector('h1')).toBeNull(); // padrão compacto: sem h1
    const select = container.querySelector('select') as HTMLSelectElement | null;
    expect(select?.value).toBe('10'); // paginação default 10
    expect(text).toContain('Sem plano'); // visitante
    expect(text).toContain('Visitante Zé');
    expect(text).toContain('Crítico'); // priority_level 3
    expect(spy('__listTicketsSpy')).toHaveBeenCalled();
  });
});

function makeDetail(over: Partial<SupportTicketDetail> = {}): SupportTicketDetail {
  return {
    id: 't1',
    subject: 'Assunto',
    status: 'in_progress',
    priorityLevel: 2,
    responderMode: 'human',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    clientName: 'Ana',
    clientEmail: 'ana@x.com',
    clientWhatsapp: '(62) 99999-8888',
    isGuest: false,
    messages: [],
    ...over,
  };
}

function renderDetail() {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/admin/suporte/t1'] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/admin/suporte/:id',
            element: createElement(SuporteTicketDetailPage),
          })
        )
      )
    );
  });
}

describe('SuporteTicketDetailPage — botão "Retornar para IA" (Req 9.6)', () => {
  it('oculto sem SUPORTE_REPLY', async () => {
    setPerms({ SUPORTE_VIEW: true, SUPORTE_REPLY: false });
    spy('__getTicketDetailSpy').mockResolvedValue(makeDetail());
    renderDetail();
    await flush();
    expect(container.textContent ?? '').not.toContain('Retornar para IA');
  });

  it('visível com SUPORTE_REPLY e responder_mode human', async () => {
    setPerms({ SUPORTE_VIEW: true, SUPORTE_REPLY: true });
    spy('__getTicketDetailSpy').mockResolvedValue(makeDetail({ responderMode: 'human' }));
    renderDetail();
    await flush();
    expect(container.textContent ?? '').toContain('Retornar para IA');
  });
});

describe('FaqPanel — validação bloqueia envio + erro pt-BR (Req 12.3)', () => {
  it('pergunta vazia bloqueia createFaq e exibe mensagem pt-BR', async () => {
    setPerms({ FAQ_VIEW: true, FAQ_EDIT: true });
    spy('__listFaqSpy').mockResolvedValue({ items: [], total: 0 });

    act(() => {
      root = createRoot(container);
      root.render(createElement(FaqPanel));
    });
    await flush();

    clickButton('Nova FAQ'); // abre o editor (pergunta vazia)
    await flush();
    clickButton('Salvar'); // tenta salvar com pergunta inválida
    await flush();

    expect(container.textContent ?? '').toContain('A pergunta deve ter entre 3 e 300 caracteres.');
    expect(spy('__createFaqSpy')).not.toHaveBeenCalled();
  });
});

describe('SuporteBadges — render', () => {
  it('prioridade 3 => "Crítico"; status open => "Novo"', () => {
    act(() => {
      root = createRoot(container);
      root.render(
        createElement('div', null, [
          createElement(SuportePriorityBadge, { key: 'p', level: 3 }),
          createElement(SuporteStatusBadge, { key: 's', status: 'open' }),
        ])
      );
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Crítico');
    expect(text).toContain('Novo');
  });
});
