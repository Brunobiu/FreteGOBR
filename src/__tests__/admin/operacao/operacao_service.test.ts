/**
 * Cenários de falha e comportamento do service admin/operacao (Task 4 / Task 6.7).
 *
 * Cobre: mapOperacaoError (cada código → OperacaoError pt-BR; precedência de
 * permission_denied; sem vazar erro cru); getOperationsMetrics (adapta bundle;
 * permission_denied preservado, não vira NETWORK); listAlerts/listLogs
 * (mapeamento snake_case + sanitização de detail + rótulo canônico); ack/resolve
 * (audit positivo só em mutação real; _SKIPPED sem audit; STALE_VERSION e
 * INVALID_STATE_TRANSITION propagam; falha de audit NÃO bloqueia a mutação).
 *
 * Validates: Requirements 3.x, 5.4, 9.3-9.10, 10.5, 11.5, 12.4, 13.x, 15.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock hoisted: spy exposto via globalThis (project-conventions).
vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) =>
      (
        (globalThis as Record<string, unknown>).__rpc as (n: string, a: unknown) => Promise<unknown>
      )(name, args),
  },
}));

import {
  mapOperacaoError,
  OperacaoError,
  getOperationsMetrics,
  listAlerts,
  listLogs,
  acknowledgeAlert,
  resolveAlert,
  triggerEvaluate,
  type OperacaoErrorCode,
} from '../../../services/admin/operacao';
import { expectNoSecrets } from '../../_helpers/logAssertions';
import { expectMutationSucceedsDespiteAuditFailure } from '../../_helpers/auditAssertions';

interface RpcCall {
  name: string;
}

/** Configura o mock de supabase.rpc; registra chamadas para asserção. */
function setupRpc(handler: (name: string) => unknown): RpcCall[] {
  const calls: RpcCall[] = [];
  (globalThis as Record<string, unknown>).__rpc = vi.fn((name: string) => {
    calls.push({ name });
    if (name === 'log_admin_action') return Promise.resolve({ data: 'log-id', error: null });
    return Promise.resolve(handler(name));
  });
  return calls;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__rpc;
});

describe('mapOperacaoError — códigos de domínio', () => {
  const cases: Array<[unknown, OperacaoErrorCode]> = [
    [{ code: '42501', message: 'permission_denied' }, 'PERMISSION_DENIED'],
    [{ message: 'permission_denied: ALERT_ACK required' }, 'PERMISSION_DENIED'],
    [{ message: 'STALE_VERSION' }, 'STALE_VERSION'],
    [{ message: 'INVALID_STATE_TRANSITION: RESOLVED cannot be acknowledged' }, 'INVALID_STATE_TRANSITION'],
    [{ message: 'NOT_FOUND: alert' }, 'NOT_FOUND'],
    [{ message: 'invalid_input: filtro' }, 'INVALID_INPUT'],
    [new Error('algo inesperado'), 'UNKNOWN'],
    [null, 'UNKNOWN'],
  ];

  it('mapeia cada código; mensagem é pt-BR não-vazia e não vaza o erro cru', () => {
    for (const [raw, expected] of cases) {
      const e = mapOperacaoError(raw);
      expect(e).toBeInstanceOf(OperacaoError);
      expect(e.code).toBe(expected);
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.message).not.toContain('STALE_VERSION');
      expect(e.message).not.toContain('INVALID_STATE_TRANSITION');
      expectNoSecrets(e.message);
    }
  });

  it('precedência: permission_denied vence validação simultânea', () => {
    expect(
      mapOperacaoError({ code: '42501', message: 'permission_denied; invalid_input: x' }).code
    ).toBe('PERMISSION_DENIED');
  });
});

describe('getOperationsMetrics', () => {
  it('adapta o bundle (KPIs disponíveis + indisponível ≠ 0)', async () => {
    setupRpc(() => ({
      data: {
        meta: { generatedAt: '2026-06-19T12:00:00Z', onlineWindowSec: 300 },
        kpis: {
          USERS_TOTAL: { value: 42, available: true },
          USERS_ONLINE: { value: null, available: false },
        },
        errors: {},
      },
      error: null,
    }));
    const bundle = await getOperationsMetrics(300);
    expect(bundle.kpis.USERS_TOTAL).toEqual({ value: 42, available: true });
    expect(bundle.kpis.USERS_ONLINE).toEqual({ value: null, available: false });
    // KPI sem fonte presente no payload => indisponível (nunca 0).
    expect(bundle.kpis.MESSAGES_SENT).toEqual({ value: null, available: false });
  });

  it('Partial_Degradation: grupo em errors força seus KPIs a indisponíveis', async () => {
    setupRpc(() => ({
      data: {
        meta: { generatedAt: '2026-06-19T12:00:00Z', onlineWindowSec: 300 },
        kpis: { MESSAGES_SENT: { value: 9, available: true } },
        errors: { messages: 'Bloco indisponível.' },
      },
      error: null,
    }));
    const bundle = await getOperationsMetrics();
    expect(bundle.kpis.MESSAGES_SENT).toEqual({ value: null, available: false });
    expect(bundle.errors.messages).toBe('Bloco indisponível.');
  });

  it('permission_denied é preservado (NÃO vira NETWORK)', async () => {
    setupRpc(() => ({ data: null, error: { code: '42501', message: 'permission_denied' } }));
    await expect(getOperationsMetrics()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('listAlerts — mapeamento snake_case + sanitização de detail', () => {
  it('mapeia a linha e remove PII do detail (não vaza segredos)', async () => {
    setupRpc(() => ({
      data: {
        items: [
          {
            id: 'a1',
            alert_type: 'WHATSAPP_DISCONNECTED',
            severity: 'CRITICAL',
            state: 'OPEN',
            source_type: 'whatsapp_session',
            source_id: 'inst-1',
            dedup_key: 'WHATSAPP_DISCONNECTED:whatsapp_session:inst-1',
            title: 'WhatsApp desconectado',
            detail: { email: 'cliente@gmail.com', count: 3, since: '2026-06-19T12:00:00Z' },
            first_seen_at: '2026-06-19T11:00:00Z',
            last_seen_at: '2026-06-19T12:00:00Z',
            acknowledged_at: null,
            acknowledged_by: null,
            resolved_at: null,
            resolved_by: null,
            created_at: '2026-06-19T11:00:00Z',
            updated_at: '2026-06-19T12:00:00Z',
          },
        ],
        total: 1,
      },
      error: null,
    }));
    const { items, total } = await listAlerts({ state: 'OPEN' }, 0, 10);
    expect(total).toBe(1);
    expect(items[0].alert_type).toBe('WHATSAPP_DISCONNECTED');
    expect(items[0].detail.count).toBe(3); // campo seguro sobrevive
    expect(items[0].detail.email).toBeUndefined(); // PII descartada
    expectNoSecrets(items[0]);
  });

  it('mapeia permission_denied', async () => {
    setupRpc(() => ({ data: null, error: { code: '42501', message: 'permission_denied' } }));
    await expect(listAlerts({}, 0, 10)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('lista vazia => items=[] e total=0', async () => {
    setupRpc(() => ({ data: { items: [], total: 0 }, error: null }));
    expect(await listAlerts()).toEqual({ items: [], total: 0 });
  });
});

describe('listLogs — rótulo canônico pt-BR', () => {
  it('resolve o summary canônico a partir do event_type', async () => {
    setupRpc(() => ({
      data: {
        items: [
          {
            occurred_at: '2026-06-19T12:00:00Z',
            event_type: 'LOGIN',
            actor: 'admin-1',
            target_type: null,
            target_id: null,
            summary: 'lixo que deveria ser ignorado',
          },
        ],
        total: 1,
      },
      error: null,
    }));
    const { items } = await listLogs({ eventTypes: ['LOGIN'] }, 0, 10);
    expect(items[0].event_type).toBe('LOGIN');
    expect(items[0].summary).toBe('Login realizado'); // rótulo canônico, não o cru
  });
});

describe('acknowledgeAlert — audit positivo só em mutação real', () => {
  it('mutação real: retorna ok e grava audit positivo (ALERT_ACK)', async () => {
    const calls = setupRpc(() => ({
      data: { ok: true, updated_at: '2026-06-19T12:00:00Z' },
      error: null,
    }));
    const res = await acknowledgeAlert('a1', '2026-06-19T11:00:00Z');
    expect(res).toEqual({ ok: true, updated_at: '2026-06-19T12:00:00Z' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(true);
  });

  it('_SKIPPED (ALREADY_ACKNOWLEDGED): retorna skip e NÃO grava audit positivo', async () => {
    const calls = setupRpc(() => ({
      data: { skipped: true, reason: 'ALREADY_ACKNOWLEDGED' },
      error: null,
    }));
    const res = await acknowledgeAlert('a1', '2026-06-19T11:00:00Z');
    expect(res).toEqual({ skipped: true, reason: 'ALREADY_ACKNOWLEDGED' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('STALE_VERSION propaga sem audit positivo', async () => {
    const calls = setupRpc(() => ({ data: null, error: { code: 'P0001', message: 'STALE_VERSION' } }));
    await expect(acknowledgeAlert('a1', 'errado')).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('INVALID_STATE_TRANSITION (ack de RESOLVED) propaga', async () => {
    setupRpc(() => ({
      data: null,
      error: { code: 'P0001', message: 'INVALID_STATE_TRANSITION: RESOLVED cannot be acknowledged' },
    }));
    await expect(acknowledgeAlert('a1', 'x')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('falha de audit NÃO bloqueia a mutação (best-effort)', async () => {
    // log_admin_action REJEITA; a mutação real ainda deve concluir.
    (globalThis as Record<string, unknown>).__rpc = vi.fn((name: string) => {
      if (name === 'log_admin_action') return Promise.reject(new Error('audit down'));
      return Promise.resolve({ data: { ok: true, updated_at: '2026-06-19T12:00:00Z' }, error: null });
    });
    const res = await expectMutationSucceedsDespiteAuditFailure(
      acknowledgeAlert('a1', '2026-06-19T11:00:00Z')
    );
    expect(res).toEqual({ ok: true, updated_at: '2026-06-19T12:00:00Z' });
  });
});

describe('resolveAlert', () => {
  it('_SKIPPED (ALREADY_RESOLVED): skip sem audit positivo', async () => {
    const calls = setupRpc(() => ({
      data: { skipped: true, reason: 'ALREADY_RESOLVED' },
      error: null,
    }));
    const res = await resolveAlert('a1', '2026-06-19T11:00:00Z');
    expect(res).toEqual({ skipped: true, reason: 'ALREADY_RESOLVED' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('mutação real grava audit positivo (ALERT_RESOLVE)', async () => {
    const calls = setupRpc(() => ({
      data: { ok: true, updated_at: '2026-06-19T12:00:00Z' },
      error: null,
    }));
    const res = await resolveAlert('a1', '2026-06-19T11:00:00Z');
    expect(res).toEqual({ ok: true, updated_at: '2026-06-19T12:00:00Z' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(true);
  });
});

describe('triggerEvaluate', () => {
  it('retorna as contagens de reconciliação', async () => {
    setupRpc(() => ({ data: { opened: 2, touched: 5, resolved: 1 }, error: null }));
    expect(await triggerEvaluate()).toEqual({ opened: 2, touched: 5, resolved: 1 });
  });

  it('mapeia permission_denied (avaliação sob demanda exige ALERT_VIEW)', async () => {
    setupRpc(() => ({ data: null, error: { code: '42501', message: 'permission_denied' } }));
    await expect(triggerEvaluate()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
