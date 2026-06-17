// Feature: whatsapp-automation, Task 12.7: camada de serviço de Group_Dispatch
/**
 * Testes unitários da camada de serviço de Group_Dispatch
 * (`src/services/admin/whatsapp/groups.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 12.1–12.7.
 * Design: Group_Dispatch REUSA o motor durável (`kind = 'GROUP'`): iniciar/salvar
 * via `createDispatchJob` (RPC 099) e agendar via `createScheduledDispatch`
 * (RPC 112). `groups.ts` é uma fina composição — sem SQL própria.
 *
 * Cobre (task 12.7):
 *  - seleção vazia bloqueada no cliente com `Selecione ao menos um grupo.`
 *    (Req 12.7), SEM I/O;
 *  - iniciar/salvar: delega a `createDispatchJob` com `kind = 'GROUP'`,
 *    `distribution_mode = NULL` e status (QUEUED por padrão — "iniciar agora");
 *  - agendar: delega a `createScheduledDispatch` com `kind = 'GROUP'`,
 *    propagando `scheduledAt` (Req 12.5); data passada herda o bloqueio
 *    `Informe uma data e hora futuras.`.
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; IDs via constantes
 * fixas; NUNCA `fc.stringOf`. Identifiers/codes em inglês; mensagens pt-BR.
 *
 * **Validates: Requirements 12.2, 12.5, 12.6, 12.7**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waGroupsRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waGroupsAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import { createGroupDispatch, scheduleGroupDispatch } from '../../../services/admin/whatsapp/groups';

const rpcSpy = (globalThis as Record<string, unknown>).__waGroupsRpcSpy as ReturnType<typeof vi.fn>;
const auditSpy = (globalThis as Record<string, unknown>).__waGroupsAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SCHED_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONTENT_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const V1 = '2026-01-01T00:00:00.000Z';
const GROUPS = ['123@g.us', '456@g.us'];

const FUTURE_ISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const NO_GROUPS_MESSAGE = 'Selecione ao menos um grupo.';
const SCHEDULE_IN_PAST_MESSAGE = 'Informe uma data e hora futuras.';

/** Linha crua (snake_case) de um Dispatch_Job GROUP retornado pela RPC 099. */
function groupJobRow(status = 'QUEUED'): Record<string, unknown> {
  return {
    id: JOB_A,
    instance_id: INSTANCE_A,
    kind: 'GROUP',
    status,
    distribution_mode: null,
    block_size: null,
    send_interval_sec: 30,
    execution_quota: 100,
    total_count: GROUPS.length,
    created_at: V1,
    updated_at: V1,
  };
}

/** Linha crua (snake_case) de um Scheduled_Dispatch GROUP retornado pela RPC 112. */
function scheduledGroupRow(): Record<string, unknown> {
  return {
    scheduled_id: SCHED_A,
    dispatch_job_id: JOB_A,
    instance_id: INSTANCE_A,
    kind: 'GROUP',
    scheduled_at: FUTURE_ISO,
    total_count: GROUPS.length,
    created_at: V1,
    updated_at: V1,
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

/* -------------------------------------------------------------------------- *
 * INICIAR/SALVAR — reuso do motor com kind=GROUP (Req 12.2, 12.6)             *
 * -------------------------------------------------------------------------- */
describe('createGroupDispatch — reutiliza o motor durável (kind=GROUP)', () => {
  it('inicia agora (QUEUED por padrão) com distribution_mode NULL e os grupos', async () => {
    rpcSpy.mockResolvedValue({ data: groupJobRow('QUEUED'), error: null });

    const result = await createGroupDispatch(INSTANCE_A, {
      groupJids: GROUPS,
      contentIds: [CONTENT_A],
      sendIntervalSec: 30,
      executionQuota: 100,
    });

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.kind).toBe('GROUP');
      expect(result.data.status).toBe('QUEUED');
    }

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_create_dispatch_job',
      expect.objectContaining({
        p_instance_id: INSTANCE_A,
        p_kind: 'GROUP',
        p_distribution_mode: null,
        p_group_jids: GROUPS,
        p_status: 'QUEUED',
      })
    );

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({ action: 'WHATSAPP_DISPATCH_CREATE' });
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE_A);
  });

  it('salvar sem iniciar (status DRAFT) é repassado à RPC', async () => {
    rpcSpy.mockResolvedValue({ data: groupJobRow('DRAFT'), error: null });

    await createGroupDispatch(INSTANCE_A, {
      groupJids: GROUPS,
      contentIds: [CONTENT_A],
      sendIntervalSec: 30,
      executionQuota: 100,
      status: 'DRAFT',
    });

    const call = rpcSpy.mock.calls.find((c) => c[0] === 'whatsapp_create_dispatch_job');
    expect((call?.[1] as { p_status: string }).p_status).toBe('DRAFT');
  });

  it('seleção vazia ⇒ Canonical_Message e NÃO chama RPC nem audit (Req 12.7)', async () => {
    await expect(
      createGroupDispatch(INSTANCE_A, {
        groupJids: [],
        contentIds: [CONTENT_A],
        sendIntervalSec: 30,
        executionQuota: 100,
      })
    ).rejects.toThrow(NO_GROUPS_MESSAGE);

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * AGENDAR — delega ao agendamento durável (Req 12.5)                          *
 * -------------------------------------------------------------------------- */
describe('scheduleGroupDispatch — agenda reutilizando createScheduledDispatch (kind=GROUP)', () => {
  it('agenda para data futura chamando whatsapp_create_scheduled_dispatch', async () => {
    rpcSpy.mockResolvedValue({ data: scheduledGroupRow(), error: null });

    const result = await scheduleGroupDispatch(INSTANCE_A, {
      groupJids: GROUPS,
      contentIds: [CONTENT_A],
      sendIntervalSec: 30,
      executionQuota: 100,
      scheduledAt: FUTURE_ISO,
    });

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.kind).toBe('GROUP');
      expect(result.data.scheduledId).toBe(SCHED_A);
    }

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_create_scheduled_dispatch',
      expect.objectContaining({
        p_instance_id: INSTANCE_A,
        p_kind: 'GROUP',
        p_distribution_mode: null,
        p_group_jids: GROUPS,
        p_scheduled_at: FUTURE_ISO,
      })
    );
  });

  it('seleção vazia ⇒ Canonical_Message, sem I/O (Req 12.7)', async () => {
    await expect(
      scheduleGroupDispatch(INSTANCE_A, {
        groupJids: [],
        contentIds: [CONTENT_A],
        sendIntervalSec: 30,
        executionQuota: 100,
        scheduledAt: FUTURE_ISO,
      })
    ).rejects.toThrow(NO_GROUPS_MESSAGE);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('data no passado ⇒ herda o bloqueio de data futura (Req 13.2), sem I/O', async () => {
    await expect(
      scheduleGroupDispatch(INSTANCE_A, {
        groupJids: GROUPS,
        contentIds: [CONTENT_A],
        sendIntervalSec: 30,
        executionQuota: 100,
        scheduledAt: PAST_ISO,
      })
    ).rejects.toThrow(SCHEDULE_IN_PAST_MESSAGE);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
