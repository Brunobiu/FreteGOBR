// Feature: whatsapp-automation, Task 14.2/14.3: progresso/resumo do disparo
/**
 * Testes unitários de `getDispatchProgress` (`src/services/admin/whatsapp/stats.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 11.1, 11.3,
 * 11.4, 11.5. O progresso reusa `getDispatchStatistics` (RPC 105, estado
 * persistido) e a função pura `progressPercent`, escopado por `instance_id`.
 *
 * Cobre (task 14.3):
 *  - fórmula do percentual = (SENT+FAILED+SKIPPED)/total (Req 11.4);
 *  - total/enviados/restantes corretos (Req 11.1);
 *  - `isComplete` quando todos os destinatários estão em estado terminal, com o
 *    resumo final (enviados/falhos/ignorados — Req 11.5);
 *  - job sem destinatários ⇒ progresso 0 e não-completo;
 *  - escopo por instância (anti-enumeração `WHATSAPP_NOT_FOUND`).
 *
 * Convenções: `vi.mock` hoisted, spy via `globalThis`. Leitura ⇒ sem audit.
 *
 * **Validates: Requirements 11.1, 11.4, 11.5, 28.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waProgressRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

import { getDispatchProgress } from '../../../services/admin/whatsapp/stats';

const rpcSpy = (globalThis as Record<string, unknown>).__waProgressRpcSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT = '22222222-2222-2222-2222-222222222222';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CANONICAL_OPERATION_FAILED = 'Não foi possível concluir a operação.';

/** Linha crua (snake_case) da RPC `whatsapp_get_dispatch_statistics`. */
function statsRow(o: {
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
  total: number;
}): Record<string, unknown> {
  return {
    job_id: JOB_A,
    sent_count: o.sent,
    pending_count: o.pending,
    failed_count: o.failed,
    skipped_count: o.skipped,
    completed_count: o.sent + o.failed + o.skipped,
    total_count: o.total,
    send_interval_sec: 30,
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
});

describe('getDispatchProgress — progresso/resumo (Req 11)', () => {
  it('em andamento: percentual = (SENT+FAILED+SKIPPED)/total, restantes = PENDING', async () => {
    rpcSpy.mockResolvedValue({
      data: statsRow({ sent: 3, pending: 5, failed: 1, skipped: 1, total: 10 }),
      error: null,
    });

    const p = await getDispatchProgress(INSTANCE_A, JOB_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_get_dispatch_statistics', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
    });
    expect(p.totalCount).toBe(10);
    expect(p.sentCount).toBe(3);
    expect(p.remainingCount).toBe(5);
    expect(p.progress).toBe(0.5); // (3+1+1)/10
    expect(p.isComplete).toBe(false);
    expect(p.summary).toEqual({ sent: 3, failed: 1, skipped: 1 });
  });

  it('concluído: todos terminais ⇒ progress 1 e isComplete true (Req 11.5)', async () => {
    rpcSpy.mockResolvedValue({
      data: statsRow({ sent: 2, pending: 0, failed: 1, skipped: 1, total: 4 }),
      error: null,
    });

    const p = await getDispatchProgress(INSTANCE_A, JOB_A);
    expect(p.progress).toBe(1);
    expect(p.isComplete).toBe(true);
    expect(p.remainingCount).toBe(0);
    expect(p.summary).toEqual({ sent: 2, failed: 1, skipped: 1 });
  });

  it('job sem destinatários ⇒ progresso 0 e não-completo (sem divisão por zero)', async () => {
    rpcSpy.mockResolvedValue({
      data: statsRow({ sent: 0, pending: 0, failed: 0, skipped: 0, total: 0 }),
      error: null,
    });

    const p = await getDispatchProgress(INSTANCE_A, JOB_A);
    expect(p.progress).toBe(0);
    expect(p.isComplete).toBe(false);
  });

  it('parcial com SENDING (processados < total) ⇒ não-completo', async () => {
    // total 5, mas só 3 terminais (1 ainda SENDING não contabilizado) ⇒ processed=3.
    rpcSpy.mockResolvedValue({
      data: statsRow({ sent: 2, pending: 1, failed: 1, skipped: 0, total: 5 }),
      error: null,
    });

    const p = await getDispatchProgress(INSTANCE_A, JOB_A);
    expect(p.progress).toBeCloseTo(3 / 5, 5);
    expect(p.isComplete).toBe(false);
  });

  it('instância/job inexistente ou cruzado ⇒ Canonical_Message anti-enumeração (Req 28.6)', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'WHATSAPP_NOT_FOUND', code: 'P0001' } });
    await expect(getDispatchProgress(NON_EXISTENT, JOB_A)).rejects.toThrow(
      CANONICAL_OPERATION_FAILED
    );
  });
});
