/**
 * Testes de UI do Tracking_Module (admin-rastreamento-inteligente, Task 11).
 *
 * Cobre: Stealth_404 na página sem permissão; ausência de <h1> grande; paginação
 * default 10 e troca 10/50/100; popover de filtros (aplica só na ação explícita);
 * estado vazio da timeline e da lista; ocultação TOTAL das ações de recuperação e
 * do card de IA em somente-leitura; navegação a /admin/users/<id>; formulário
 * inválido bloqueia o envio E exibe mensagem pt-BR (validação no frontend).
 *
 * Render manual (react-dom/client + act + MemoryRouter); mocks vi.mock hoisted,
 * spies/handlers via globalThis.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.9, 2.5, 4.4, 7.10, 12.7, 13.1, 13.7, 15.9
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

type RpcResult = { data: unknown; error: unknown };

vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      ((globalThis as Record<string, unknown>).__rpcCalls as Array<unknown>).push({ name, args });
      const h = (globalThis as Record<string, unknown>).__rpc as (n: string) => RpcResult;
      return Promise.resolve(h(name));
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__perms as Record<string, boolean>;
    return { allowed: Boolean(perms?.[action]), roles: [] };
  },
}));

vi.mock('../../../components/admin/AdminProvider', () => ({
  useAdminContext: () => ({ session: { userId: 'self', displayName: 'Admin' }, roles: [] }),
  AdminProvider: ({ children }: { children: unknown }) => children,
}));

import AdminRastreamentoPage from '../../../pages/admin/AdminRastreamentoPage';
import AtRiskTable from '../../../components/admin/rastreamento/AtRiskTable';
import TrackingAiConfigCard from '../../../components/admin/rastreamento/TrackingAiConfigCard';
import UserJourneyTimeline from '../../../components/admin/rastreamento/UserJourneyTimeline';
import TrackingFilterPopover from '../../../components/admin/rastreamento/TrackingFilterPopover';
import type { TrackingConfigView } from '../../../services/admin/rastreamento';

const g = globalThis as Record<string, unknown>;

const SAMPLE_ROW = {
  user_id: 'u1',
  name: 'João da Silva',
  profile: 'motorista',
  phone_masked: '(62) ****-**88',
  risk_score: 80,
  risk_band: 'CRITICAL',
  abandonment_cause: 'PAYMENT_DECLINED',
  risk_category: 'PAYMENT_PENDING',
  contact_status: 'AT_RISK',
  last_activity_at: '2026-01-10T00:00:00Z',
};

const FUNNEL_COUNTS = {
  VISITOR: 100, SIGNUP_STARTED: 60, SIGNUP_COMPLETED: 40, DOCUMENTS_APPROVED: 30,
  SUBSCRIPTION_PAID: 20, APP_ACTIVE: 15, FIRST_FREIGHT: 10, RECURRING_USER: 5,
};

function defaultRpc(name: string): RpcResult {
  switch (name) {
    case 'rpc_tracking_at_risk_list':
      return { data: { items: [SAMPLE_ROW], total: 1, page: 0, page_size: 10 }, error: null };
    case 'rpc_tracking_funnel':
      return { data: { window: '7d', counts: FUNNEL_COUNTS }, error: null };
    case 'rpc_tracking_recovery_performance':
      return { data: { window: '7d', counts: { AT_RISK: 5, CONTACTED: 4, REPLIED: 2, CONVERTED: 1 } }, error: null };
    case 'rpc_tracking_get_config':
      return { data: { active_provider: 'gemini', personalization_enabled: false, inactivity_days: 14, updated_at: 't0' }, error: null };
    case 'rpc_tracking_timeline':
      return { data: { events: [], current_stage: 'VISITOR' }, error: null };
    default:
      return { data: { ok: true }, error: null };
  }
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
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
function text(): string {
  return container.textContent ?? '';
}
function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label
  ) as HTMLButtonElement | undefined;
}
function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}
function setSelectByLabel(label: string, value: string) {
  const sel = Array.from(container.querySelectorAll('select')).find(
    (s) => s.getAttribute('aria-label') === label
  ) as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function setInputByLabel(label: string, value: string) {
  const el = Array.from(container.querySelectorAll('input')).find(
    (i) => i.getAttribute('aria-label') === label
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  g.__rpcCalls = [];
  g.__rpc = defaultRpc;
  g.__perms = {};
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe('AdminRastreamentoPage — gating e padrão compacto', () => {
  it('sem RASTREAMENTO_VIEW ⇒ Stealth_404 (conteúdo da aba não aparece)', async () => {
    g.__perms = {};
    render(createElement(AdminRastreamentoPage));
    await flush();
    expect(text()).not.toContain('Usuários em risco');
  });

  it('com RASTREAMENTO_VIEW ⇒ renderiza a aba sem <h1> grande', async () => {
    g.__perms = { RASTREAMENTO_VIEW: true };
    render(createElement(AdminRastreamentoPage));
    await flush();
    expect(text()).toContain('Usuários em risco');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('paginação default 10 e troca para 50 dispara nova busca com page_size 50', async () => {
    g.__perms = { RASTREAMENTO_VIEW: true };
    render(createElement(AdminRastreamentoPage));
    await flush();
    const sel = Array.from(container.querySelectorAll('select')).find(
      (s) => s.getAttribute('aria-label') === 'Itens por página'
    ) as HTMLSelectElement;
    expect(sel.value).toBe('10');
    setSelectByLabel('Itens por página', '50');
    await flush();
    const calls = g.__rpcCalls as Array<{ name: string; args: Record<string, unknown> }>;
    expect(calls.some((c) => c.name === 'rpc_tracking_at_risk_list' && c.args.p_page_size === 50)).toBe(true);
  });

  it('somente-leitura (VIEW sem MANAGE) ⇒ oculta ações de recuperação e card de IA', async () => {
    g.__perms = { RASTREAMENTO_VIEW: true, RASTREAMENTO_MANAGE: false };
    render(createElement(AdminRastreamentoPage));
    await flush();
    expect(findButton('Recuperar')).toBeUndefined();
    expect(text()).not.toContain('Personalização por IA');
  });

  it('com MANAGE ⇒ ação de recuperação e card de IA visíveis', async () => {
    g.__perms = { RASTREAMENTO_VIEW: true, RASTREAMENTO_MANAGE: true };
    render(createElement(AdminRastreamentoPage));
    await flush();
    expect(findButton('Recuperar')).toBeDefined();
    expect(text()).toContain('Personalização por IA');
  });
});

describe('AtRiskTable — estado vazio', () => {
  it('lista vazia ⇒ "Nenhum usuário encontrado."', () => {
    render(
      createElement(AtRiskTable, {
        rows: [], total: 0, page: 0, pageSize: 10, canManage: true,
        onPageChange: () => {}, onPageSizeChange: () => {}, onExportCsv: () => {},
        onSelectUser: () => {}, onOpenWhatsapp: () => {}, onCopyPhone: () => {},
        onCopyMessage: () => {}, onMarkContacted: () => {}, onTriggerRecovery: () => {},
        onViewHistory: () => {},
      })
    );
    expect(text()).toContain('Nenhum usuário encontrado.');
  });
});

describe('TrackingAiConfigCard — gating e validação frontend', () => {
  const config: TrackingConfigView = {
    active_provider: 'gemini', personalization_enabled: false, inactivity_days: 14,
    updated_at: 't0', errors: {},
  };

  it('somente-leitura ⇒ card oculto por completo', () => {
    render(
      createElement(TrackingAiConfigCard, {
        canManage: false, config, onSaveConfig: vi.fn(), onSaveKey: vi.fn(),
      })
    );
    expect(text()).not.toContain('Personalização por IA');
  });

  it('inatividade inválida bloqueia envio E exibe mensagem pt-BR', () => {
    const onSaveConfig = vi.fn();
    render(
      createElement(TrackingAiConfigCard, {
        canManage: true, config, onSaveConfig, onSaveKey: vi.fn(),
      })
    );
    setInputByLabel('Dias de inatividade', '0');
    click(findButton('Salvar configuração')!);
    expect(text()).toContain('O período de inatividade deve ser de pelo menos 1 dia.');
    expect(onSaveConfig).not.toHaveBeenCalled();
  });
});

describe('UserJourneyTimeline — estado vazio e navegação', () => {
  it('sem eventos ⇒ estado vazio + link para /admin/users/<id>', () => {
    render(
      createElement(UserJourneyTimeline, {
        userId: 'u1', userName: 'João', events: [], currentStage: 'VISITOR', onRetry: () => {},
      })
    );
    expect(text()).toContain('Nenhum evento de jornada registrado.');
    expect(container.querySelector('a[href="/admin/users/u1"]')).not.toBeNull();
  });
});

describe('TrackingFilterPopover — aplica só na ação explícita', () => {
  it('alterar valores sem "Aplicar" não dispara onApply; "Aplicar" dispara', () => {
    const onApply = vi.fn();
    render(createElement(TrackingFilterPopover, { applied: {}, onApply }));
    // abre o popover pelo botão de ícone (SlidersHorizontal)
    const iconBtn = container.querySelector('button[aria-label="Abrir filtros"]')!;
    click(iconBtn);
    // muda o score mínimo SEM aplicar
    const minInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(minInput, '50');
      minInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onApply).not.toHaveBeenCalled();
    click(findButton('Aplicar')!);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
