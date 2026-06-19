/**
 * Testes de UI dos blocos da Visao 360 + validacao do NotaEditor + omissao por
 * permissao na pagina (Task 8.8). Render manual (react-dom/client + act +
 * MemoryRouter). Mocks via vi.mock hoisted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__c360Perms as
      | Record<string, boolean>
      | undefined;
    return { allowed: perms ? Boolean(perms[action]) : false, roles: [] };
  },
}));

vi.mock('../../../components/admin/AdminProvider', () => ({
  useAdminContext: () => ({ session: { userId: 'self-id', displayName: 'Admin' } }),
  AdminProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('../../../services/admin/cliente360', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/cliente360')>();
  const g = globalThis as Record<string, unknown>;
  const getDetailSpy = vi.fn();
  const createNoteSpy = vi.fn();
  g.__getDetailSpy = getDetailSpy;
  g.__createNoteSpy = createNoteSpy;
  return {
    ...actual,
    getCliente360Detail: (...a: unknown[]) => getDetailSpy(...a),
    createNote: (...a: unknown[]) => createNoteSpy(...a),
  };
});

import PlanoBlock from '../../../components/admin/cliente360/PlanoBlock';
import FinanceiroBlock from '../../../components/admin/cliente360/FinanceiroBlock';
import SuporteBlock from '../../../components/admin/cliente360/SuporteBlock';
import MensagensBlock from '../../../components/admin/cliente360/MensagensBlock';
import LoginBlock from '../../../components/admin/cliente360/LoginBlock';
import NotasBlock from '../../../components/admin/cliente360/NotasBlock';
import NotaEditor from '../../../components/admin/cliente360/NotaEditor';
import UserDetailPage from '../../../pages/admin/users/UserDetailPage';
import type {
  Cliente360Bundle,
  FinancialHistory,
  SupportHistory,
  MessageHistory,
  LoginHistory,
} from '../../../services/admin/cliente360';

function spy(name: string): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>)[name] as ReturnType<typeof vi.fn>;
}
function setPerms(p: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__c360Perms = p;
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
  if (root) act(() => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
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
function typeIntoTextarea(value: string) {
  const ta = container.querySelector('textarea') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe('Blocos da Visao 360 — estados', () => {
  it('PlanoBlock: conteudo e erro', () => {
    render(
      createElement(PlanoBlock, {
        plano: { subscription_status: 'active', is_subscribed: true, trial_ends_at: null },
        createdAt: '2024-01-10T00:00:00Z',
        onRetry: noop,
      })
    );
    expect(container.textContent ?? '').toContain('Assinante');

    render(createElement(PlanoBlock, { plano: null, createdAt: 'x', error: 'Bloco indisponível.', onRetry: noop }));
    expect(container.textContent ?? '').toContain('Bloco indisponível.');
    expect(container.textContent ?? '').toContain('Tentar novamente');
  });

  it('FinanceiroBlock: vazio', () => {
    const fin: FinancialHistory = { plan: null, charges: [], repasses: [] };
    render(createElement(FinanceiroBlock, { financeiro: fin, onRetry: noop }));
    expect(container.textContent ?? '').toContain('Nenhum lançamento financeiro registrado.');
  });

  it('SuporteBlock: vazio e link do ticket', () => {
    render(createElement(SuporteBlock, { suporte: { tickets: [] } as SupportHistory, onRetry: noop }));
    expect(container.textContent ?? '').toContain('Nenhum atendimento registrado.');

    const sup: SupportHistory = {
      tickets: [
        {
          id: 'tk1',
          subject: 'Não consigo pagar',
          status: 'open',
          priority_level: 3,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          message_count: 4,
        },
      ],
    };
    render(createElement(SuporteBlock, { suporte: sup, onRetry: noop }));
    const link = container.querySelector('a[href="/admin/suporte/tk1"]');
    expect(link).not.toBeNull();
    expect(container.textContent ?? '').toContain('Não consigo pagar');
  });

  it('MensagensBlock: vazio', () => {
    const m: MessageHistory = { frete: [], suporteChat: [] };
    render(createElement(MensagensBlock, { mensagens: m, suporteReply: false, onRetry: noop }));
    expect(container.textContent ?? '').toContain('Nenhuma conversa registrada.');
  });

  it('LoginBlock: placeholder sem telefone', () => {
    const l: LoginHistory = { attempts: [], retentionDays: 30, hasPhone: false };
    render(createElement(LoginBlock, { login: l, onRetry: noop }));
    expect(container.textContent ?? '').toContain('Sem telefone cadastrado para correlacionar logins.');
  });

  it('NotasBlock: vazio', () => {
    render(
      createElement(NotasBlock, {
        notas: [],
        canEdit: false,
        userId: 'u1',
        onRetry: noop,
        onChanged: noop,
      })
    );
    expect(container.textContent ?? '').toContain('Nenhuma observação registrada.');
  });
});

describe('NotaEditor — validacao bloqueia envio + erro pt-BR (testing-governance)', () => {
  it('body vazio NAO chama onSubmit e exibe mensagem', () => {
    const onSubmit = vi.fn();
    render(createElement(NotaEditor, { submitLabel: 'Adicionar', onSubmit }));
    clickButton('Adicionar');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.textContent ?? '').toContain('A observação não pode ficar vazia.');
  });

  it('body valido chama onSubmit com o texto', () => {
    const onSubmit = vi.fn();
    render(createElement(NotaEditor, { submitLabel: 'Adicionar', onSubmit }));
    typeIntoTextarea('cliente ligou pedindo segunda via');
    clickButton('Adicionar');
    expect(onSubmit).toHaveBeenCalledWith('cliente ligou pedindo segunda via');
  });
});

describe('NotasBlock — criar nota (wiring)', () => {
  it('envio valido chama createNote', async () => {
    spy('__createNoteSpy').mockResolvedValue({ id: 'n1', updated_at: 'x' });
    render(
      createElement(NotasBlock, {
        notas: [],
        canEdit: true,
        userId: 'u1',
        onRetry: noop,
        onChanged: noop,
      })
    );
    clickButton('Nova observação');
    typeIntoTextarea('observacao de teste');
    clickButton('Adicionar');
    await flush();
    expect(spy('__createNoteSpy')).toHaveBeenCalledWith('u1', 'observacao de teste');
  });
});

// ─── Omissao por permissao na pagina /admin/users/:id ────────────────────────

const VALID_ID = '11111111-1111-4111-8111-111111111111';

function makeBundle(): Cliente360Bundle {
  return {
    user: {
      id: VALID_ID,
      user_type: 'motorista',
      name: 'Cliente Teste',
      phone: '62999998888',
      email: 'cli@x.com',
      cpf: null,
      cnpj: null,
      company_name: null,
      is_active: true,
      ban_reason: null,
      banned_at: null,
      banned_by: null,
      profile_photo_url: null,
      admin_username: null,
      created_at: '2024-01-01T00:00:00Z',
      last_activity_at: null,
      updated_at: '2024-01-01T00:00:00Z',
    },
    bannedByName: null,
    location: null,
    documents: [],
    fretes: [],
    fretesTotal: 0,
    ratings: [],
    chat: [],
    plano: { subscription_status: 'trial', is_subscribed: false, trial_ends_at: null },
    financeiro: { plan: null, charges: [], repasses: [] },
    suporte: { tickets: [] },
    mensagens: { frete: [], suporteChat: [] },
    login: { attempts: [], retentionDays: 30, hasPhone: false },
    notas: [],
    errors: {},
  };
}

function renderDetail() {
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/admin/users/${VALID_ID}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/admin/users/:id', element: createElement(UserDetailPage) })
        )
      )
    );
  });
}

describe('UserDetailPage — omissao de blocos gated', () => {
  it('sem FINANCEIRO_VIEW/SUPORTE_VIEW/USER_NOTE_VIEW oculta os blocos gated', async () => {
    setPerms({ USER_VIEW: true });
    spy('__getDetailSpy').mockResolvedValue(makeBundle());
    renderDetail();
    await flush();
    const text = container.textContent ?? '';
    // blocos sob USER_VIEW presentes
    expect(text).toContain('Plano e cadastro');
    expect(text).toContain('Mensagens');
    expect(text).toContain('Histórico de login');
    // blocos gated OMITIDOS
    expect(text).not.toContain('Histórico financeiro');
    expect(text).not.toContain('Histórico de suporte');
    expect(text).not.toContain('Observações internas');
  });

  it('com as permissoes os blocos gated aparecem', async () => {
    setPerms({ USER_VIEW: true, FINANCEIRO_VIEW: true, SUPORTE_VIEW: true, USER_NOTE_VIEW: true });
    spy('__getDetailSpy').mockResolvedValue(makeBundle());
    renderDetail();
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Histórico financeiro');
    expect(text).toContain('Histórico de suporte');
    expect(text).toContain('Observações internas');
  });
});
