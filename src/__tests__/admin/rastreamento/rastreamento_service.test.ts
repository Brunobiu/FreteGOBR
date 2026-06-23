// Feature: admin-rastreamento-inteligente — camada de serviço (unit/exemplo).
//
// Cobre: _SKIPPED (mark/trigger), STALE_VERSION (config), fallback de template
// quando a IA falha, Partial_Degradation por bloco, delegação falha ⇒ NÃO marca
// CONTACTED (Req 9.12), e ausência de provedor mantendo o núcleo operável.
// Spies de vi.mock expostos via globalThis (hoisting).
//
// Validates: Requirements 7.9, 9.12, 10.5, 12.5, 12.6

import { describe, it, expect, beforeEach, vi } from 'vitest';

type RpcResult = { data: unknown; error: unknown };
type RpcHandler = (name: string, args: Record<string, unknown>) => RpcResult;
type InvokeHandler = (name: string, opts: { body?: unknown }) => RpcResult;

// vi.mock é hoisted: não referenciar variáveis externas no factory. Exponho os
// handlers/spies via globalThis (convenção do projeto).
vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      const calls = (globalThis as Record<string, unknown>).__rpcCalls as Array<unknown>;
      calls.push({ name, args });
      const handler = (globalThis as Record<string, unknown>).__rpc as RpcHandler;
      return Promise.resolve(handler(name, args ?? {}));
    },
    functions: {
      invoke: (name: string, opts: { body?: unknown }) => {
        const calls = (globalThis as Record<string, unknown>).__invokeCalls as Array<unknown>;
        calls.push({ name, opts });
        const handler = (globalThis as Record<string, unknown>).__invoke as InvokeHandler;
        return Promise.resolve(handler(name, opts ?? {}));
      },
    },
  },
}));

import {
  markContacted,
  triggerRecovery,
  updateAiConfig,
  getFunnel,
  personalizeRecoveryMessage,
  RastreamentoError,
} from '../../../services/admin/rastreamento';
import { DEFAULT_TEMPLATES } from '../../../services/admin/rastreamento/messageTemplates';

const g = globalThis as Record<string, unknown>;

/** Roteia rpc por nome; log_admin_action sempre OK (audit não bloqueia). */
function setRpc(map: Record<string, RpcResult>): void {
  g.__rpc = ((name: string) => {
    if (name === 'log_admin_action') return { data: 'log-id', error: null };
    return map[name] ?? { data: null, error: null };
  }) as RpcHandler;
}

function setInvoke(map: Record<string, RpcResult>): void {
  g.__invoke = ((name: string) => map[name] ?? { data: null, error: null }) as InvokeHandler;
}

beforeEach(() => {
  g.__rpcCalls = [];
  g.__invokeCalls = [];
  g.__rpc = (() => ({ data: null, error: null })) as RpcHandler;
  g.__invoke = (() => ({ data: null, error: null })) as InvokeHandler;
});

describe('markContacted', () => {
  it('retorna _SKIPPED quando já contatado (idempotente)', async () => {
    setRpc({
      rpc_tracking_mark_contacted: { data: { skipped: true, reason: 'ALREADY_CONTACTED' }, error: null },
    });
    const res = await markContacted('u1', '2026-01-01T00:00:00Z');
    expect(res).toEqual({ skipped: true, reason: 'ALREADY_CONTACTED' });
  });

  it('retorna ok com updated_at quando avança AT_RISK→CONTACTED', async () => {
    setRpc({
      rpc_tracking_mark_contacted: { data: { ok: true, updated_at: '2026-02-02T00:00:00Z' }, error: null },
    });
    const res = await markContacted('u1', '2026-01-01T00:00:00Z');
    expect(res).toEqual({ ok: true, updated_at: '2026-02-02T00:00:00Z' });
  });
});

describe('triggerRecovery', () => {
  it('SUPPRESS ⇒ _SKIPPED com o Suppression_Reason, sem personalizar nem delegar', async () => {
    setRpc({
      rpc_tracking_trigger_recovery: { data: { skipped: true, reason: 'WITHIN_COOLDOWN' }, error: null },
    });
    const res = await triggerRecovery('u1', { kind: 'RISK' });
    expect(res).toEqual({ skipped: true, reason: 'WITHIN_COOLDOWN' });
    // IA não foi chamada (Req 10.2).
    expect((g.__invokeCalls as Array<{ name: string }>).some((c) => c.name === 'assistant-ai')).toBe(
      false
    );
  });

  it('DISPATCH ⇒ personaliza, delega e registra (dispatched=true)', async () => {
    setRpc({
      rpc_tracking_trigger_recovery: { data: { ok: true, decision: 'DISPATCH', scenario: 'USER_INACTIVE' }, error: null },
      rpc_tracking_record_dispatch: { data: { ok: true, recovery_attempt_id: 'ra1' }, error: null },
    });
    setInvoke({
      'assistant-ai': { data: { reply: 'Olá, mensagem personalizada!' }, error: null },
      'whatsapp-evolution-proxy': { data: { ok: true, dispatch_job_id: 'job1' }, error: null },
    });
    const res = await triggerRecovery('u1', { kind: 'RISK' });
    expect(res).toEqual({ ok: true, scenario: 'USER_INACTIVE', dispatched: true });
    // registrou a tentativa (CONTACTED) após delegar.
    expect((g.__rpcCalls as Array<{ name: string }>).some((c) => c.name === 'rpc_tracking_record_dispatch')).toBe(
      true
    );
  });

  it('DISPATCH com falha de delegação ⇒ NÃO marca CONTACTED (Req 9.12)', async () => {
    setRpc({
      rpc_tracking_trigger_recovery: { data: { ok: true, decision: 'DISPATCH', scenario: 'USER_INACTIVE' }, error: null },
      rpc_tracking_record_dispatch: { data: { ok: true }, error: null },
    });
    setInvoke({
      'assistant-ai': { data: { reply: 'msg' }, error: null },
      'whatsapp-evolution-proxy': { data: null, error: { message: 'delivery failed' } },
    });
    const res = await triggerRecovery('u1', { kind: 'RISK' });
    expect(res).toEqual({ ok: true, scenario: 'USER_INACTIVE', dispatched: false });
    // record_dispatch NÃO foi chamado (sem CONTACTED).
    expect((g.__rpcCalls as Array<{ name: string }>).some((c) => c.name === 'rpc_tracking_record_dispatch')).toBe(
      false
    );
  });
});

describe('personalizeRecoveryMessage (degradação controlada)', () => {
  it('usa o template padrão quando a IA falha', async () => {
    setInvoke({ 'assistant-ai': { data: null, error: { message: 'no provider' } } });
    const msg = await personalizeRecoveryMessage('PAYMENT_FAILED', {
      current_stage: 'SUBSCRIPTION_PAID',
      risk_band: 'HIGH',
      abandonment_cause: 'PAYMENT_DECLINED',
    });
    expect(msg).toBe(DEFAULT_TEMPLATES.PAYMENT_FAILED);
  });

  it('usa a personalização quando a IA responde', async () => {
    setInvoke({ 'assistant-ai': { data: { reply: 'Mensagem da IA' }, error: null } });
    const msg = await personalizeRecoveryMessage('USER_INACTIVE', {
      current_stage: 'APP_ACTIVE',
      risk_band: 'MEDIUM',
      abandonment_cause: 'PROLONGED_INACTIVITY',
    });
    expect(msg).toBe('Mensagem da IA');
  });
});

describe('updateAiConfig', () => {
  it('propaga STALE_VERSION como RastreamentoError', async () => {
    setRpc({
      rpc_tracking_update_ai_config: { data: null, error: { code: 'P0001', message: 'STALE_VERSION' } },
    });
    await expect(updateAiConfig({ active_provider: 'grok' }, 'stale-ts')).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
  });

  it('retorna updated_at no sucesso', async () => {
    setRpc({
      rpc_tracking_update_ai_config: { data: { ok: true, updated_at: '2026-03-03T00:00:00Z' }, error: null },
    });
    const res = await updateAiConfig({ inactivity_days: 21 }, 'ts');
    expect(res).toEqual({ updated_at: '2026-03-03T00:00:00Z' });
  });
});

describe('getFunnel (Partial_Degradation)', () => {
  it('falha não-permissão ⇒ errors.funnel + contagens/métricas vazias operáveis', async () => {
    setRpc({ rpc_tracking_funnel: { data: null, error: { code: 'XX', message: 'boom' } } });
    const bundle = await getFunnel('7d');
    expect(bundle.errors.funnel).toBe('Bloco indisponível.');
    expect(bundle.counts.VISITOR).toBe(0);
    expect(bundle.metrics.overall_conversion_rate).toBe(0);
  });

  it('permission_denied propaga (vira Stealth_404 na UI)', async () => {
    setRpc({ rpc_tracking_funnel: { data: null, error: { code: '42501', message: 'permission_denied' } } });
    await expect(getFunnel('7d')).rejects.toBeInstanceOf(RastreamentoError);
  });

  it('sucesso ⇒ contagens + métricas determinísticas', async () => {
    setRpc({
      rpc_tracking_funnel: {
        data: {
          window: '7d',
          counts: {
            VISITOR: 100, SIGNUP_STARTED: 60, SIGNUP_COMPLETED: 40, DOCUMENTS_APPROVED: 30,
            SUBSCRIPTION_PAID: 20, APP_ACTIVE: 15, FIRST_FREIGHT: 10, RECURRING_USER: 5,
          },
        },
        error: null,
      },
    });
    const bundle = await getFunnel('7d');
    expect(bundle.counts.VISITOR).toBe(100);
    expect(bundle.metrics.overall_conversion_rate).toBeCloseTo(0.2, 10); // 20/100
    expect(bundle.errors.funnel).toBeUndefined();
  });
});
