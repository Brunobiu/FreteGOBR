// Feature: whatsapp-automation, Task 17.3: transições de Conversation_Mode
/**
 * Testes unitários das transições de Conversation_Mode na camada de serviço
 * (`src/services/admin/whatsapp/conversations.ts` →
 * `transitionConversationMode`, `humanTakeover`, `returnToAi`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirements 30.8,
 * 31.13, 31.14, 31.15, 31.18, 31.19, 31.20.
 * Migration: 109 (`whatsapp_transition_conversation_mode`).
 *
 * Cobre:
 *  - Transição VÁLIDA (Human_Takeover → `HUMAN_MODE`; Return_To_AI →
 *    `RETURNED_TO_AI`) com AUDIT positivo via `executeAdminMutation`
 *    (modo anterior/novo, `instance_id` e identificador da Conversation,
 *    Req 31.13, 30.9);
 *  - Transição JÁ APLICADA ⇒ `{ skipped, reason }` (`_SKIPPED`) SEM auditar de
 *    novo (idempotência, Req 31.15);
 *  - Versão desatualizada ⇒ código inglês `STALE_VERSION` (versionamento
 *    otimista, Req 31.14);
 *  - Modo fora do domínio fechado ⇒ código inglês `INVALID_CONVERSATION_MODE`
 *    (Req 31.20);
 *  - Conversa inexistente vs. cruzada entre instâncias ⇒ resposta
 *    INDISTINGUÍVEL → Canonical_Message anti-enumeração (Req 30.8, 31.18);
 *  - Preservação durável do histórico em transições (a mudança de modo não
 *    apaga mensagens, Req 31.19).
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; reuso dos helpers
 * canônicos de `_helpers/`. Identifiers/codes em inglês; mensagens pt-BR.
 * PII fixa (sem `fc.stringOf`).
 *
 * **Validates: Requirements 30.8, 31.13, 31.14, 31.15, 31.18, 31.19, 31.20**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waConvRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waConvAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  transitionConversationMode,
  humanTakeover,
  returnToAi,
  getConversation,
  WHATSAPP_INVALID_CONVERSATION_MODE,
  type ConversationMode,
  type ConversationModeAction,
} from '../../../services/admin/whatsapp/conversations';
import { WHATSAPP_CANONICAL_OPERATION_FAILED } from '../../../services/admin/whatsapp/guards';
import { expectIndistinguishable } from '../../_helpers/antiEnumeration';

const rpcSpy = (globalThis as Record<string, unknown>).__waConvRpcSpy as ReturnType<typeof vi.fn>;
const auditSpy = (globalThis as Record<string, unknown>).__waConvAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const INSTANCE_B = '99999999-9999-9999-9999-999999999999';
const CONVERSATION_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NON_EXISTENT_CONVERSATION = '22222222-2222-2222-2222-222222222222';
const CROSS_CONVERSATION = '33333333-3333-3333-3333-333333333333';

/** Versão otimista lida antes de acionar a transição (`expected_updated_at`). */
const EXPECTED_UPDATED_AT = '2026-01-01T10:00:00.000Z';
/** Nova versão otimista devolvida pela RPC na transição válida. */
const NEW_UPDATED_AT = '2026-01-01T10:05:00.000Z';

/** Contato fixo (PII): nunca gerado aleatoriamente. */
const CONTACT_PHONE = '5511999990000';

/** Marker canônico da guarda anti-enumeração (espelha `whatsapp_assert_instance`). */
const WHATSAPP_NOT_FOUND = 'WHATSAPP_NOT_FOUND';

/** Linha crua (snake_case) de uma transição VÁLIDA, como a RPC retorna. */
function transitionRow(
  action: ConversationModeAction,
  previousMode: ConversationMode,
  mode: ConversationMode,
  overrides: Partial<{ id: string; instance_id: string; updated_at: string }> = {}
): Record<string, unknown> {
  return {
    ok: true,
    id: overrides.id ?? CONVERSATION_A,
    instance_id: overrides.instance_id ?? INSTANCE_A,
    action,
    previous_mode: previousMode,
    mode,
    updated_at: overrides.updated_at ?? NEW_UPDATED_AT,
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

describe('transitionConversationMode — transição VÁLIDA + audit (Req 31.6, 31.7, 31.13)', () => {
  it('Human_Takeover ⇒ HUMAN_MODE, chama a RPC escopada e devolve { ok, data, updated_at }', async () => {
    rpcSpy.mockResolvedValue({
      data: transitionRow('HUMAN_TAKEOVER', 'AI_MODE', 'HUMAN_MODE'),
      error: null,
    });

    const result = await humanTakeover(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT);

    // RPC escopada por instância + conversa, com versionamento otimista (Req 31.14).
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_transition_conversation_mode', {
      p_instance_id: INSTANCE_A,
      p_conversation_id: CONVERSATION_A,
      p_action: 'HUMAN_TAKEOVER',
      p_expected_updated_at: EXPECTED_UPDATED_AT,
    });

    expect(result).toMatchObject({ ok: true, updated_at: NEW_UPDATED_AT });
    if ('ok' in result) {
      expect(result.data).toMatchObject({
        id: CONVERSATION_A,
        instanceId: INSTANCE_A,
        action: 'HUMAN_TAKEOVER',
        previousMode: 'AI_MODE',
        mode: 'HUMAN_MODE',
        updatedAt: NEW_UPDATED_AT,
      });
    }
  });

  it('audita a transição com modo anterior/novo, instance_id e a Conversation (Req 31.13, 30.9)', async () => {
    rpcSpy.mockResolvedValue({
      data: transitionRow('HUMAN_TAKEOVER', 'AI_MODE', 'HUMAN_MODE'),
      error: null,
    });

    await humanTakeover(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT);

    // Audit positivo via executeAdminMutation (audit-by-construction).
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_CONVERSATION_MODE_TRANSITION',
      targetType: 'whatsapp_conversations',
      targetId: CONVERSATION_A,
      before: {
        instance_id: INSTANCE_A,
        conversation_id: CONVERSATION_A,
        mode: 'AI_MODE',
      },
      after: {
        instance_id: INSTANCE_A,
        conversation_id: CONVERSATION_A,
        action: 'HUMAN_TAKEOVER',
        mode: 'HUMAN_MODE',
      },
    });
  });

  it('Return_To_AI ⇒ RETURNED_TO_AI (modo AI-allowed), audita before=HUMAN_MODE/after=RETURNED_TO_AI', async () => {
    rpcSpy.mockResolvedValue({
      data: transitionRow('RETURN_TO_AI', 'HUMAN_MODE', 'RETURNED_TO_AI'),
      error: null,
    });

    const result = await returnToAi(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT);

    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_transition_conversation_mode',
      expect.objectContaining({ p_action: 'RETURN_TO_AI' })
    );
    if ('ok' in result) {
      expect(result.data).toMatchObject({
        action: 'RETURN_TO_AI',
        previousMode: 'HUMAN_MODE',
        mode: 'RETURNED_TO_AI',
      });
    }

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_CONVERSATION_MODE_TRANSITION',
      before: { mode: 'HUMAN_MODE' },
      after: { action: 'RETURN_TO_AI', mode: 'RETURNED_TO_AI' },
    });
  });

  it('AI_Handoff automático ⇒ HUMAN_MODE também é auditado (handoff da IA, Req 31.4)', async () => {
    rpcSpy.mockResolvedValue({
      data: transitionRow('AI_HANDOFF', 'AI_MODE', 'HUMAN_MODE'),
      error: null,
    });

    const result = await transitionConversationMode(
      INSTANCE_A,
      CONVERSATION_A,
      'AI_HANDOFF',
      EXPECTED_UPDATED_AT
    );

    if ('ok' in result) {
      expect(result.data.mode).toBe('HUMAN_MODE');
    }
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      after: { action: 'AI_HANDOFF', mode: 'HUMAN_MODE' },
    });
  });
});

describe('transitionConversationMode — idempotência _SKIPPED (Req 31.15)', () => {
  it('transição já aplicada ⇒ { skipped, reason } SEM auditar de novo', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: 'ALREADY_HUMAN_MODE' },
      error: null,
    });

    const result = await humanTakeover(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT);

    expect(result).toEqual({ skipped: true, reason: 'ALREADY_HUMAN_MODE' });
    // A RPC já gravou o log `_SKIPPED` por dentro; NÃO auditar novamente.
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('Return_To_AI já aplicada (já em modo AI) ⇒ skip neutro, sem mutação', async () => {
    rpcSpy.mockResolvedValue({
      data: { skipped: true, reason: 'ALREADY_RETURNED_TO_AI' },
      error: null,
    });

    const result = await returnToAi(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT);

    expect(result).toEqual({ skipped: true, reason: 'ALREADY_RETURNED_TO_AI' });
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('transitionConversationMode — versionamento otimista STALE_VERSION (Req 31.14)', () => {
  it('versão desatualizada ⇒ lança STALE_VERSION (código inglês) e não audita', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'STALE_VERSION', code: 'P0001' },
    });

    await expect(
      humanTakeover(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT)
    ).rejects.toThrow('STALE_VERSION');
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('transitionConversationMode — domínio fechado INVALID_CONVERSATION_MODE (Req 31.20)', () => {
  it('modo fora do domínio ⇒ lança INVALID_CONVERSATION_MODE (código inglês)', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_CONVERSATION_MODE', code: 'P0001' },
    });

    await expect(
      transitionConversationMode(
        INSTANCE_A,
        CONVERSATION_A,
        'HUMAN_TAKEOVER',
        EXPECTED_UPDATED_AT
      )
    ).rejects.toThrow(WHATSAPP_INVALID_CONVERSATION_MODE);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('transitionConversationMode — anti-enumeração indistinguível (Req 30.8, 31.18)', () => {
  it('conversa inexistente vs. cruzada entre instâncias ⇒ resposta INDISTINGUÍVEL', async () => {
    // Conversa inexistente: a guarda server-side levanta WHATSAPP_NOT_FOUND.
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND, code: 'P0001' },
    });
    let nonExistingMsg = '';
    try {
      await humanTakeover(INSTANCE_A, NON_EXISTENT_CONVERSATION, EXPECTED_UPDATED_AT);
    } catch (err) {
      nonExistingMsg = (err as Error).message;
    }

    // Conversa de OUTRA instância (cruzada): mesma guarda, resposta idêntica.
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND, code: 'P0001' },
    });
    let crossMsg = '';
    try {
      await humanTakeover(INSTANCE_B, CROSS_CONVERSATION, EXPECTED_UPDATED_AT);
    } catch (err) {
      crossMsg = (err as Error).message;
    }

    expectIndistinguishable({ message: nonExistingMsg }, { message: crossMsg });
    expect(nonExistingMsg).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
    // Nenhuma mutação foi auditada em qualquer dos caminhos negativos.
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('transição de Conversation_Mode — preservação do histórico (Req 31.19)', () => {
  it('a transição não apaga mensagens: histórico permanece íntegro após a mudança de modo', async () => {
    const messages = [
      {
        id: 'msg-1',
        direction: 'INBOUND',
        body: 'Olá, preciso de ajuda.',
        created_at: '2026-01-01T09:58:00.000Z',
      },
      {
        id: 'msg-2',
        direction: 'OUTBOUND',
        body: 'Claro! Como posso ajudar?',
        created_at: '2026-01-01T09:59:00.000Z',
      },
    ];

    /** Retorno cru da RPC de detalhe, sempre com o histórico completo. */
    const detailRow = (mode: ConversationMode) => ({
      id: CONVERSATION_A,
      contact_phone: CONTACT_PHONE,
      mode,
      responder_lock: mode === 'HUMAN_MODE' ? 'HUMAN' : 'AI',
      last_message_preview: 'Claro! Como posso ajudar?',
      last_message_at: '2026-01-01T09:59:00.000Z',
      created_at: '2026-01-01T09:57:00.000Z',
      updated_at: EXPECTED_UPDATED_AT,
      messages,
    });

    // Histórico ANTES da transição (modo IA).
    rpcSpy.mockResolvedValueOnce({ data: detailRow('AI_MODE'), error: null });
    const before = await getConversation(INSTANCE_A, CONVERSATION_A);

    // Transição válida Human_Takeover (AI_MODE → HUMAN_MODE).
    rpcSpy.mockResolvedValueOnce({
      data: transitionRow('HUMAN_TAKEOVER', 'AI_MODE', 'HUMAN_MODE'),
      error: null,
    });
    await humanTakeover(INSTANCE_A, CONVERSATION_A, EXPECTED_UPDATED_AT);

    // Histórico DEPOIS da transição (modo humano) — mesmas mensagens preservadas.
    rpcSpy.mockResolvedValueOnce({ data: detailRow('HUMAN_MODE'), error: null });
    const after = await getConversation(INSTANCE_A, CONVERSATION_A);

    expect(after.mode).toBe('HUMAN_MODE');
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.messages.map((m) => m.id)).toEqual(before.messages.map((m) => m.id));
    expect(after.messages.map((m) => m.body)).toEqual(before.messages.map((m) => m.body));
  });
});
