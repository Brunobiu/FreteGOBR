// Feature: whatsapp-automation, Task 11.3: camada de serviço de Drafts (rascunhos)
/**
 * Testes unitários da camada de serviço de Drafts
 * (`src/services/admin/whatsapp/drafts.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 21.1–21.8.
 * Design: Drafts reusam o motor de disparo (RPCs 099/101) + edição via 106
 * (`whatsapp_update_draft`), sempre escopados pela Active_Instance.
 *
 * Cobre (task 11.3):
 *  - SALVAR como Draft: persiste no status `DRAFT` (worker NÃO habilitado),
 *    audit com `instance_id` (Req 21.1, 21.7);
 *  - EDITAR Draft (happy path): mantém `DRAFT`, repassa os parâmetros e o
 *    `expected_updated_at`, audit com `instance_id` (Req 21.3);
 *  - caminhos negativos:
 *      * `STALE_VERSION` (versionamento otimista, Req 21.4);
 *      * `INVALID_STATE_TRANSITION` (Draft já iniciado/terminal não é editável,
 *        Req 21.3; e início inválido de algo que não está em `DRAFT`, Req 21.5);
 *      * bloqueios canônicos (lista vazia, Content inválido, intervalo/quota
 *        client-side, anti-enumeração `WHATSAPP_NOT_FOUND`) — Req 21.6, 21.8;
 *  - INICIAR Draft (happy path): transição DRAFT→QUEUED revalidada no backend
 *    (Req 21.5), com audit `instance_id`.
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; PII/IDs via
 * `fc.constantFrom`/geradores canônicos (NUNCA `fc.stringOf`). Identifiers/codes
 * em inglês; mensagens user-facing em pt-BR.
 *
 * **Validates: Requirements 21.1, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waDraftsRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waDraftsAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import { saveDraft, updateDraft, startDraft, listDrafts } from '../../../services/admin/whatsapp/drafts';
import { uuidLike } from '../../_helpers/generators';

const rpcSpy = (globalThis as Record<string, unknown>).__waDraftsRpcSpy as ReturnType<typeof vi.fn>;
const auditSpy = (globalThis as Record<string, unknown>).__waDraftsAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT = '22222222-2222-2222-2222-222222222222';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LIST_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CONTENT_A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CONTENT_B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const V1 = '2026-01-01T00:00:00.000Z';
const V2 = '2026-01-02T00:00:00.000Z';

// Canonical_Messages (pt-BR) reusadas nas asserções negativas.
const EMPTY_LIST_MESSAGE = 'Informe ao menos um contato válido.';
const NO_VALID_CONTENT_MESSAGE = 'Informe um texto ou anexe ao menos uma mídia.';
const CANONICAL_OPERATION_FAILED = 'Não foi possível concluir a operação.';

/** Linha crua (snake_case) de um Dispatch_Job / Draft retornado pelas RPCs. */
function draftRow(
  overrides: Partial<{
    status: string;
    distribution_mode: string | null;
    block_size: number | null;
    send_interval_sec: number;
    execution_quota: number;
    total_count: number;
    updated_at: string;
  }> = {}
): Record<string, unknown> {
  return {
    id: JOB_A,
    instance_id: INSTANCE_A,
    kind: 'BULK',
    status: overrides.status ?? 'DRAFT',
    distribution_mode:
      'distribution_mode' in overrides ? overrides.distribution_mode : 'INTERLEAVED',
    block_size: overrides.block_size ?? null,
    send_interval_sec: overrides.send_interval_sec ?? 30,
    execution_quota: overrides.execution_quota ?? 100,
    total_count: overrides.total_count ?? 2,
    created_at: V1,
    updated_at: overrides.updated_at ?? V2,
  };
}

/** Erro estilo PostgREST/Supabase com um marker no `message`. */
function rpcError(marker: string, code = 'P0001'): Record<string, unknown> {
  return { message: marker, code };
}

const baseUpdateInput = {
  kind: 'BULK' as const,
  distributionMode: 'INTERLEAVED' as const,
  blockSize: null,
  sendIntervalSec: 30,
  executionQuota: 100,
  listId: LIST_A,
  groupJids: null,
  contentIds: [CONTENT_A, CONTENT_B],
};

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

/* -------------------------------------------------------------------------- *
 * SALVAR como Draft (Req 21.1, 21.7)                                          *
 * -------------------------------------------------------------------------- */
describe('saveDraft — persiste no status DRAFT sem habilitar o worker (Req 21.1)', () => {
  it('força status DRAFT na criação e audita com instance_id', async () => {
    rpcSpy.mockResolvedValue({ data: draftRow({ status: 'DRAFT' }), error: null });

    const result = await saveDraft(INSTANCE_A, {
      kind: 'BULK',
      distributionMode: 'INTERLEAVED',
      sendIntervalSec: 30,
      executionQuota: 100,
      listId: LIST_A,
      contentIds: [CONTENT_A, CONTENT_B],
    });

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.status).toBe('DRAFT');
      expect(result.updated_at).toBe(V2);
    }

    // status persistido = DRAFT (worker só reclama QUEUED/RUNNING).
    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_create_dispatch_job',
      expect.objectContaining({ p_instance_id: INSTANCE_A, p_status: 'DRAFT' })
    );

    // Audit carrega o instance_id e o status DRAFT (Req 21.7, 18.6).
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_DISPATCH_CREATE',
      targetType: 'whatsapp_dispatch_jobs',
    });
    expect((input as { after: { instance_id: string; status: string } }).after.instance_id).toBe(
      INSTANCE_A
    );
    expect((input as { after: { status: string } }).after.status).toBe('DRAFT');
  });
});

/* -------------------------------------------------------------------------- *
 * EDITAR Draft — happy path (Req 21.3, 21.4, 21.7)                            *
 * -------------------------------------------------------------------------- */
describe('updateDraft — edição válida mantém DRAFT e aplica versionamento otimista', () => {
  it('repassa expected_updated_at e parâmetros, mantém DRAFT e audita instance_id', async () => {
    rpcSpy.mockResolvedValue({
      data: draftRow({ status: 'DRAFT', distribution_mode: 'BLOCK', block_size: 2, updated_at: V2 }),
      error: null,
    });

    const result = await updateDraft(
      INSTANCE_A,
      JOB_A,
      { ...baseUpdateInput, distributionMode: 'BLOCK', blockSize: 2 },
      V1
    );

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.status).toBe('DRAFT');
      expect(result.data.distributionMode).toBe('BLOCK');
      expect(result.updated_at).toBe(V2);
    }

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_update_draft',
      expect.objectContaining({
        p_instance_id: INSTANCE_A,
        p_job_id: JOB_A,
        p_expected_updated_at: V1,
        p_content_ids: [CONTENT_A, CONTENT_B],
        p_list_id: LIST_A,
      })
    );

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_DRAFT_UPDATE',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: JOB_A,
    });
    expect((input as { after: { instance_id: string; status: string } }).after.instance_id).toBe(
      INSTANCE_A
    );
    expect((input as { after: { status: string } }).after.status).toBe('DRAFT');
  });

  it('GROUP envia distribution_mode NULL e propaga os group jids', async () => {
    rpcSpy.mockResolvedValue({
      data: { ...draftRow({ status: 'DRAFT' }), kind: 'GROUP', distribution_mode: null },
      error: null,
    });

    await updateDraft(
      INSTANCE_A,
      JOB_A,
      {
        kind: 'GROUP',
        distributionMode: null,
        sendIntervalSec: 45,
        executionQuota: 50,
        groupJids: ['123@g.us', '456@g.us'],
        contentIds: [CONTENT_A],
      },
      V1
    );

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_update_draft',
      expect.objectContaining({
        p_distribution_mode: null,
        p_group_jids: ['123@g.us', '456@g.us'],
        p_list_id: null,
      })
    );
  });
});

/* -------------------------------------------------------------------------- *
 * EDITAR Draft — caminhos negativos (Req 21.3, 21.4, 21.6, 21.8)              *
 * -------------------------------------------------------------------------- */
describe('updateDraft — versionamento otimista: STALE_VERSION (Req 21.4)', () => {
  it('propaga STALE_VERSION como código em inglês quando a versão está desatualizada', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('STALE_VERSION') });

    await expect(updateDraft(INSTANCE_A, JOB_A, baseUpdateInput, V1)).rejects.toThrow(
      'STALE_VERSION'
    );
  });
});

describe('updateDraft — Draft já iniciado/terminal não é editável (Req 21.3)', () => {
  it('propaga INVALID_STATE_TRANSITION quando o job saiu de DRAFT', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('INVALID_STATE_TRANSITION') });

    await expect(updateDraft(INSTANCE_A, JOB_A, baseUpdateInput, V1)).rejects.toThrow(
      'INVALID_STATE_TRANSITION'
    );
  });
});

describe('updateDraft — bloqueios canônicos do backend (Req 21.6)', () => {
  it('lista válida vazia ⇒ Canonical_Message pt-BR', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_EMPTY_CONTACT_LIST') });

    await expect(updateDraft(INSTANCE_A, JOB_A, baseUpdateInput, V1)).rejects.toThrow(
      EMPTY_LIST_MESSAGE
    );
  });

  it('nenhum Content válido ⇒ Canonical_Message pt-BR', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NO_VALID_CONTENT') });

    await expect(updateDraft(INSTANCE_A, JOB_A, baseUpdateInput, V1)).rejects.toThrow(
      NO_VALID_CONTENT_MESSAGE
    );
  });
});

describe('updateDraft — bloqueio client-side (defesa em profundidade)', () => {
  it('intervalo inválido (<= 0) ⇒ bloqueia ANTES do I/O, sem RPC nem audit', async () => {
    await expect(
      updateDraft(INSTANCE_A, JOB_A, { ...baseUpdateInput, sendIntervalSec: 0 }, V1)
    ).rejects.toThrow('Informe um intervalo válido.');

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('quota inválida (< 1) ⇒ bloqueia ANTES do I/O, sem RPC nem audit', async () => {
    await expect(
      updateDraft(INSTANCE_A, JOB_A, { ...baseUpdateInput, executionQuota: 0 }, V1)
    ).rejects.toThrow('Informe uma quantidade válida.');

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('BULK sem modo de distribuição ⇒ bloqueia ANTES do I/O', async () => {
    await expect(
      updateDraft(INSTANCE_A, JOB_A, { ...baseUpdateInput, distributionMode: null }, V1)
    ).rejects.toThrow('Selecione o modo de distribuição.');

    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe('updateDraft — anti-enumeração (Req 21.8)', () => {
  it('instância/Draft inexistente ou cruzado ⇒ Canonical_Message indistinguível', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });

    await expect(updateDraft(NON_EXISTENT, JOB_A, baseUpdateInput, V1)).rejects.toThrow(
      CANONICAL_OPERATION_FAILED
    );
  });
});

/* -------------------------------------------------------------------------- *
 * INICIAR Draft — DRAFT→QUEUED revalidado no backend (Req 21.5)               *
 * -------------------------------------------------------------------------- */
describe('startDraft — transição DRAFT→QUEUED (Req 21.5, 21.7)', () => {
  it('aciona START com expected_updated_at e audita a transição com instance_id', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        ok: true,
        id: JOB_A,
        instance_id: INSTANCE_A,
        action: 'START',
        previous_status: 'DRAFT',
        status: 'QUEUED',
        updated_at: V2,
      },
      error: null,
    });

    const result = await startDraft(INSTANCE_A, JOB_A, V1);

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data.previousStatus).toBe('DRAFT');
      expect(result.data.status).toBe('QUEUED');
    }

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_transition_dispatch', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
      p_action: 'START',
      p_expected_updated_at: V1,
    });

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({ action: 'WHATSAPP_DISPATCH_TRANSITION', targetId: JOB_A });
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE_A);
  });

  it('início inválido (não está em DRAFT) ⇒ INVALID_STATE_TRANSITION, sem audit positivo', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('INVALID_STATE_TRANSITION') });

    await expect(startDraft(INSTANCE_A, JOB_A, V1)).rejects.toThrow('INVALID_STATE_TRANSITION');
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('versão desatualizada ao iniciar ⇒ STALE_VERSION (Req 21.4)', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('STALE_VERSION') });

    await expect(startDraft(INSTANCE_A, JOB_A, V1)).rejects.toThrow('STALE_VERSION');
  });
});

/* -------------------------------------------------------------------------- *
 * Property: a edição preserva DRAFT e repassa fielmente os contentIds         *
 * -------------------------------------------------------------------------- */
describe('updateDraft — propriedade: contentIds e DRAFT preservados (Req 21.3)', () => {
  it('para qualquer conjunto de contentIds válidos e modo, repassa os ids e mantém DRAFT', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(uuidLike(), { minLength: 1, maxLength: 6 }),
        fc.constantFrom<'BLOCK' | 'INTERLEAVED'>('BLOCK', 'INTERLEAVED'),
        async (contentIds, mode) => {
          rpcSpy.mockReset();
          auditSpy.mockClear();
          rpcSpy.mockResolvedValue({
            data: draftRow({
              status: 'DRAFT',
              distribution_mode: mode,
              block_size: mode === 'BLOCK' ? 2 : null,
              total_count: contentIds.length,
            }),
            error: null,
          });

          const result = await updateDraft(
            INSTANCE_A,
            JOB_A,
            { ...baseUpdateInput, distributionMode: mode, blockSize: mode === 'BLOCK' ? 2 : null, contentIds },
            V1
          );

          // Status permanece DRAFT (a edição nunca inicia o disparo).
          expect('ok' in result && result.data.status).toBe('DRAFT');

          // Os contentIds são repassados sem reordenação/perda à RPC.
          const call = rpcSpy.mock.calls.find((c) => c[0] === 'whatsapp_update_draft');
          expect((call?.[1] as { p_content_ids: string[] }).p_content_ids).toEqual(contentIds);
        }
      ),
      { numRuns: 30 }
    );
  });
});

/* -------------------------------------------------------------------------- *
 * LISTAR Drafts (Req 21.2)                                                    *
 * -------------------------------------------------------------------------- */
describe('listDrafts — lista rascunhos da instância (Req 21.2)', () => {
  it('mapeia as linhas cruas para camelCase', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          id: JOB_A,
          kind: 'BULK',
          distribution_mode: 'INTERLEAVED',
          block_size: null,
          send_interval_sec: 30,
          execution_quota: 100,
          total_count: 5,
          content_count: 2,
          created_at: V1,
          updated_at: V2,
        },
      ],
      error: null,
    });

    const drafts = await listDrafts(INSTANCE_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_list_drafts', { p_instance_id: INSTANCE_A });
    expect(drafts).toEqual([
      {
        id: JOB_A,
        kind: 'BULK',
        distributionMode: 'INTERLEAVED',
        blockSize: null,
        sendIntervalSec: 30,
        executionQuota: 100,
        totalCount: 5,
        contentCount: 2,
        createdAt: V1,
        updatedAt: V2,
      },
    ]);
  });

  it('retorna [] quando não há rascunhos', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await expect(listDrafts(INSTANCE_A)).resolves.toEqual([]);
  });

  it('instância inexistente ⇒ Canonical_Message anti-enumeração', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: rpcError('WHATSAPP_NOT_FOUND') });
    await expect(listDrafts(NON_EXISTENT)).rejects.toThrow(CANONICAL_OPERATION_FAILED);
  });
});
