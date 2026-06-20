/**
 * Cenários de falha e comportamento do service admin/supervisor (Task 4 / 6).
 *
 * Cobre: mapSupervisorError (cada código → pt-BR; precedência; sem vazar cru);
 * listDiagnostics/listInsights (mapeamento snake_case + sanitização de detail);
 * ack/dismiss (audit positivo só em mutação real; _SKIPPED sem audit;
 * STALE_VERSION/INVALID_STATE_TRANSITION propagam; audit-fail-não-bloqueia);
 * askSupervisor (degradação sem lançar); triggerEvaluate/generateSummary;
 * recordDiagnostic (detail sanitizado antes da RPC).
 *
 * Validates: Requirements 2, 3.5, 9, 11, 13.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) =>
      (
        (globalThis as Record<string, unknown>).__rpc as (n: string, a: unknown) => Promise<unknown>
      )(name, args),
    functions: {
      invoke: (name: string, opts: unknown) =>
        (
          (globalThis as Record<string, unknown>).__invoke as (
            n: string,
            o: unknown
          ) => Promise<unknown>
        )(name, opts),
    },
  },
}));

import {
  mapSupervisorError,
  SupervisorError,
  listDiagnostics,
  listInsights,
  acknowledgeInsight,
  dismissInsight,
  triggerEvaluate,
  generateSummary,
  recordDiagnostic,
  askSupervisor,
  type SupervisorErrorCode,
} from '../../../services/admin/supervisor';
import { expectNoSecrets } from '../../_helpers/logAssertions';
import { expectMutationSucceedsDespiteAuditFailure } from '../../_helpers/auditAssertions';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function setupRpc(handler: (name: string) => unknown): RpcCall[] {
  const calls: RpcCall[] = [];
  (globalThis as Record<string, unknown>).__rpc = vi.fn((name: string, args: unknown) => {
    calls.push({ name, args: (args ?? {}) as Record<string, unknown> });
    if (name === 'log_admin_action') return Promise.resolve({ data: 'log-id', error: null });
    return Promise.resolve(handler(name));
  });
  return calls;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__rpc;
  delete (globalThis as Record<string, unknown>).__invoke;
});

describe('mapSupervisorError', () => {
  const cases: Array<[unknown, SupervisorErrorCode]> = [
    [{ code: '42501', message: 'permission_denied' }, 'PERMISSION_DENIED'],
    [{ message: 'STALE_VERSION' }, 'STALE_VERSION'],
    [{ message: 'INVALID_STATE_TRANSITION: x' }, 'INVALID_STATE_TRANSITION'],
    [{ message: 'NOT_FOUND: insight' }, 'NOT_FOUND'],
    [{ message: 'invalid_input: y' }, 'INVALID_INPUT'],
    [new Error('inesperado'), 'UNKNOWN'],
    [null, 'UNKNOWN'],
  ];
  it('mapeia cada código; mensagem pt-BR não vaza o cru', () => {
    for (const [raw, expected] of cases) {
      const e = mapSupervisorError(raw);
      expect(e).toBeInstanceOf(SupervisorError);
      expect(e.code).toBe(expected);
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.message).not.toContain('STALE_VERSION');
      expectNoSecrets(e.message);
    }
  });
});

describe('listDiagnostics / listInsights — mapeamento + sanitização', () => {
  it('listDiagnostics mapeia e remove PII do detail', async () => {
    setupRpc(() => ({
      data: {
        items: [
          {
            id: 'd1',
            module: 'whatsapp',
            operation: 'send',
            severity: 'WARNING',
            error_code: 'TIMEOUT',
            description: 'falha de envio',
            probable_cause: null,
            suggested_fix: null,
            detail: { email: 'x@y.com', count: 4 },
            dedup_key: 'whatsapp:send:TIMEOUT',
            occurrence_count: 7,
            first_seen_at: 't0',
            last_seen_at: 't1',
            created_at: 't0',
            updated_at: 't1',
          },
        ],
        total: 1,
      },
      error: null,
    }));
    const { items, total } = await listDiagnostics({ module: 'whatsapp' }, 0, 10);
    expect(total).toBe(1);
    expect(items[0].occurrence_count).toBe(7);
    expect(items[0].detail.count).toBe(4);
    expect(items[0].detail.email).toBeUndefined();
    expectNoSecrets(items[0]);
  });

  it('listInsights mapeia permission_denied', async () => {
    setupRpc(() => ({ data: null, error: { code: '42501', message: 'permission_denied' } }));
    await expect(listInsights({}, 0, 10)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('acknowledgeInsight / dismissInsight', () => {
  it('ack real: ok + audit positivo SUPERVISOR_INSIGHT_ACK', async () => {
    const calls = setupRpc(() => ({ data: { ok: true, updated_at: 't2' }, error: null }));
    const res = await acknowledgeInsight('i1', 't1');
    expect(res).toEqual({ ok: true, updated_at: 't2' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(true);
  });

  it('ack _SKIPPED (ALREADY_ACKNOWLEDGED): sem audit positivo', async () => {
    const calls = setupRpc(() => ({ data: { skipped: true, reason: 'ALREADY_ACKNOWLEDGED' }, error: null }));
    const res = await acknowledgeInsight('i1', 't1');
    expect(res).toEqual({ skipped: true, reason: 'ALREADY_ACKNOWLEDGED' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('ack STALE_VERSION propaga sem audit', async () => {
    const calls = setupRpc(() => ({ data: null, error: { code: 'P0001', message: 'STALE_VERSION' } }));
    await expect(acknowledgeInsight('i1', 'errado')).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('ack INVALID_STATE_TRANSITION (insight DISMISSED) propaga', async () => {
    setupRpc(() => ({
      data: null,
      error: { code: 'P0001', message: 'INVALID_STATE_TRANSITION: DISMISSED cannot be acknowledged' },
    }));
    await expect(acknowledgeInsight('i1', 't1')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('dismiss _SKIPPED (ALREADY_DISMISSED): sem audit positivo', async () => {
    const calls = setupRpc(() => ({ data: { skipped: true, reason: 'ALREADY_DISMISSED' }, error: null }));
    const res = await dismissInsight('i1', 't1');
    expect(res).toEqual({ skipped: true, reason: 'ALREADY_DISMISSED' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('falha de audit NÃO bloqueia a mutação (best-effort)', async () => {
    (globalThis as Record<string, unknown>).__rpc = vi.fn((name: string) => {
      if (name === 'log_admin_action') return Promise.reject(new Error('audit down'));
      return Promise.resolve({ data: { ok: true, updated_at: 't2' }, error: null });
    });
    const res = await expectMutationSucceedsDespiteAuditFailure(acknowledgeInsight('i1', 't1'));
    expect(res).toEqual({ ok: true, updated_at: 't2' });
  });
});

describe('triggerEvaluate / generateSummary / recordDiagnostic', () => {
  it('triggerEvaluate retorna contagens', async () => {
    setupRpc(() => ({ data: { opened: 2, touched: 3, dismissed: 1 }, error: null }));
    expect(await triggerEvaluate()).toEqual({ opened: 2, touched: 3, dismissed: 1 });
  });

  it('generateSummary: id ou skipped', async () => {
    setupRpc(() => ({ data: { id: 's1', skipped: false }, error: null }));
    expect(await generateSummary()).toEqual({ id: 's1', skipped: false });
    setupRpc(() => ({ data: { skipped: true, reason: 'ALREADY_GENERATED' }, error: null }));
    expect(await generateSummary('daily')).toEqual({ skipped: true, reason: 'ALREADY_GENERATED' });
  });

  it('recordDiagnostic sanitiza o detail ANTES de enviar à RPC', async () => {
    const calls = setupRpc(() => ({ data: { id: 'd1', occurrence_count: 1 }, error: null }));
    await recordDiagnostic({
      module: 'whatsapp',
      operation: 'send',
      detail: { email: 'cli@x.com', count: 3, token: 'sb_secret_ABCDEFGHIJ1234567890' },
    });
    const call = calls.find((c) => c.name === 'supervisor_record_diagnostic');
    expect(call).toBeTruthy();
    const detail = call!.args.p_detail as Record<string, unknown>;
    expect(detail.count).toBe(3);
    expect(detail.email).toBeUndefined();
    expect(detail.token).toBeUndefined();
    expectNoSecrets(detail);
  });
});

describe('askSupervisor — degradação controlada', () => {
  it('resposta normal do provider', async () => {
    (globalThis as Record<string, unknown>).__invoke = vi.fn(() =>
      Promise.resolve({ data: { answer: 'Hoje entraram 37 usuários.', degraded: false }, error: null })
    );
    const res = await askSupervisor('quantos usuários hoje?');
    expect(res.answer).toContain('37');
    expect(res.degraded).toBe(false);
  });

  it('provider indisponível => degrada sem lançar', async () => {
    (globalThis as Record<string, unknown>).__invoke = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: 'provider not configured' } })
    );
    const res = await askSupervisor('como está o sistema?');
    expect(res.degraded).toBe(true);
    expect(res.answer.length).toBeGreaterThan(0);
  });

  it('falha de rede no invoke => degrada sem lançar', async () => {
    (globalThis as Record<string, unknown>).__invoke = vi.fn(() => Promise.reject(new Error('network')));
    const res = await askSupervisor('algum erro?');
    expect(res.degraded).toBe(true);
  });
});
