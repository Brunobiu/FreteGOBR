// Feature: whatsapp-automation, Task 11.4: Campaign_History (histórico de disparos)
/**
 * Testes unitários da camada de serviço do Campaign_History
 * (`src/services/admin/whatsapp/history.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 20.
 * Migration: 107 (`whatsapp_list_campaign_history`, `whatsapp_get_campaign_detail`,
 * `whatsapp_duplicate_campaign`).
 *
 * Cobre:
 *  - Listagem ESCOPADA por `instance_id` (Req 20.1, 20.2, 20.6), com
 *    `executionDurationSec` mapeado (Req 20.9, 20.10) e estados terminais
 *    preservados;
 *  - Detalhe escopado: job inexistente vs. cruzado entre instâncias ⇒ resposta
 *    INDISTINGUÍVEL → Canonical_Message anti-enumeração (Req 20.6, 2.8, 30.8);
 *  - Duplicar/Reenviar/Reutilizar gravando `source_job_id` (Req 20.4, 20.5,
 *    20.11) com AUDIT incluindo `instance_id` + origem (Req 20.7, 20.12);
 *  - Caminhos negativos: leitura sem permissão (`permission_denied`) e origem
 *    inexistente/cruzada na escrita (anti-enumeração).
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; reuso dos helpers
 * canônicos de `_helpers/`. Identifiers/codes em inglês; mensagens pt-BR.
 *
 * **Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waHistoryRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waHistoryAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  listCampaignHistory,
  getCampaignDetail,
  duplicateCampaign,
} from '../../../services/admin/whatsapp/history';
import { WHATSAPP_CANONICAL_OPERATION_FAILED } from '../../../services/admin/whatsapp/guards';
import { expectPermissionDenied } from '../../_helpers/authAssertions';
import { expectIndistinguishable } from '../../_helpers/antiEnumeration';

const rpcSpy = (globalThis as Record<string, unknown>).__waHistoryRpcSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waHistoryAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const INSTANCE_B = '99999999-9999-9999-9999-999999999999';
const JOB_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NON_EXISTENT_JOB = '22222222-2222-2222-2222-222222222222';
const CROSS_JOB = '33333333-3333-3333-3333-333333333333';

/** Marker da guarda anti-enumeração (espelha `whatsapp_assert_instance`/NOT_FOUND). */
const WHATSAPP_NOT_FOUND = 'WHATSAPP_NOT_FOUND';

/** Linha crua (snake_case) de um item do Campaign_History (como a RPC retorna). */
function historyRow(
  overrides: Partial<{
    id: string;
    status: string;
    total_count: number;
    sent_count: number;
    failed_count: number;
    content_count: number;
    source_job_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    execution_duration_sec: number | null;
  }> = {}
): Record<string, unknown> {
  return {
    id: overrides.id ?? JOB_A,
    instance_id: INSTANCE_A,
    kind: 'BULK',
    status: overrides.status ?? 'COMPLETED',
    distribution_mode: 'INTERLEAVED',
    block_size: null,
    send_interval_sec: 30,
    execution_quota: 100,
    total_count: overrides.total_count ?? 10,
    sent_count: overrides.sent_count ?? 8,
    failed_count: overrides.failed_count ?? 2,
    content_count: overrides.content_count ?? 3,
    source_job_id: 'source_job_id' in overrides ? overrides.source_job_id : null,
    started_at: 'started_at' in overrides ? overrides.started_at : '2026-01-01T10:00:00.000Z',
    completed_at:
      'completed_at' in overrides ? overrides.completed_at : '2026-01-01T10:05:00.000Z',
    execution_duration_sec:
      'execution_duration_sec' in overrides ? overrides.execution_duration_sec : 300,
    created_at: '2026-01-01T09:59:00.000Z',
    updated_at: '2026-01-01T10:05:00.000Z',
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

describe('listCampaignHistory — listagem escopada por instância (Req 20.1, 20.2, 20.6)', () => {
  it('chama a RPC escopada por instance_id e mapeia os itens (com Execution_Duration)', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        historyRow({ id: JOB_A, status: 'COMPLETED', execution_duration_sec: 300 }),
        historyRow({
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          status: 'FAILED',
          execution_duration_sec: 120,
        }),
      ],
      error: null,
    });

    const items = await listCampaignHistory(INSTANCE_A);

    // Leitura escopada por instância (Req 20.6) com defaults de paginação.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_list_campaign_history', {
      p_instance_id: INSTANCE_A,
      p_status: null,
      p_limit: 50,
      p_offset: 0,
    });

    expect(items).toHaveLength(2);
    // Estados terminais preservados (Req 20.1) e Execution_Duration (Req 20.9, 20.10).
    expect(items[0]).toMatchObject({
      id: JOB_A,
      instanceId: INSTANCE_A,
      status: 'COMPLETED',
      sentCount: 8,
      failedCount: 2,
      contentCount: 3,
      executionDurationSec: 300,
    });
    expect(items[1].status).toBe('FAILED');
  });

  it('propaga filtro de status e paginação para a RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    const items = await listCampaignHistory(INSTANCE_A, {
      status: 'COMPLETED',
      limit: 10,
      offset: 20,
    });

    expect(items).toEqual([]);
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_list_campaign_history', {
      p_instance_id: INSTANCE_A,
      p_status: 'COMPLETED',
      p_limit: 10,
      p_offset: 20,
    });
  });

  it('preserva execution_duration_sec NULL quando o disparo ainda não terminou (Req 20.10)', async () => {
    rpcSpy.mockResolvedValue({
      data: [historyRow({ status: 'RUNNING', completed_at: null, execution_duration_sec: null })],
      error: null,
    });

    const items = await listCampaignHistory(INSTANCE_A);

    expect(items[0].status).toBe('RUNNING');
    expect(items[0].completedAt).toBeNull();
    expect(items[0].executionDurationSec).toBeNull();
  });

  it('retorna lista vazia quando não há histórico (sempre array)', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    expect(await listCampaignHistory(INSTANCE_A)).toEqual([]);
  });

  it('leitura sem permissão ⇒ permission_denied (gating SETTINGS_VIEW server-side, Req 20.8)', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'permission_denied: SETTINGS_VIEW required', code: '42501' },
    });

    let caught: unknown;
    try {
      await listCampaignHistory(INSTANCE_A);
    } catch (err) {
      caught = err;
    }
    expectPermissionDenied(caught);
  });
});

describe('getCampaignDetail — detalhe escopado + anti-enumeração (Req 20.3, 20.6)', () => {
  it('mapeia o detalhe completo (contents com mídias + destinatários + duração)', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        id: JOB_A,
        instance_id: INSTANCE_A,
        kind: 'BULK',
        status: 'COMPLETED',
        distribution_mode: 'BLOCK',
        block_size: 2,
        send_interval_sec: 30,
        execution_quota: 100,
        total_count: 2,
        sent_count: 1,
        failed_count: 1,
        skipped_count: 0,
        pending_count: 0,
        source_job_id: null,
        started_at: '2026-01-01T10:00:00.000Z',
        completed_at: '2026-01-01T10:02:00.000Z',
        execution_duration_sec: 120,
        created_at: '2026-01-01T09:59:00.000Z',
        updated_at: '2026-01-01T10:02:00.000Z',
        contents: [
          {
            id: 'content-1',
            body: 'Olá {{nome}}',
            position: 0,
            is_valid: true,
            media: [
              {
                id: 'media-1',
                media_type: 'IMAGE',
                mime_type: 'image/png',
                storage_path: 'inst/a/img.png',
              },
            ],
          },
        ],
        recipients: [
          {
            id: 'rec-1',
            target_kind: 'CONTACT',
            phone: '5511999990000',
            group_jid: null,
            recipient_data: { nome: 'Ana' },
            assigned_content_id: 'content-1',
            seq: 0,
            status: 'SENT',
            sent_at: '2026-01-01T10:00:30.000Z',
            failure_reason: null,
          },
          {
            id: 'rec-2',
            target_kind: 'CONTACT',
            phone: '5511999990001',
            group_jid: null,
            recipient_data: { nome: 'Bia' },
            assigned_content_id: 'content-1',
            seq: 1,
            status: 'FAILED',
            sent_at: null,
            failure_reason: 'Número inválido.',
          },
        ],
      },
      error: null,
    });

    const detail = await getCampaignDetail(INSTANCE_A, JOB_A);

    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_get_campaign_detail', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
    });

    expect(detail).toMatchObject({
      id: JOB_A,
      instanceId: INSTANCE_A,
      executionDurationSec: 120,
      sentCount: 1,
      failedCount: 1,
    });
    expect(detail.contents).toHaveLength(1);
    expect(detail.contents[0].media[0]).toMatchObject({
      id: 'media-1',
      mediaType: 'IMAGE',
      mimeType: 'image/png',
      storagePath: 'inst/a/img.png',
    });
    expect(detail.recipients).toHaveLength(2);
    expect(detail.recipients[1]).toMatchObject({
      status: 'FAILED',
      failureReason: 'Número inválido.',
    });
  });

  it('job inexistente vs. cruzado entre instâncias ⇒ resposta INDISTINGUÍVEL (anti-enumeração)', async () => {
    // Job inexistente: a guarda levanta WHATSAPP_NOT_FOUND.
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND, code: 'P0001' },
    });
    let nonExistingMsg = '';
    try {
      await getCampaignDetail(INSTANCE_A, NON_EXISTENT_JOB);
    } catch (err) {
      nonExistingMsg = (err as Error).message;
    }

    // Job de OUTRA instância (cruzado): mesma guarda, resposta idêntica.
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND, code: 'P0001' },
    });
    let crossMsg = '';
    try {
      await getCampaignDetail(INSTANCE_B, CROSS_JOB);
    } catch (err) {
      crossMsg = (err as Error).message;
    }

    expectIndistinguishable({ message: nonExistingMsg }, { message: crossMsg });
    expect(nonExistingMsg).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
  });
});

describe('duplicateCampaign — Duplicar/Reenviar/Reutilizar com source_job_id (Req 20.4, 20.5, 20.11)', () => {
  /** Linha crua (snake_case) do novo Dispatch_Job retornado pela RPC. */
  function duplicatedRow(mode: string, status: string): Record<string, unknown> {
    return {
      id: 'new-job-id',
      instance_id: INSTANCE_A,
      kind: 'BULK',
      status,
      distribution_mode: 'INTERLEAVED',
      block_size: null,
      send_interval_sec: 30,
      execution_quota: 100,
      total_count: 10,
      source_job_id: JOB_A,
      mode,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    };
  }

  it('DUPLICATE ⇒ novo job em DRAFT, grava source_job_id e audita instance_id + origem', async () => {
    rpcSpy.mockResolvedValue({ data: duplicatedRow('DUPLICATE', 'DRAFT'), error: null });

    const result = await duplicateCampaign(INSTANCE_A, JOB_A, 'DUPLICATE');

    expect(result).toMatchObject({ ok: true });
    if ('ok' in result) {
      expect(result.data).toMatchObject({
        id: 'new-job-id',
        status: 'DRAFT',
        sourceJobId: JOB_A,
        mode: 'DUPLICATE',
      });
    }

    // RPC escopada por instância + origem + modo.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_duplicate_campaign', {
      p_instance_id: INSTANCE_A,
      p_job_id: JOB_A,
      p_mode: 'DUPLICATE',
    });

    // Audit (Req 20.7, 20.12): instance_id + source_job_id na origem.
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_CAMPAIGN_DUPLICATE',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: JOB_A,
    });
    expect((input as { after: { instance_id: string; source_job_id: string } }).after).toMatchObject(
      { instance_id: INSTANCE_A, source_job_id: JOB_A }
    );
  });

  it('RESEND ⇒ novo job em QUEUED, original preservado, audit WHATSAPP_CAMPAIGN_RESEND (Req 20.5)', async () => {
    rpcSpy.mockResolvedValue({ data: duplicatedRow('RESEND', 'QUEUED'), error: null });

    const result = await duplicateCampaign(INSTANCE_A, JOB_A, 'RESEND');

    if ('ok' in result) {
      expect(result.data.status).toBe('QUEUED');
      expect(result.data.sourceJobId).toBe(JOB_A);
    }
    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_duplicate_campaign',
      expect.objectContaining({ p_mode: 'RESEND' })
    );
    expect(auditSpy.mock.calls[0][0]).toMatchObject({ action: 'WHATSAPP_CAMPAIGN_RESEND' });
  });

  it('REUSE ⇒ novo job em DRAFT para edição, audit WHATSAPP_CAMPAIGN_REUSE (Req 20.11)', async () => {
    rpcSpy.mockResolvedValue({ data: duplicatedRow('REUSE', 'DRAFT'), error: null });

    const result = await duplicateCampaign(INSTANCE_A, JOB_A, 'REUSE');

    if ('ok' in result) {
      expect(result.data.status).toBe('DRAFT');
      expect(result.data.mode).toBe('REUSE');
    }
    expect(auditSpy.mock.calls[0][0]).toMatchObject({ action: 'WHATSAPP_CAMPAIGN_REUSE' });
  });

  it('default de modo é DUPLICATE quando omitido', async () => {
    rpcSpy.mockResolvedValue({ data: duplicatedRow('DUPLICATE', 'DRAFT'), error: null });

    await duplicateCampaign(INSTANCE_A, JOB_A);

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_duplicate_campaign',
      expect.objectContaining({ p_mode: 'DUPLICATE' })
    );
  });

  it('origem inexistente/cruzada ⇒ Canonical_Message anti-enumeração (Req 20.6)', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND, code: 'P0001' },
    });

    await expect(duplicateCampaign(INSTANCE_A, NON_EXISTENT_JOB, 'DUPLICATE')).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
  });
});
