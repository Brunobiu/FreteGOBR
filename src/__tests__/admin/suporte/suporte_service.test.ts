/**
 * Cenários de falha e comportamento do service admin/suporte (Task 6.7).
 *
 * Cobre: mapPostgresError (cada código → SuporteError pt-BR; precedência),
 * derivePlanoLabel, idempotência _SKIPPED (NÃO grava audit positivo), audit
 * positivo só em mutação real, flip atômico no insertHumanReply (audita
 * SUPORTE_HANDOFF só quando flipou), AI_LOCKED e STALE_VERSION.
 *
 * Validates: Requirements 3.6, 3.9, 5.5, 7.5, 8.3, 9.4, 12.1
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
  mapPostgresError,
  derivePlanoLabel,
  changeStatus,
  insertHumanReply,
  SuporteError,
  type SuporteErrorCode,
} from '../../../services/admin/suporte';

interface RpcCall {
  name: string;
}

/** Configura o mock de supabase.rpc; registra as chamadas para asserção. */
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

describe('mapPostgresError — códigos de domínio', () => {
  const cases: Array<[unknown, SuporteErrorCode]> = [
    [{ code: '42501', message: 'permission_denied' }, 'PERMISSION_DENIED'],
    [{ message: 'STALE_VERSION' }, 'STALE_VERSION'],
    [{ message: 'INVALID_STATUS_TRANSITION' }, 'INVALID_STATUS_TRANSITION'],
    [{ message: 'AI_LOCKED' }, 'AI_LOCKED'],
    [{ message: 'NOT_FOUND' }, 'NOT_FOUND'],
    [{ message: 'INVALID_INPUT: corpo' }, 'INVALID_INPUT'],
    [new Error('algo inesperado'), 'UNKNOWN'],
    [null, 'UNKNOWN'],
  ];

  it('mapeia cada código e mensagem é pt-BR não-vazia (sem vazar o erro cru)', () => {
    for (const [raw, expected] of cases) {
      const e = mapPostgresError(raw);
      expect(e).toBeInstanceOf(SuporteError);
      expect(e.code).toBe(expected);
      expect(e.message.length).toBeGreaterThan(0);
      // user-facing não é o texto técnico cru.
      expect(e.message).not.toContain('STALE_VERSION');
      expect(e.message).not.toContain('INVALID_STATUS_TRANSITION');
    }
  });
});

describe('derivePlanoLabel', () => {
  it('assinante / em teste / sem plano', () => {
    expect(derivePlanoLabel({ is_subscribed: true, subscription_status: null, trial_ends_at: null })).toBe(
      'Assinante'
    );
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      derivePlanoLabel({ is_subscribed: false, subscription_status: null, trial_ends_at: future })
    ).toBe('Em teste');
    expect(
      derivePlanoLabel({ is_subscribed: false, subscription_status: 'none', trial_ends_at: null })
    ).toBe('Sem plano');
  });
});

describe('changeStatus — _SKIPPED não gera audit positivo; mutação real gera', () => {
  it('_SKIPPED: retorna skip e NÃO chama log_admin_action', async () => {
    const calls = setupRpc(() => ({ data: { skipped: true, reason: 'ALREADY_RESOLVED' }, error: null }));
    const res = await changeStatus('t1', 'resolved', null);
    expect(res).toEqual({ skipped: true, reason: 'ALREADY_RESOLVED' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('mutação real: retorna ok e grava audit positivo (SUPORTE_STATUS_CHANGE)', async () => {
    const calls = setupRpc(() => ({ data: { ok: true, updated_at: '2026-01-01T00:00:00Z' }, error: null }));
    const res = await changeStatus('t1', 'resolved', null);
    expect(res).toEqual({ ok: true, updatedAt: '2026-01-01T00:00:00Z' });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(true);
  });

  it('INVALID_STATUS_TRANSITION propaga e mantém o estado (sem audit positivo)', async () => {
    const calls = setupRpc(() => ({ data: null, error: { message: 'INVALID_STATUS_TRANSITION' } }));
    await expect(changeStatus('t1', 'open', null)).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });
});

describe('insertHumanReply — flip atômico audita SUPORTE_HANDOFF só quando flipa', () => {
  it('handed_off=true ⇒ grava SUPORTE_HANDOFF', async () => {
    const calls = setupRpc(() => ({
      data: { ok: true, message_id: 'm1', updated_at: 'x', handed_off: true },
      error: null,
    }));
    const res = await insertHumanReply('t1', 'olá, eu assumo', null);
    expect(res.handedOff).toBe(true);
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(true);
  });

  it('handed_off=false ⇒ não grava handoff', async () => {
    const calls = setupRpc(() => ({
      data: { ok: true, message_id: 'm2', updated_at: 'x', handed_off: false },
      error: null,
    }));
    const res = await insertHumanReply('t1', 'seguindo o atendimento', null);
    expect(res.handedOff).toBe(false);
    expect(calls.some((c) => c.name === 'log_admin_action')).toBe(false);
  });

  it('AI_LOCKED propaga como erro tipado', async () => {
    setupRpc(() => ({ data: null, error: { message: 'AI_LOCKED' } }));
    await expect(insertHumanReply('t1', 'x', null)).rejects.toMatchObject({ code: 'AI_LOCKED' });
  });
});
