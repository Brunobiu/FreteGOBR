// Feature: whatsapp-automation, Task 11.6: testes unitários dos controles de disparo
/**
 * Testes unitários da camada de serviço de controles de disparo
 * (`src/services/admin/whatsapp/dispatch.ts` → `transitionDispatch` e
 * `resendFailed`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirements 9.5,
 * 9.6, 9.7 (transições de estado) e 23.5 (Failed_Resend sem FAILED).
 * Design: os controles "Iniciar / Pausar / Continuar / Cancelar" (RPC
 * `whatsapp_transition_dispatch`, migration 101) e "Reenviar apenas os que
 * falharam" (RPC `whatsapp_resend_failed`, migration 108) são MUTAÇÕES
 * escopadas por `instance_id`, com audit-by-construction (admin-patterns #1)
 * e idempotência `_SKIPPED` (admin-patterns #4).
 *
 * Cobre (task 11.6):
 *  - `transitionDispatch`:
 *      * transição INVÁLIDA ⇒ `INVALID_STATE_TRANSITION` propagado como código
 *        em inglês (ex.: PAUSE sobre job não-RUNNING) — Req 9.7;
 *      * transição REPETIDA/idempotente ⇒ `{ skipped, reason }` (`_SKIPPED`),
 *        SEM auditar de novo (toast neutro, não erro) — Req 9.5;
 *      * versão desatualizada ⇒ `STALE_VERSION` propagado como código em
 *        inglês — Req 9.6;
 *      * transição válida ⇒ audit positivo com `instance_id` (Req 9.8/18.6).
 *  - `resendFailed`:
 *      * origem com `FAILED` ⇒ novo Dispatch_Job `QUEUED` preservando os `SENT`,
 *        audit com `instance_id`, `source_job_id` e `failed_count` — Req 23.6;
 *      * origem SEM `FAILED` ⇒ `{ skipped: true, reason: 'NO_FAILED_RECIPIENTS' }`
 *        (`_SKIPPED`), SEM erro e SEM auditar de novo — Req 23.5.
 *
 * NOTA: os cenários de DRAFTS (stale + início inválido em `startDraft`) já estão
 * cobertos em `drafts.test.ts` e NÃO são duplicados aqui.
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; PII via
 * `fc.constantFrom` (NUNCA `fc.stringOf`). Identifiers/codes em inglês.
 *
 * **Validates: Requirements 9.5, 9.6, 9.7, 23.5**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waDispatchCtrlRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waDispatchCtrlAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  transitionDispatch,
  resendFailed,
  WHATSAPP_NO_FAILED_RECIPIENTS_REASON,
  type DispatchAction,
} from '../../../services/admin/whatsapp/dispatch';

const rpcSpy = (globalThis as Record<string, unknown>).__waDispatchCtrlRpcSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waDispatchCtrlAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const NEW_JOB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const V1 = '2026-01-01T00:00:00.000Z';
const V2 = '2026-01-02T00:00:00.000Z';

// Canonical_Message anti-enumeração (guards.ts) reusada nas asserções.
const CANONICAL_OPERATION_FAILED = 'Não foi possível concluir a operação.';

/** Erro estilo PostgREST/Supabase com um marker no `message`. */
function rpcError(marker: string, code = 'P0001'): Record<string, unknown> {
  return { message: marker, code };
}

/** Retorno cru (snake_case) de uma transição VÁLIDA da RPC. */
function transitionRow(
  action: DispatchAction,
  previous: string,
  next: string
): Record<string, unknown> {
  return {
    ok: true,
    id: JOB_A,
    instance_id: INSTANCE_A,
    action,
    previous_status: previous,
    status: next,
    updated_at: V2,
  };
}

/** Retorno cru (snake_case) do Failed_Resend criado pela RPC. */
function resendRow(
  overrides: Partial<{ failed_count: number; total_count: number }> = {}
): Record<string, unknown> {
  return {
    id: NEW_JOB,
    instance_id: INSTANCE_A,
    kind: 'BULK',
    status: 'QUEUED',
    distribution_mode: 'INTERLEAVED',
    block_size: null,
    send_interval_sec: 30,
    execution_quota: 100,
    total_count: overrides.total_count ?? 3,
    source_job_id: JOB_A,
    failed_count: overrides.failed_count ?? 3,
    created_at: V1,
    updated_at: V2,
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

/* -------------------------------------------------------------------------- *
 * transitionDispatch — transição INVÁLIDA (Req 9.7)                           *
 * -------------------------------------------------------------------------- */
describe('transitionDispatch — transição inválida ⇒ INVALID_STATE_TRANSITION (Req 9.7)', () => {
  it('PAUSE sobre job não-RUNNING ⇒ propaga INVALID_STATE_TRANSITION como código inglês', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('INVALID_STATE_TRANSITION') });

    await expect(transitionDispatch(INSTANCE_A, JOB_A, 'PAUSE', V1)).rejects.toThrow(
      'INVALID_STATE_TRANSITION'
    );

    // Falhou na RPC: NÃO há audit positivo.
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('RESUME de um job já COMPLETED/CANCELLED ⇒ INVALID_STATE_TRANSITION', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('INVALID_STATE_TRANSITION') });

    await expect(transitionDispatch(INSTANCE_A, JOB_A, 'RESUME', V1)).rejects.toThrow(
      'INVALID_STATE_TRANSITION'
    );
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * transitionDispatch — idempotência _SKIPPED (Req 9.5)                        *
 * -------------------------------------------------------------------------- */
describe('transitionDispatch — transição repetida ⇒ _SKIPPED neutro (Req 9.5)', () => {
  it('PAUSE de um job já PAUSED ⇒ { skipped, reason } sem erro e sem audit duplicado', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: 'ALREADY_PAUSED' },
      error: null,
    });

    const result = await transitionDispatch(INSTANCE_A, JOB_A, 'PAUSE', V1);

    // Resultado é skip neutro (UI exibe toast neutro, não erro).
    expect(result).toEqual({ skipped: true, reason: 'ALREADY_PAUSED' });
    expect('skipped' in result).toBe(true);

    // A própria RPC já gravou o log `_SKIPPED`: NÃO auditar de novo.
    expect(auditSpy).not.toHaveBeenCalled();

    // A RPC foi acionada com o versionamento otimista.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_transition_dispatch', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
      p_action: 'PAUSE',
      p_expected_updated_at: V1,
    });
  });

  it('skip NÃO lança exceção (não é tratado como erro)', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: 'ALREADY_CANCELLED' },
      error: null,
    });

    await expect(transitionDispatch(INSTANCE_A, JOB_A, 'CANCEL', V1)).resolves.toMatchObject({
      skipped: true,
    });
  });
});

/* -------------------------------------------------------------------------- *
 * transitionDispatch — versionamento otimista STALE_VERSION (Req 9.6)         *
 * -------------------------------------------------------------------------- */
describe('transitionDispatch — versão desatualizada ⇒ STALE_VERSION (Req 9.6)', () => {
  it('propaga STALE_VERSION como código em inglês quando outro admin alterou o job', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('STALE_VERSION') });

    await expect(transitionDispatch(INSTANCE_A, JOB_A, 'CANCEL', V1)).rejects.toThrow(
      'STALE_VERSION'
    );
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('anti-enumeração: WHATSAPP_NOT_FOUND ⇒ Canonical_Message indistinguível', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });

    await expect(transitionDispatch(INSTANCE_A, JOB_A, 'START', V1)).rejects.toThrow(
      CANONICAL_OPERATION_FAILED
    );
  });
});

/* -------------------------------------------------------------------------- *
 * transitionDispatch — transição válida audita com instance_id (Req 9.8/18.6) *
 * -------------------------------------------------------------------------- */
describe('transitionDispatch — transição válida registra audit com instance_id', () => {
  it('PAUSE de RUNNING ⇒ audit before/after com instance_id e status', async () => {
    rpcSpy.mockResolvedValue({ data: transitionRow('PAUSE', 'RUNNING', 'PAUSED'), error: null });

    const result = await transitionDispatch(INSTANCE_A, JOB_A, 'PAUSE', V1);

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.previousStatus).toBe('RUNNING');
      expect(result.data.status).toBe('PAUSED');
      expect(result.updated_at).toBe(V2);
    }

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_DISPATCH_TRANSITION',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: JOB_A,
    });
    // instance_id presente no before E no after (Req 18.6).
    expect((input as { before: { instance_id: string } }).before.instance_id).toBe(INSTANCE_A);
    expect((input as { after: { instance_id: string; status: string } }).after.instance_id).toBe(
      INSTANCE_A
    );
    expect((input as { after: { status: string } }).after.status).toBe('PAUSED');
  });
});

/* -------------------------------------------------------------------------- *
 * resendFailed — origem COM FAILED ⇒ novo job QUEUED (Req 23.3, 23.4, 23.6)    *
 * -------------------------------------------------------------------------- */
describe('resendFailed — origem com FAILED ⇒ novo Dispatch_Job QUEUED', () => {
  it('cria job QUEUED preservando os SENT e audita origem + qtd reenfileirada', async () => {
    rpcSpy.mockResolvedValue({ data: resendRow({ failed_count: 3 }), error: null });

    const result = await resendFailed(INSTANCE_A, JOB_A);

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      // Novo job é QUEUED (entra direto na fila) e é distinto da origem.
      expect(result.data.status).toBe('QUEUED');
      expect(result.data.id).toBe(NEW_JOB);
      expect(result.data.id).not.toBe(JOB_A);
      expect(result.updated_at).toBe(V2);
    }

    // RPC escopada por instance_id, a partir do job de origem.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_resend_failed', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
    });

    // Audit positivo (Req 23.6): instance_id + source_job_id + failed_count.
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_DISPATCH_RESEND',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: NEW_JOB,
    });
    expect(
      (input as { after: { instance_id: string; source_job_id: string; failed_count: number } })
        .after
    ).toMatchObject({
      instance_id: INSTANCE_A,
      source_job_id: JOB_A,
      new_job_id: NEW_JOB,
      failed_count: 3,
    });
  });
});

/* -------------------------------------------------------------------------- *
 * resendFailed — origem SEM FAILED ⇒ _SKIPPED neutro (Req 23.5)               *
 * -------------------------------------------------------------------------- */
describe('resendFailed — origem sem FAILED ⇒ NO_FAILED_RECIPIENTS (Req 23.5)', () => {
  it('retorna { skipped, reason: NO_FAILED_RECIPIENTS } sem criar job e sem audit duplicado', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: WHATSAPP_NO_FAILED_RECIPIENTS_REASON },
      error: null,
    });

    const result = await resendFailed(INSTANCE_A, JOB_A);

    expect(result).toEqual({ skipped: true, reason: 'NO_FAILED_RECIPIENTS' });
    expect('skipped' in result).toBe(true);

    // Sem mutação real: a RPC já gravou o `_SKIPPED`, não auditar de novo.
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('skip NÃO lança exceção (toast neutro, não erro)', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: WHATSAPP_NO_FAILED_RECIPIENTS_REASON },
      error: null,
    });

    await expect(resendFailed(INSTANCE_A, JOB_A)).resolves.toMatchObject({ skipped: true });
  });

  it('anti-enumeração: origem inexistente/cruzada (WHATSAPP_NOT_FOUND) ⇒ Canonical_Message', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });

    await expect(resendFailed(INSTANCE_A, JOB_A)).rejects.toThrow(CANONICAL_OPERATION_FAILED);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- *
 * Property: toda transição idempotente preserva o reason e nunca audita       *
 * -------------------------------------------------------------------------- */
describe('transitionDispatch — propriedade: _SKIPPED preserva reason e nunca audita (Req 9.5)', () => {
  it('para qualquer ação e telefone-fonte, skip propaga reason e não chama audit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<DispatchAction>('START', 'PAUSE', 'RESUME', 'CANCEL'),
        fc.constantFrom('ALREADY_QUEUED', 'ALREADY_PAUSED', 'ALREADY_CANCELLED'),
        // Telefone via constantFrom (nunca fc.stringOf) — destinatário de contexto.
        fc.constantFrom('(62) 99999-8888', '(11) 98765-4321', '(21) 99123-4567'),
        async (action, reason, _phone) => {
          rpcSpy.mockReset();
          auditSpy.mockClear();
          rpcSpy.mockResolvedValue({ data: { skipped: true, reason }, error: null });

          const result = await transitionDispatch(INSTANCE_A, JOB_A, action, V1);

          expect(result).toEqual({ skipped: true, reason });
          expect(auditSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 30 }
    );
  });
});
