/**
 * Testes de exemplo da UI admin de trial (Tarefa 9.6 — opcional).
 *
 * Feature: trial-e-bloqueio
 * Valida:
 *   (a) Stealth404 quando `useAdminPermission('USER_VIEW')` é negado — a
 *       TrialListPage renderiza o conteúdo do 404 furtivo (NotFoundPage), e não
 *       a tabela de motoristas (Req 10.4).
 *   (b) TrialMotoristasTable renderiza as linhas: rótulos de status
 *       (Em trial / Expirado / Assinante) e o texto de dias restantes aparecem
 *       para os motoristas fornecidos (Req 10.1, base de 10.4).
 *   (c) ExtendTrialModal — STALE_VERSION: quando `extendTrial` rejeita com um
 *       `TrialServiceError` de código `STALE_VERSION`, o modal exibe a mensagem
 *       "Outro admin atualizou. Recarregando." e chama `onSuccess` (refetch)
 *       (Req 11.3).
 *
 * Nota de convenção: o projeto não usa @testing-library/react. Seguimos o mesmo
 * padrão de render manual de `trialExpiredPage.test.tsx` / `trialBadge.example.test.tsx`:
 * `react-dom/client` (`createRoot`) + `React.act` sobre o ambiente jsdom já
 * configurado no vitest.
 *
 * Mock de hooks/serviços (steering project-conventions → "Property-based testing"):
 * `vi.mock` é hoisted — NÃO referenciar variáveis externas no factory. Os spies e
 * valores de retorno mutáveis são expostos via `(globalThis as Record<...>).__...`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock: useAdminPermission. Retorna o `allowed` derivado de um mapa de permissões
// exposto no globalThis (factory hoisted, sem referência a variáveis externas).
// ---------------------------------------------------------------------------
vi.mock('../../../hooks/useAdminPermission', () => ({
  useAdminPermission: (action: string) => {
    const perms = (globalThis as Record<string, unknown>).__trialUIPerms as
      | Record<string, boolean>
      | undefined;
    return { allowed: perms ? Boolean(perms[action]) : false, roles: [] };
  },
}));

// ---------------------------------------------------------------------------
// Mock: services/admin/trial. Mantém os helpers puros + `TrialServiceError` +
// `TRIAL_ERROR_MESSAGES` reais (via importOriginal) e substitui apenas as
// funções de I/O (`listTrialMotoristas`, `extendTrial`) por spies expostos no
// globalThis.
// ---------------------------------------------------------------------------
vi.mock('../../../services/admin/trial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/trial')>();
  const listSpy = vi.fn();
  const extendSpy = vi.fn();
  (globalThis as Record<string, unknown>).__listTrialSpy = listSpy;
  (globalThis as Record<string, unknown>).__extendTrialSpy = extendSpy;
  return {
    ...actual,
    listTrialMotoristas: (...args: unknown[]) => listSpy(...args),
    extendTrial: (...args: unknown[]) => extendSpy(...args),
  };
});

// Imports APÓS os vi.mock (hoisted de qualquer forma).
import TrialListPage from '../../../pages/admin/trial/TrialListPage';
import TrialMotoristasTable from '../../../components/admin/trial/TrialMotoristasTable';
import ExtendTrialModal from '../../../components/admin/trial/ExtendTrialModal';
import { TrialServiceError, type TrialMotoristaRow } from '../../../services/admin/trial';

// ----- Handles dos spies / helpers de estado -----
function listTrialSpy(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>).__listTrialSpy as ReturnType<typeof vi.fn>;
}
function extendTrialSpy(): ReturnType<typeof vi.fn> {
  return (globalThis as Record<string, unknown>).__extendTrialSpy as ReturnType<typeof vi.fn>;
}
function setPerms(perms: Record<string, boolean>) {
  (globalThis as Record<string, unknown>).__trialUIPerms = perms;
}

// ----- Fixture de linha -----
function makeRow(over: Partial<TrialMotoristaRow> = {}): TrialMotoristaRow {
  return {
    id: 'u-1',
    name: 'Motorista Um',
    phone: '11999990001',
    trial_ends_at: '2099-12-31T23:59:59.000Z',
    subscription_status: 'trial',
    is_subscribed: false,
    days_left: 10,
    trial_state: 'em_trial',
    updated_at: '2025-01-01T00:00:00.000Z',
    admin_username: null,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setPerms({ USER_VIEW: true, USER_EDIT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

// ===========================================================================
// (a) Stealth404 quando USER_VIEW é negado (Req 10.4)
// ===========================================================================
describe('TrialListPage — gating de permissão (Req 10.4)', () => {
  it('renderiza o Stealth404 (404 furtivo) e NÃO a tabela quando USER_VIEW é negado', () => {
    setPerms({ USER_VIEW: false, USER_EDIT: false });

    act(() => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, null, createElement(TrialListPage)));
    });

    const text = container.textContent ?? '';
    // Conteúdo idêntico ao 404 público (NotFoundPage).
    expect(text).toContain('404');
    expect(text).toContain('Pagina nao encontrada');

    // NÃO renderizou a tabela de trial (caption sr-only) nem disparou a listagem.
    expect(container.querySelector('table')).toBeNull();
    expect(text).not.toContain('Status de trial dos motoristas');
    expect(listTrialSpy()).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// (b) TrialMotoristasTable renderiza linhas com status + dias restantes (Req 10.1)
// ===========================================================================
describe('TrialMotoristasTable — render de linhas (Req 10.1)', () => {
  it('exibe os rótulos de status (Em trial / Expirado / Assinante) e o texto de dias restantes', () => {
    const rows: TrialMotoristaRow[] = [
      makeRow({ id: 'a', name: 'Ana', trial_state: 'em_trial', days_left: 10 }),
      makeRow({
        id: 'b',
        name: 'Bruno',
        trial_state: 'expirado',
        days_left: 0,
        trial_ends_at: '2020-01-01T00:00:00.000Z',
      }),
      makeRow({
        id: 'c',
        name: 'Carla',
        trial_state: 'assinante',
        is_subscribed: true,
        subscription_status: 'active',
      }),
    ];

    act(() => {
      root = createRoot(container);
      root.render(createElement(TrialMotoristasTable, { rows }));
    });

    const text = container.textContent ?? '';
    // Rótulos de status (badges).
    expect(text).toContain('Em trial');
    expect(text).toContain('Expirado');
    expect(text).toContain('Assinante');
    // Dias restantes do motorista em trial.
    expect(text).toContain('10 dias');
    // Nomes renderizados.
    expect(text).toContain('Ana');
    expect(text).toContain('Bruno');
    expect(text).toContain('Carla');
    // A tabela foi renderizada (desktop) — não é o estado vazio.
    expect(container.querySelector('table')).not.toBeNull();
    expect(text).not.toContain('Nenhum motorista encontrado');
  });
});

// ===========================================================================
// (c) ExtendTrialModal — STALE_VERSION (Req 11.3)
// ===========================================================================
describe('ExtendTrialModal — STALE_VERSION (Req 11.3)', () => {
  it('exibe "Outro admin atualizou. Recarregando." e chama onSuccess quando extendTrial rejeita com STALE_VERSION', async () => {
    extendTrialSpy().mockRejectedValueOnce(new TrialServiceError('STALE_VERSION'));

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const row = makeRow({ id: 'u-stale', trial_ends_at: '2099-12-31T23:59:59.000Z' });

    act(() => {
      root = createRoot(container);
      root.render(createElement(ExtendTrialModal, { row, open: true, onClose, onSuccess }));
    });

    // O modal pré-preenche a data (futura) e o updated_at ao abrir; submetemos o form.
    const form = container.querySelector('form');
    expect(form).not.toBeNull();

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushMicrotasks();

    // A mutação foi tentada com o updated_at capturado na abertura (versionamento otimista).
    expect(extendTrialSpy()).toHaveBeenCalledTimes(1);
    expect(extendTrialSpy()).toHaveBeenCalledWith('u-stale', expect.any(String), row.updated_at);

    // Mensagem canônica de STALE_VERSION + refetch disparado (onSuccess).
    expect(container.textContent ?? '').toContain('Outro admin atualizou. Recarregando.');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
