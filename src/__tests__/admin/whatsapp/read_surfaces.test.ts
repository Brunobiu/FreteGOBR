// Feature: whatsapp-automation, Task 19.4: testes das superfícies de leitura
/**
 * Testes unitários das superfícies de LEITURA do WhatsApp_Module
 * (`dashboard.ts`, `queue.ts`, `errorLog.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Req 19 (Dashboard),
 * 22 (Execution_Queue) e 23.2/23.8 (Error_Log). RPCs da migration 113, sempre
 * escopadas por `instance_id` e revalidando `SETTINGS_VIEW` no servidor.
 *
 * Cobre (task 19.4):
 *  - contadores do Instance_Dashboard mapeados (snake→camel) e coagidos a
 *    inteiros; escopo por instância (anti-enum) e precedência de
 *    `permission_denied` (Req 19.2-19.13);
 *  - mapeamento de estados da Execution_Queue para rótulos pt-BR (Req 22.8) e
 *    progresso = (SENT+FAILED+SKIPPED)/total (Req 22.2);
 *  - Error_Log lista FAILED com Contact_Number + `failure_reason`, sem vazar
 *    segredos (`expectNoSecrets`, Req 23.2, 23.8); escopo por instância.
 *
 * Convenções: `vi.mock` hoisted, spy via `globalThis`; IDs fixos; NUNCA
 * `fc.stringOf`. Leituras NÃO usam `executeAdminMutation` (sem mock de audit).
 *
 * **Validates: Requirements 19.2, 19.3, 19.4, 22.2, 22.8, 23.2, 23.8**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waReadRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

import { getDashboard } from '../../../services/admin/whatsapp/dashboard';
import {
  getExecutionQueue,
  QUEUE_GROUP_LABELS,
  type QueueGroup,
} from '../../../services/admin/whatsapp/queue';
import { getErrorLog } from '../../../services/admin/whatsapp/errorLog';
import { expectNoSecrets } from '../../_helpers/logAssertions';

const rpcSpy = (globalThis as Record<string, unknown>).__waReadRpcSpy as ReturnType<typeof vi.fn>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT = '22222222-2222-2222-2222-222222222222';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SCHED_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const CANONICAL_OPERATION_FAILED = 'Não foi possível concluir a operação.';

function rpcError(marker: string, code = 'P0001'): Record<string, unknown> {
  return { message: marker, code };
}

beforeEach(() => {
  rpcSpy.mockReset();
});

/* -------------------------------------------------------------------------- *
 * Dashboard (Req 19)                                                          *
 * -------------------------------------------------------------------------- */
describe('getDashboard — contadores do dia escopados por instância (Req 19)', () => {
  it('mapeia todos os contadores snake→camel', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        connection_status: 'CONNECTED',
        sent_today: 12,
        in_progress: 2,
        scheduled: 3,
        completed_today: 5,
        errored: 4,
        queue_current: 6,
        replies_received: 7,
        active_conversations: 8,
      },
      error: null,
    });

    const d = await getDashboard(INSTANCE_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_get_dashboard', { p_instance_id: INSTANCE_A });
    expect(d).toEqual({
      connectionStatus: 'CONNECTED',
      sentToday: 12,
      inProgress: 2,
      scheduled: 3,
      completedToday: 5,
      errored: 4,
      queueCurrent: 6,
      repliesReceived: 7,
      activeConversations: 8,
    });
  });

  it('coage valores ausentes/nulos a 0 e status ausente a DISCONNECTED', async () => {
    rpcSpy.mockResolvedValue({ data: { sent_today: null }, error: null });

    const d = await getDashboard(INSTANCE_A);
    expect(d.connectionStatus).toBe('DISCONNECTED');
    expect(d.sentToday).toBe(0);
    expect(d.activeConversations).toBe(0);
  });

  it('instância inexistente ⇒ Canonical_Message anti-enumeração (Req 19.8)', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });
    await expect(getDashboard(NON_EXISTENT)).rejects.toThrow(CANONICAL_OPERATION_FAILED);
  });

  it('sem SETTINGS_VIEW ⇒ permission_denied propagado (Req 19.9)', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'permission_denied: SETTINGS_VIEW required', code: '42501' },
    });
    await expect(getDashboard(INSTANCE_A)).rejects.toThrow('permission_denied');
  });
});

/* -------------------------------------------------------------------------- *
 * Execution_Queue (Req 22)                                                    *
 * -------------------------------------------------------------------------- */
describe('Execution_Queue — mapa de rótulos pt-BR (Req 22.8)', () => {
  it('mapeia cada estado para o rótulo correto', () => {
    const expected: Record<QueueGroup, string> = {
      QUEUED: 'Aguardando',
      RUNNING: 'Em execução',
      PAUSED: 'Pausada',
      SCHEDULED: 'Agendada',
      COMPLETED: 'Concluída',
      CANCELLED: 'Cancelada',
      FAILED: 'Erro',
    };
    expect(QUEUE_GROUP_LABELS).toEqual(expected);
  });
});

describe('getExecutionQueue — itens com rótulo e progresso (Req 22.2)', () => {
  it('mapeia item, deriva rótulo e progresso = (SENT+FAILED+SKIPPED)/total', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          job_id: JOB_A,
          scheduled_id: null,
          queue_group: 'RUNNING',
          kind: 'BULK',
          total_count: 10,
          sent_count: 3,
          failed_count: 1,
          skipped_count: 1,
          send_interval_sec: 30,
          relevant_at: '2026-02-01T10:00:00.000Z',
          updated_at: '2026-02-01T10:00:00.000Z',
        },
      ],
      error: null,
    });

    const queue = await getExecutionQueue(INSTANCE_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_get_execution_queue', {
      p_instance_id: INSTANCE_A,
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      jobId: JOB_A,
      queueGroup: 'RUNNING',
      label: 'Em execução',
      kind: 'BULK',
      totalCount: 10,
      // processados = 3 + 1 + 1 = 5 ⇒ 0.5
      progress: 0.5,
      relevantAt: '2026-02-01T10:00:00.000Z',
    });
  });

  it('item agendado (SCHEDULED) carrega scheduledId e rótulo Agendada', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          job_id: JOB_A,
          scheduled_id: SCHED_A,
          queue_group: 'SCHEDULED',
          kind: 'GROUP',
          total_count: 2,
          sent_count: 0,
          failed_count: 0,
          skipped_count: 0,
          send_interval_sec: 60,
          relevant_at: '2099-01-01T00:00:00.000Z',
          updated_at: '2026-02-01T10:00:00.000Z',
        },
      ],
      error: null,
    });

    const queue = await getExecutionQueue(INSTANCE_A);
    expect(queue[0].scheduledId).toBe(SCHED_A);
    expect(queue[0].label).toBe('Agendada');
    expect(queue[0].progress).toBe(0);
  });

  it('fila vazia ⇒ []', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await expect(getExecutionQueue(INSTANCE_A)).resolves.toEqual([]);
  });

  it('instância inexistente ⇒ Canonical_Message anti-enumeração (Req 22.4)', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });
    await expect(getExecutionQueue(NON_EXISTENT)).rejects.toThrow(CANONICAL_OPERATION_FAILED);
  });
});

/* -------------------------------------------------------------------------- *
 * Error_Log (Req 23.2, 23.8)                                                  *
 * -------------------------------------------------------------------------- */
describe('getErrorLog — FAILED com Contact_Number e motivo (Req 23.2)', () => {
  it('mapeia entradas; contactNumber = phone (CONTACT) e group_jid (GROUP)', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          recipient_id: 'r1',
          target_kind: 'CONTACT',
          phone: '+5511999998888',
          group_jid: null,
          failure_reason: 'Falha ao enviar a mensagem.',
          seq: 0,
        },
        {
          recipient_id: 'r2',
          target_kind: 'GROUP',
          phone: null,
          group_jid: '123@g.us',
          failure_reason: 'Conteudo do disparo indisponivel.',
          seq: 1,
        },
      ],
      error: null,
    });

    const log = await getErrorLog(INSTANCE_A, JOB_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_get_error_log', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
    });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ targetKind: 'CONTACT', contactNumber: '+5511999998888' });
    expect(log[1]).toMatchObject({ targetKind: 'GROUP', contactNumber: '123@g.us' });
  });

  it('não vaza segredos no failure_reason (Req 23.8)', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          recipient_id: 'r1',
          target_kind: 'CONTACT',
          phone: '+5511999998888',
          group_jid: null,
          failure_reason: 'Falha ao enviar a mensagem.',
          seq: 0,
        },
      ],
      error: null,
    });

    const log = await getErrorLog(INSTANCE_A, JOB_A);
    // O motivo é pt-BR genérico, sem tokens/keys/stack traces.
    expectNoSecrets(log);
  });

  it('sem falhas ⇒ []', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await expect(getErrorLog(INSTANCE_A, JOB_A)).resolves.toEqual([]);
  });

  it('job inexistente/cruzado ⇒ Canonical_Message anti-enumeração (Req 23.7)', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });
    await expect(getErrorLog(NON_EXISTENT, JOB_A)).rejects.toThrow(CANONICAL_OPERATION_FAILED);
  });
});
