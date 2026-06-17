// Feature: whatsapp-automation, Task 12.6: camada de serviço de Scheduled_Dispatch
/**
 * Testes unitários da camada de serviço de Scheduled_Dispatch
 * (`src/services/admin/whatsapp/scheduled.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 13.1–13.7.
 * Design: agendados reusam o motor (RPC 099 via 112), criando o job em `DRAFT`
 * + uma linha em `whatsapp_scheduled_dispatches`; o sweep do worker (111)
 * promove no horário. Tudo escopado pela Active_Instance.
 *
 * Cobre (task 12.6):
 *  - CRIAR: persiste o agendamento, audita `WHATSAPP_SCHEDULED_CREATE` com
 *    `instance_id` (Req 13.1, 13.7), enviando `scheduled_at` em ISO;
 *  - data/hora no passado ⇒ bloqueio client-side `Informe uma data e hora
 *    futuras.` ANTES do I/O (Req 13.2);
 *  - bloqueios client-side de destino/conteúdo (lista/grupo/Content) e
 *    intervalo/quota (defesa em profundidade);
 *  - LISTAR pendentes: mapeia para camelCase (Req 13.4);
 *  - CANCELAR: DRAFT→CANCELLED com audit `instance_id` (Req 13.5, 13.7);
 *    idempotência `_SKIPPED` (ALREADY_CANCELLED/ALREADY_EXECUTED) sem audit
 *    positivo; `STALE_VERSION`; anti-enumeração `WHATSAPP_NOT_FOUND`.
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; IDs via constantes
 * fixas; NUNCA `fc.stringOf`. Identifiers/codes em inglês; mensagens pt-BR.
 *
 * **Validates: Requirements 13.1, 13.2, 13.4, 13.5, 13.7**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waSchedRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waSchedAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  createScheduledDispatch,
  listScheduledDispatches,
  cancelScheduledDispatch,
  WHATSAPP_SCHEDULE_IN_PAST_MESSAGE,
} from '../../../services/admin/whatsapp/scheduled';

const rpcSpy = (globalThis as Record<string, unknown>).__waSchedRpcSpy as ReturnType<typeof vi.fn>;
const auditSpy = (globalThis as Record<string, unknown>).__waSchedAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT = '22222222-2222-2222-2222-222222222222';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SCHED_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LIST_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CONTENT_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const V1 = '2026-01-01T00:00:00.000Z';
const V2 = '2026-01-02T00:00:00.000Z';

// Datas relativas ao "agora" do teste (evita flakiness por relógio).
const FUTURE_ISO = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
const PAST_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // -1h

const CANONICAL_OPERATION_FAILED = 'Não foi possível concluir a operação.';
const EMPTY_LIST_MESSAGE = 'Informe ao menos um contato válido.';
const NO_GROUPS_MESSAGE = 'Selecione ao menos um grupo.';
const NO_VALID_CONTENT_MESSAGE = 'Informe um texto ou anexe ao menos uma mídia.';

/** Linha crua (snake_case) do Scheduled_Dispatch criado pela RPC. */
function scheduledRow(
  overrides: Partial<{ kind: string; scheduled_at: string; total_count: number }> = {}
): Record<string, unknown> {
  return {
    scheduled_id: SCHED_A,
    dispatch_job_id: JOB_A,
    instance_id: INSTANCE_A,
    kind: overrides.kind ?? 'BULK',
    scheduled_at: overrides.scheduled_at ?? FUTURE_ISO,
    total_count: overrides.total_count ?? 3,
    created_at: V1,
    updated_at: V1,
  };
}

/** Erro estilo PostgREST/Supabase com um marker no `message`. */
function rpcError(marker: string, code = 'P0001'): Record<string, unknown> {
  return { message: marker, code };
}

const bulkInput = {
  kind: 'BULK' as const,
  distributionMode: 'INTERLEAVED' as const,
  sendIntervalSec: 30,
  executionQuota: 100,
  listId: LIST_A,
  contentIds: [CONTENT_A],
  scheduledAt: FUTURE_ISO,
};

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

/* -------------------------------------------------------------------------- *
 * CRIAR — happy path (Req 13.1, 13.7)                                         *
 * -------------------------------------------------------------------------- */
describe('createScheduledDispatch — cria o agendamento e audita com instance_id', () => {
  it('envia scheduled_at ISO, retorna ok e audita WHATSAPP_SCHEDULED_CREATE', async () => {
    rpcSpy.mockResolvedValue({ data: scheduledRow(), error: null });

    const result = await createScheduledDispatch(INSTANCE_A, bulkInput);

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.scheduledId).toBe(SCHED_A);
      expect(result.data.dispatchJobId).toBe(JOB_A);
      expect(result.data.scheduledAt).toBe(FUTURE_ISO);
    }

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_create_scheduled_dispatch',
      expect.objectContaining({
        p_instance_id: INSTANCE_A,
        p_kind: 'BULK',
        p_list_id: LIST_A,
        p_content_ids: [CONTENT_A],
        p_scheduled_at: FUTURE_ISO,
      })
    );

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_SCHEDULED_CREATE',
      targetType: 'whatsapp_scheduled_dispatches',
    });
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE_A);
  });

  it('aceita Date e converte para ISO no parâmetro da RPC', async () => {
    rpcSpy.mockResolvedValue({ data: scheduledRow(), error: null });
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await createScheduledDispatch(INSTANCE_A, { ...bulkInput, scheduledAt: futureDate });

    const call = rpcSpy.mock.calls.find((c) => c[0] === 'whatsapp_create_scheduled_dispatch');
    expect((call?.[1] as { p_scheduled_at: string }).p_scheduled_at).toBe(futureDate.toISOString());
  });
});

/* -------------------------------------------------------------------------- *
 * CRIAR — data no passado bloqueia ANTES do I/O (Req 13.2)                     *
 * -------------------------------------------------------------------------- */
describe('createScheduledDispatch — data/hora no passado (Req 13.2)', () => {
  it('rejeita com a Canonical_Message e NÃO chama RPC nem audit', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, scheduledAt: PAST_ISO })
    ).rejects.toThrow(WHATSAPP_SCHEDULE_IN_PAST_MESSAGE);

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('data inválida (não parseável) também é tratada como não-futura', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, scheduledAt: 'data-invalida' })
    ).rejects.toThrow(WHATSAPP_SCHEDULE_IN_PAST_MESSAGE);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('mapeia o marker de backend WHATSAPP_SCHEDULE_IN_PAST (corrida cliente/servidor)', async () => {
    // A data passa no cliente (futura) mas o backend rejeita (relógio/corrida).
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_SCHEDULE_IN_PAST') });
    await expect(createScheduledDispatch(INSTANCE_A, bulkInput)).rejects.toThrow(
      WHATSAPP_SCHEDULE_IN_PAST_MESSAGE
    );
  });
});

/* -------------------------------------------------------------------------- *
 * CRIAR — bloqueios client-side de destino/conteúdo/intervalo/quota           *
 * -------------------------------------------------------------------------- */
describe('createScheduledDispatch — bloqueios client-side (defesa em profundidade)', () => {
  it('sem Content ⇒ Canonical_Message, sem I/O', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, contentIds: [] })
    ).rejects.toThrow(NO_VALID_CONTENT_MESSAGE);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('BULK sem lista ⇒ Canonical_Message de lista vazia', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, listId: null })
    ).rejects.toThrow(EMPTY_LIST_MESSAGE);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('BULK sem modo de distribuição ⇒ bloqueia', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, distributionMode: null })
    ).rejects.toThrow('Selecione o modo de distribuição.');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('GROUP sem grupos ⇒ Canonical_Message de grupo', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, {
        kind: 'GROUP',
        sendIntervalSec: 30,
        executionQuota: 100,
        groupJids: [],
        contentIds: [CONTENT_A],
        scheduledAt: FUTURE_ISO,
      })
    ).rejects.toThrow(NO_GROUPS_MESSAGE);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('intervalo inválido (<= 0) ⇒ bloqueia antes do I/O', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, sendIntervalSec: 0 })
    ).rejects.toThrow('Informe um intervalo válido.');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('quota inválida (< 1) ⇒ bloqueia antes do I/O', async () => {
    await expect(
      createScheduledDispatch(INSTANCE_A, { ...bulkInput, executionQuota: 0 })
    ).rejects.toThrow('Informe uma quantidade válida.');
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * LISTAR pendentes (Req 13.4)                                                 *
 * -------------------------------------------------------------------------- */
describe('listScheduledDispatches — pendentes da Active_Instance (Req 13.4)', () => {
  it('mapeia as linhas cruas para camelCase', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          scheduled_id: SCHED_A,
          dispatch_job_id: JOB_A,
          scheduled_at: FUTURE_ISO,
          kind: 'GROUP',
          status: 'DRAFT',
          total_count: 2,
          send_interval_sec: 45,
          execution_quota: 50,
          group_jids: ['123@g.us', '456@g.us'],
          content_count: 1,
          updated_at: V1,
        },
      ],
      error: null,
    });

    const list = await listScheduledDispatches(INSTANCE_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_list_scheduled_dispatches', {
      p_instance_id: INSTANCE_A,
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      scheduledId: SCHED_A,
      dispatchJobId: JOB_A,
      kind: 'GROUP',
      status: 'DRAFT',
      sendIntervalSec: 45,
      groupJids: ['123@g.us', '456@g.us'],
      contentCount: 1,
      updatedAt: V1,
    });
  });

  it('retorna [] quando não há agendamentos', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await expect(listScheduledDispatches(INSTANCE_A)).resolves.toEqual([]);
  });

  it('instância inexistente ⇒ Canonical_Message anti-enumeração', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });
    await expect(listScheduledDispatches(NON_EXISTENT)).rejects.toThrow(CANONICAL_OPERATION_FAILED);
  });
});

/* -------------------------------------------------------------------------- *
 * CANCELAR (Req 13.5, 13.7)                                                    *
 * -------------------------------------------------------------------------- */
describe('cancelScheduledDispatch — DRAFT→CANCELLED com audit (Req 13.5, 13.7)', () => {
  it('cancelamento válido: repassa expected_updated_at e audita com instance_id', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        ok: true,
        scheduled_id: SCHED_A,
        dispatch_job_id: JOB_A,
        instance_id: INSTANCE_A,
        previous_status: 'DRAFT',
        status: 'CANCELLED',
        updated_at: V2,
      },
      error: null,
    });

    const result = await cancelScheduledDispatch(INSTANCE_A, SCHED_A, V1);

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.status).toBe('CANCELLED');
      expect(result.data.previousStatus).toBe('DRAFT');
      expect(result.updated_at).toBe(V2);
    }

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_cancel_scheduled_dispatch', {
      p_instance_id: INSTANCE_A,
      p_scheduled_id: SCHED_A,
      p_expected_updated_at: V1,
    });

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_SCHEDULED_CANCEL',
      targetId: SCHED_A,
    });
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE_A);
  });

  it('idempotência _SKIPPED (ALREADY_CANCELLED) ⇒ propaga skip SEM audit positivo', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: 'ALREADY_CANCELLED' },
      error: null,
    });

    const result = await cancelScheduledDispatch(INSTANCE_A, SCHED_A, V1);

    expect(result).toEqual({ skipped: true, reason: 'ALREADY_CANCELLED' });
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('idempotência _SKIPPED (ALREADY_EXECUTED) ⇒ propaga skip', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: 'ALREADY_EXECUTED' },
      error: null,
    });

    const result = await cancelScheduledDispatch(INSTANCE_A, SCHED_A, V1);
    expect(result).toEqual({ skipped: true, reason: 'ALREADY_EXECUTED' });
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('versão desatualizada ⇒ STALE_VERSION', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('STALE_VERSION') });
    await expect(cancelScheduledDispatch(INSTANCE_A, SCHED_A, V1)).rejects.toThrow('STALE_VERSION');
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('job iniciado manualmente (fora de DRAFT) ⇒ INVALID_STATE_TRANSITION', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('INVALID_STATE_TRANSITION') });
    await expect(cancelScheduledDispatch(INSTANCE_A, SCHED_A, V1)).rejects.toThrow(
      'INVALID_STATE_TRANSITION'
    );
  });

  it('agendamento inexistente/cruzado ⇒ Canonical_Message anti-enumeração', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });
    await expect(cancelScheduledDispatch(NON_EXISTENT, SCHED_A, V1)).rejects.toThrow(
      CANONICAL_OPERATION_FAILED
    );
  });
});
