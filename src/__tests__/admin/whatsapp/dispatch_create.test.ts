// Feature: whatsapp-automation, Task 10.4: testes unitários da CRIAÇÃO de disparo
/**
 * Testes unitários da camada de serviço de criação de Dispatch_Job
 * (`createDispatchJob` em `src/services/admin/whatsapp/dispatch.ts`), contraparte
 * TypeScript da RPC `whatsapp_create_dispatch_job` (migration 099).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirements 5.7, 7.4,
 * 8.2, 8.4 (revalidação back+front, lista vazia, intervalo/quota, distribuição
 * com exatamente um Content por Dispatch_Recipient e `seq` determinístico).
 *
 * Cobre:
 *  - Revalidação no backend (defesa em profundidade): a RPC revalida
 *    lista/conteúdos/intervalo/quota e levanta markers (ERRCODE P0001) que a
 *    camada TS mapeia para as Canonical_Messages pt-BR corretas (Req 8.2, 8.4,
 *    6.5, 5.7);
 *  - Lista válida vazia (marker `WHATSAPP_EMPTY_CONTACT_LIST`) ⇒ bloqueio +
 *    mensagem canônica `Informe ao menos um contato válido.` (Req 5.7);
 *  - Intervalo (`<=0`/NaN) e Execution_Quota (`<1`/NaN) inválidos ⇒ bloqueio
 *    CLIENT-SIDE, ANTES de qualquer I/O — sem chamar a RPC nem auditar (Req 8.2,
 *    8.4);
 *  - Distribuição persistida: os args passados à RPC (`p_distribution_mode`,
 *    `p_block_size`, `p_content_ids` na ordem registrada) refletem a
 *    distribuição correta para `BLOCK` e `INTERLEAVED`, e — usando a fórmula pura
 *    compartilhada (`assignContents`, espelho do servidor) como oráculo — todo
 *    Dispatch_Recipient recebe EXATAMENTE UM Content com `seq` determinístico
 *    (Req 7.4);
 *  - Audit-by-construction incluindo o `instance_id` no log (Req 18.6), via mock
 *    de `executeAdminMutation`.
 *
 * NÃO duplica: a distribuição pura (cp5), o validador de quota/intervalo puro
 * (cp6/validation.test) nem o gating/anti-enumeração (gating.test/history.test).
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; PII (telefone) via
 * `fc.constantFrom` (NUNCA `fc.stringOf`). Identifiers/codes em inglês; mensagens
 * user-facing em pt-BR.
 *
 * **Validates: Requirements 5.7, 7.4, 8.2, 8.4**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waDispatchCreateRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waDispatchCreateAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import { createDispatchJob, type DispatchInput } from '../../../services/admin/whatsapp/dispatch';
import {
  assignContents,
  type Recipient,
  type Content,
  type DistributionMode,
} from '../../../services/admin/whatsapp/distribution';

const rpcSpy = (globalThis as Record<string, unknown>).__waDispatchCreateRpcSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waDispatchCreateAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const LIST_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONTENT_1 = 'c1111111-1111-1111-1111-111111111111';
const CONTENT_2 = 'c2222222-2222-2222-2222-222222222222';
const CONTENT_3 = 'c3333333-3333-3333-3333-333333333333';

/** Canonical_Messages pt-BR esperadas (espelho de DISPATCH_ERROR_MESSAGES). */
const MSG_INVALID_INTERVAL = 'Informe um intervalo válido.';
const MSG_INVALID_QUOTA = 'Informe uma quantidade válida.';
const MSG_NO_VALID_CONTENT = 'Informe um texto ou anexe ao menos uma mídia.';
const MSG_EMPTY_CONTACT_LIST = 'Informe ao menos um contato válido.';

/** Entrada BULK válida (client-side) — base para os cenários. */
function bulkInput(overrides: Partial<DispatchInput> = {}): DispatchInput {
  return {
    kind: 'BULK',
    distributionMode: 'INTERLEAVED',
    blockSize: null,
    sendIntervalSec: 30,
    executionQuota: 100,
    listId: LIST_A,
    contentIds: [CONTENT_1, CONTENT_2],
    status: 'QUEUED',
    ...overrides,
  };
}

/** Linha crua (snake_case) de um Dispatch_Job, como a RPC retorna. */
function rawJob(
  overrides: Partial<{
    distribution_mode: DistributionMode | null;
    block_size: number | null;
    total_count: number;
    status: string;
  }> = {}
): Record<string, unknown> {
  return {
    id: 'job-id',
    instance_id: INSTANCE_A,
    kind: 'BULK',
    status: overrides.status ?? 'QUEUED',
    distribution_mode:
      'distribution_mode' in overrides ? overrides.distribution_mode : 'INTERLEAVED',
    block_size: 'block_size' in overrides ? overrides.block_size : null,
    send_interval_sec: 30,
    execution_quota: 100,
    total_count: overrides.total_count ?? 10,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

describe('createDispatchJob — revalidação no backend mapeia markers → Canonical_Messages pt-BR', () => {
  // A RPC revalida (defesa em profundidade): mesmo com input válido no
  // frontend, o backend pode rejeitar e levantar o marker correspondente.
  const cases: Array<{ name: string; marker: string; message: string }> = [
    { name: 'intervalo inválido (Req 8.2)', marker: 'WHATSAPP_INVALID_SEND_INTERVAL', message: MSG_INVALID_INTERVAL },
    { name: 'quota inválida (Req 8.4)', marker: 'WHATSAPP_INVALID_EXECUTION_QUOTA', message: MSG_INVALID_QUOTA },
    { name: 'content inválido (Req 6.5)', marker: 'WHATSAPP_NO_VALID_CONTENT', message: MSG_NO_VALID_CONTENT },
    { name: 'lista válida vazia (Req 5.7)', marker: 'WHATSAPP_EMPTY_CONTACT_LIST', message: MSG_EMPTY_CONTACT_LIST },
  ];

  for (const { name, marker, message } of cases) {
    it(`marker ${marker} ⇒ "${message}" [${name}]`, async () => {
      rpcSpy.mockResolvedValue({
        data: null,
        error: { message: marker, code: 'P0001' },
      });

      await expect(createDispatchJob(INSTANCE_A, bulkInput())).rejects.toThrow(message);

      // O I/O ocorreu (input era válido client-side) — a RPC foi chamada.
      expect(rpcSpy).toHaveBeenCalledTimes(1);
    });
  }

  it('lista válida vazia ⇒ bloqueio com a Canonical_Message canônica (Req 5.7)', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'WHATSAPP_EMPTY_CONTACT_LIST', code: 'P0001' },
    });

    let caught = '';
    try {
      await createDispatchJob(INSTANCE_A, bulkInput({ listId: LIST_A }));
    } catch (err) {
      caught = (err as Error).message;
    }
    expect(caught).toBe(MSG_EMPTY_CONTACT_LIST);
  });
});

describe('createDispatchJob — bloqueio CLIENT-SIDE antes do I/O (Req 8.2, 8.4)', () => {
  // Intervalo inválido: <= 0 e não numérico (NaN) bloqueiam ANTES de qualquer
  // I/O — sem chamar a RPC e sem auditar.
  const badIntervals = [0, -1, -30, NaN];
  for (const interval of badIntervals) {
    it(`Send_Interval inválido (${interval}) ⇒ bloqueia sem RPC nem audit`, async () => {
      await expect(
        createDispatchJob(INSTANCE_A, bulkInput({ sendIntervalSec: interval }))
      ).rejects.toThrow(MSG_INVALID_INTERVAL);

      expect(rpcSpy).not.toHaveBeenCalled();
      expect(auditSpy).not.toHaveBeenCalled();
    });
  }

  // Quota inválida: < 1 e não numérica (NaN) bloqueiam ANTES de qualquer I/O.
  const badQuotas = [0, -1, NaN];
  for (const quota of badQuotas) {
    it(`Execution_Quota inválida (${quota}) ⇒ bloqueia sem RPC nem audit`, async () => {
      await expect(
        createDispatchJob(INSTANCE_A, bulkInput({ executionQuota: quota }))
      ).rejects.toThrow(MSG_INVALID_QUOTA);

      expect(rpcSpy).not.toHaveBeenCalled();
      expect(auditSpy).not.toHaveBeenCalled();
    });
  }

  it('intervalo tem precedência sobre a quota (ambos inválidos ⇒ mensagem de intervalo)', async () => {
    await expect(
      createDispatchJob(INSTANCE_A, bulkInput({ sendIntervalSec: 0, executionQuota: 0 }))
    ).rejects.toThrow(MSG_INVALID_INTERVAL);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('BULK sem Distribution_Mode ⇒ bloqueia client-side ("Selecione o modo de distribuição.")', async () => {
    await expect(
      createDispatchJob(INSTANCE_A, bulkInput({ distributionMode: null }))
    ).rejects.toThrow('Selecione o modo de distribuição.');

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('createDispatchJob — distribuição persistida nos args da RPC + seq determinístico (Req 7.4)', () => {
  // Telefones via fc.constantFrom (NUNCA fc.stringOf): pool fixo de E.164 válidos.
  const phoneArb = fc.constantFrom(
    '5511999998888',
    '5562999997777',
    '5521991234567',
    '5548988887777',
    '5511977776666'
  );

  // Recipients modelados (id determinístico por índice) e Contents na ordem
  // registrada. A contagem alimenta o oráculo de distribuição (assignContents).
  const recipientsArb = fc
    .array(phoneArb, { minLength: 1, maxLength: 40 })
    .map<Recipient[]>((phones) => phones.map((phone, i) => ({ id: `${phone}-${i}` })));

  const contentIdsArb = fc
    .integer({ min: 1, max: 3 })
    .map<string[]>((m) => [CONTENT_1, CONTENT_2, CONTENT_3].slice(0, m));

  const blockSizeArb = fc.integer({ min: 1, max: 8 });

  it('BLOCK: passa distribution_mode/block_size/content_ids corretos e a fórmula atribui 1 Content por recipient com seq determinístico', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientsArb,
        contentIdsArb,
        blockSizeArb,
        async (recipients, contentIds, blockSize) => {
          rpcSpy.mockReset();
          auditSpy.mockClear();
          rpcSpy.mockResolvedValue({
            data: rawJob({
              distribution_mode: 'BLOCK',
              block_size: blockSize,
              total_count: recipients.length,
            }),
            error: null,
          });

          const result = await createDispatchJob(
            INSTANCE_A,
            bulkInput({ distributionMode: 'BLOCK', blockSize, contentIds, listId: LIST_A })
          );

          // (1) Os args passados à RPC refletem a distribuição BLOCK escolhida,
          //     com os content_ids na ordem registrada (espelho de `position`).
          expect(rpcSpy).toHaveBeenCalledWith(
            'whatsapp_create_dispatch_job',
            expect.objectContaining({
              p_instance_id: INSTANCE_A,
              p_kind: 'BULK',
              p_distribution_mode: 'BLOCK',
              p_block_size: blockSize,
              p_list_id: LIST_A,
              p_content_ids: contentIds,
              p_status: 'QUEUED',
            })
          );

          // (2) Oráculo: a fórmula pura compartilhada (espelho do servidor)
          //     atribui EXATAMENTE UM Content por recipient, com seq = índice
          //     determinístico e content pertencente ao conjunto registrado.
          const contents: Content[] = contentIds.map((id) => ({ id }));
          const assignments = assignContents(recipients, contents, 'BLOCK', blockSize);
          const contentSet = new Set(contentIds);
          expect(assignments).toHaveLength(recipients.length);
          assignments.forEach((a, i) => {
            expect(a.index).toBe(i); // seq determinístico
            expect(a.recipientId).toBe(recipients[i].id);
            expect(contentSet.has(a.contentId)).toBe(true); // exatamente um Content válido
          });

          if ('ok' in result) {
            expect(result.data.distributionMode).toBe('BLOCK');
            expect(result.data.blockSize).toBe(blockSize);
            expect(result.data.totalCount).toBe(recipients.length);
          }
        }
      ),
      { numRuns: 60 }
    );
  });

  it('INTERLEAVED: passa distribution_mode=INTERLEAVED (block_size null) e a fórmula atribui 1 Content por recipient com seq determinístico', async () => {
    await fc.assert(
      fc.asyncProperty(recipientsArb, contentIdsArb, async (recipients, contentIds) => {
        rpcSpy.mockReset();
        auditSpy.mockClear();
        rpcSpy.mockResolvedValue({
          data: rawJob({
            distribution_mode: 'INTERLEAVED',
            block_size: null,
            total_count: recipients.length,
          }),
          error: null,
        });

        await createDispatchJob(
          INSTANCE_A,
          bulkInput({
            distributionMode: 'INTERLEAVED',
            blockSize: null,
            contentIds,
            listId: LIST_A,
          })
        );

        // (1) Args refletem o modo INTERLEAVED (block_size irrelevante ⇒ null).
        expect(rpcSpy).toHaveBeenCalledWith(
          'whatsapp_create_dispatch_job',
          expect.objectContaining({
            p_distribution_mode: 'INTERLEAVED',
            p_block_size: null,
            p_content_ids: contentIds,
          })
        );

        // (2) Oráculo: rodízio i mod M ⇒ um Content por recipient, seq = índice.
        const contents: Content[] = contentIds.map((id) => ({ id }));
        const assignments = assignContents(recipients, contents, 'INTERLEAVED', 1);
        expect(assignments).toHaveLength(recipients.length);
        assignments.forEach((a, i) => {
          expect(a.index).toBe(i);
          expect(a.contentId).toBe(contentIds[i % contentIds.length]);
        });
      }),
      { numRuns: 60 }
    );
  });
});

describe('createDispatchJob — audit-by-construction com instance_id (Req 18.6)', () => {
  it('audita WHATSAPP_DISPATCH_CREATE incluindo o instance_id no log', async () => {
    rpcSpy.mockResolvedValue({
      data: rawJob({ distribution_mode: 'BLOCK', block_size: 3, total_count: 10, status: 'QUEUED' }),
      error: null,
    });

    const result = await createDispatchJob(
      INSTANCE_A,
      bulkInput({ distributionMode: 'BLOCK', blockSize: 3, contentIds: [CONTENT_1, CONTENT_2] })
    );

    expect(result).toMatchObject({ ok: true });

    // O wrapper de auditoria foi acionado uma vez, ANTES/EM volta do I/O.
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_DISPATCH_CREATE',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: INSTANCE_A,
      before: null,
    });

    // O instance_id consta no snapshot `after` do audit (Req 18.6), junto de
    // metadados não sensíveis do job (sem segredos).
    const after = (input as { after: Record<string, unknown> }).after;
    expect(after).toMatchObject({
      instance_id: INSTANCE_A,
      kind: 'BULK',
      status: 'QUEUED',
      distribution_mode: 'BLOCK',
      send_interval_sec: 30,
      execution_quota: 100,
      list_id: LIST_A,
      content_count: 2,
    });
  });

  it('status default DRAFT quando omitido (auditado e enviado à RPC)', async () => {
    rpcSpy.mockResolvedValue({
      data: rawJob({ status: 'DRAFT' }),
      error: null,
    });

    await createDispatchJob(INSTANCE_A, bulkInput({ status: undefined }));

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_create_dispatch_job',
      expect.objectContaining({ p_status: 'DRAFT' })
    );
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      after: expect.objectContaining({ status: 'DRAFT' }),
    });
  });
});
