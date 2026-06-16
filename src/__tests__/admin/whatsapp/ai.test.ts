/**
 * Testes unitários da camada de serviço de configuração de IA por instância
 * (`src/services/admin/whatsapp/ai.ts`) — task 15.2.
 *
 * Mockam-se (hoisted, convenção do projeto) `supabase.rpc` (as RPCs reais são
 * `SECURITY DEFINER` no lado SQL) e `executeAdminMutation` (audit-by-construction,
 * admin-patterns §1). O mock de `executeAdminMutation` executa a `fn` interna
 * (para exercitar a chamada à RPC/Vault) e registra o `input` de auditoria —
 * permitindo asserir o `instance_id` e, sobretudo, que o valor da AI_Api_Key
 * NUNCA é gravado no log (`expectNoSecrets`).
 *
 * Cobertura:
 *  - Validação de IA (caminhos negativos, Canonical_Messages pt-BR):
 *    - AI_Api_Key vazia ⇒ `Informe uma chave de API válida.` (Req 14.2/14.3).
 *    - AI_Prompt vazio ⇒ `Informe um prompt válido.` (Req 26.3).
 *    - Knowledge_Base acima do limite ⇒ `O conteúdo excede o limite permitido.`
 *      SEM truncar e SEM persistir (Req 15.2, 15.3).
 *  - Isolamento de config entre instâncias: leitura/escrita são sempre
 *    parametrizadas por `instance_id`; uma instância nunca vê nem altera a
 *    config de outra (Req 26.5).
 *  - Versionamento otimista: divergência de `expected_updated_at` ⇒
 *    `STALE_VERSION` propagado (Req 15.4/26.6).
 *  - `expectNoSecrets`: o valor da chave nunca aparece em respostas, no
 *    indicador retornado, nem no input de auditoria — só o booleano
 *    `has_api_key` (Req 26.5; segurança de segredos).
 *
 * Validates: Requirements 14.2, 15.3, 26.3, 26.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waAiRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waAiAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  getAiConfig,
  saveAiConfig,
  setAiApiKey,
  aiApiKeyIsSet,
  type SaveAiConfigInput,
} from '../../../services/admin/whatsapp/ai';
import { KNOWLEDGE_BASE_MAX_LENGTH } from '../../../services/admin/whatsapp/validation';
import { expectNoSecrets } from '../../_helpers/logAssertions';

const rpcSpy = (globalThis as Record<string, unknown>).__waAiRpcSpy as ReturnType<typeof vi.fn>;
const auditSpy = (globalThis as Record<string, unknown>).__waAiAuditSpy as ReturnType<typeof vi.fn>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const INSTANCE_B = '22222222-2222-2222-2222-222222222222';

/**
 * Valor de segredo realista para a AI_Api_Key — casa com o padrão
 * `sb_secret_...` reconhecido por `expectNoSecrets`, de modo que qualquer
 * vazamento na superfície de resposta/audit seja efetivamente detectado.
 */
const AI_API_KEY = 'sb_secret_ai_supersecretvalue1234567890';

/** Linha crua (snake_case) como retornada pelas RPCs de config de IA. */
function aiConfigRow(
  overrides: Partial<{
    enabled: boolean;
    ai_prompt: string | null;
    knowledge_base: string | null;
    has_api_key: boolean;
    handoff_message: string | null;
    updated_at: string | null;
  }> = {}
) {
  return {
    enabled: overrides.enabled ?? false,
    ai_prompt: 'ai_prompt' in overrides ? (overrides.ai_prompt ?? null) : null,
    knowledge_base: 'knowledge_base' in overrides ? (overrides.knowledge_base ?? null) : null,
    has_api_key: overrides.has_api_key ?? false,
    handoff_message: 'handoff_message' in overrides ? (overrides.handoff_message ?? null) : null,
    updated_at:
      'updated_at' in overrides ? (overrides.updated_at ?? null) : '2026-01-01T00:00:00.000Z',
  };
}

/** Entrada válida de gravação (prompt/KB aceitos), para variar nos testes. */
function validSaveInput(overrides: Partial<SaveAiConfigInput> = {}): SaveAiConfigInput {
  return {
    enabled: true,
    aiPrompt: 'Você é um atendente cordial da FreteGO.',
    knowledgeBase: 'Horário de atendimento: 8h às 18h.',
    handoffMessage: 'Vou transferir você para um atendente humano.',
    expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

describe('validação de IA — caminhos negativos (Canonical_Messages pt-BR)', () => {
  it('AI_Api_Key vazia ⇒ "Informe uma chave de API válida." e não toca o Vault', async () => {
    await expect(setAiApiKey(INSTANCE_A, '')).rejects.toThrow('Informe uma chave de API válida.');
    await expect(setAiApiKey(INSTANCE_A, '   ')).rejects.toThrow(
      'Informe uma chave de API válida.'
    );

    // Rejeição é client-side, antes de qualquer I/O: nem RPC nem audit.
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('AI_Prompt vazio/só espaços ⇒ "Informe um prompt válido." e não persiste', async () => {
    await expect(saveAiConfig(INSTANCE_A, validSaveInput({ aiPrompt: '' }))).rejects.toThrow(
      'Informe um prompt válido.'
    );
    await expect(
      saveAiConfig(INSTANCE_A, validSaveInput({ aiPrompt: '   \n\t ' }))
    ).rejects.toThrow('Informe um prompt válido.');

    // Bloqueio antes do backend: nenhuma RPC de save é chamada.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('Knowledge_Base acima do limite ⇒ "O conteúdo excede o limite permitido." SEM truncar', async () => {
    const oversized = 'a'.repeat(KNOWLEDGE_BASE_MAX_LENGTH + 1);

    await expect(
      saveAiConfig(INSTANCE_A, validSaveInput({ knowledgeBase: oversized }))
    ).rejects.toThrow('O conteúdo excede o limite permitido.');

    // Sem truncamento silencioso: o save é rejeitado por inteiro, nada é
    // enviado ao backend (a KB original permanece intacta no cliente).
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(oversized.length).toBe(KNOWLEDGE_BASE_MAX_LENGTH + 1);
  });

  it('Knowledge_Base exatamente no limite é aceita (fronteira)', async () => {
    rpcSpy.mockResolvedValue({ data: aiConfigRow({ enabled: true }), error: null });
    const atLimit = 'a'.repeat(KNOWLEDGE_BASE_MAX_LENGTH);

    await expect(
      saveAiConfig(INSTANCE_A, validSaveInput({ knowledgeBase: atLimit }))
    ).resolves.toBeDefined();

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [, params] = rpcSpy.mock.calls[0];
    expect((params as { p_knowledge_base: string }).p_knowledge_base).toBe(atLimit);
    expect((params as { p_knowledge_base: string }).p_knowledge_base.length).toBe(
      KNOWLEDGE_BASE_MAX_LENGTH
    );
  });
});

describe('isolamento de config entre instâncias (Req 26.5)', () => {
  /**
   * Store em memória keyed por `instance_id`, mockando as RPCs de leitura/escrita
   * de config. Modela o isolamento server-side: cada instância só enxerga e
   * altera a própria linha (UNIQUE(instance_id)).
   */
  function installInstanceStore() {
    const store: Record<string, ReturnType<typeof aiConfigRow>> = {
      [INSTANCE_A]: aiConfigRow({
        enabled: true,
        ai_prompt: 'Persona da instância A.',
        knowledge_base: 'KB exclusiva da A.',
        has_api_key: true,
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
      [INSTANCE_B]: aiConfigRow({
        enabled: false,
        ai_prompt: 'Persona da instância B.',
        knowledge_base: 'KB exclusiva da B.',
        has_api_key: false,
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    };

    rpcSpy.mockImplementation(async (fn: string, params: Record<string, unknown>) => {
      const id = params.p_instance_id as string;
      if (fn === 'whatsapp_get_ai_config') {
        return { data: store[id], error: null };
      }
      if (fn === 'whatsapp_save_ai_config') {
        store[id] = aiConfigRow({
          enabled: params.p_enabled as boolean,
          ai_prompt: params.p_ai_prompt as string,
          knowledge_base: params.p_knowledge_base as string | null,
          has_api_key: store[id]?.has_api_key ?? false,
          handoff_message: params.p_handoff_message as string | null,
          updated_at: '2026-02-02T00:00:00.000Z',
        });
        return { data: store[id], error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    return store;
  }

  it('cada instância lê apenas a sua própria config', async () => {
    installInstanceStore();

    const a = await getAiConfig(INSTANCE_A);
    const b = await getAiConfig(INSTANCE_B);

    expect(a.aiPrompt).toBe('Persona da instância A.');
    expect(a.knowledgeBase).toBe('KB exclusiva da A.');
    expect(a.hasApiKey).toBe(true);

    expect(b.aiPrompt).toBe('Persona da instância B.');
    expect(b.knowledgeBase).toBe('KB exclusiva da B.');
    expect(b.hasApiKey).toBe(false);

    // Sem contaminação cruzada: configs são distintas.
    expect(a).not.toEqual(b);

    // Toda leitura é escopada ao instance_id correto.
    expect(rpcSpy).toHaveBeenNthCalledWith(1, 'whatsapp_get_ai_config', {
      p_instance_id: INSTANCE_A,
    });
    expect(rpcSpy).toHaveBeenNthCalledWith(2, 'whatsapp_get_ai_config', {
      p_instance_id: INSTANCE_B,
    });
  });

  it('gravar a config de uma instância não altera a config de outra', async () => {
    const store = installInstanceStore();

    await saveAiConfig(
      INSTANCE_A,
      validSaveInput({
        aiPrompt: 'Nova persona da A.',
        knowledgeBase: 'Nova KB da A.',
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    // A foi alterada...
    expect(store[INSTANCE_A].ai_prompt).toBe('Nova persona da A.');
    expect(store[INSTANCE_A].knowledge_base).toBe('Nova KB da A.');
    // ...e B permaneceu intacta (isolamento total).
    expect(store[INSTANCE_B].ai_prompt).toBe('Persona da instância B.');
    expect(store[INSTANCE_B].knowledge_base).toBe('KB exclusiva da B.');

    // A leitura subsequente de B não enxerga nada da A.
    const b = await getAiConfig(INSTANCE_B);
    expect(b.aiPrompt).toBe('Persona da instância B.');

    // A RPC de save foi escopada exclusivamente à instância A.
    const saveCall = rpcSpy.mock.calls.find(([fn]) => fn === 'whatsapp_save_ai_config');
    expect(saveCall?.[1]).toMatchObject({ p_instance_id: INSTANCE_A });
  });

  it('a escrita carrega o instance_id no audit (escopo por instância)', async () => {
    installInstanceStore();

    await saveAiConfig(INSTANCE_A, validSaveInput());

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_AI_CONFIG_SAVE',
      targetType: 'whatsapp_ai_configs',
      targetId: INSTANCE_A,
    });
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE_A);
  });
});

describe('versionamento otimista — STALE_VERSION (Req 15.4/26.6)', () => {
  it('saveAiConfig propaga STALE_VERSION quando expected_updated_at diverge', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'STALE_VERSION', code: 'P0001' },
    });

    await expect(
      saveAiConfig(INSTANCE_A, validSaveInput({ expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }))
    ).rejects.toThrow('STALE_VERSION');

    // A versão otimista é repassada ao backend para o check de concorrência.
    const [, params] = rpcSpy.mock.calls[0];
    expect((params as { p_expected_updated_at: string }).p_expected_updated_at).toBe(
      '2020-01-01T00:00:00.000Z'
    );
  });

  it('primeira gravação (sem linha materializada) envia expected_updated_at = null', async () => {
    rpcSpy.mockResolvedValue({
      data: aiConfigRow({ enabled: true, updated_at: '2026-02-02T00:00:00.000Z' }),
      error: null,
    });

    await saveAiConfig(INSTANCE_A, validSaveInput({ expectedUpdatedAt: null }));

    const [, params] = rpcSpy.mock.calls[0];
    expect((params as { p_expected_updated_at: string | null }).p_expected_updated_at).toBeNull();
  });
});

describe('não-vazamento da AI_Api_Key (expectNoSecrets — Req 26.5)', () => {
  it('setAiApiKey nunca expõe a chave na resposta nem no input de auditoria', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });

    const result = await setAiApiKey(INSTANCE_A, AI_API_KEY);

    // Retorno é void — nada de segredo na superfície.
    expect(result).toBeUndefined();
    expectNoSecrets(result);

    // O input de auditoria carrega apenas o indicador `has_api_key`, jamais a chave.
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_AI_API_KEY_SET',
      targetType: 'whatsapp_ai_configs',
      targetId: INSTANCE_A,
    });
    expect((input as { after: { has_api_key: boolean } }).after.has_api_key).toBe(true);
    expectNoSecrets(input);

    // A chave trafega para a RPC de Vault (esperado), mas não para o audit.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_set_instance_secret', {
      p_instance_id: INSTANCE_A,
      p_kind: 'AI',
      p_secret: AI_API_KEY,
    });
  });

  it('getAiConfig expõe somente o indicador has_api_key, nunca a chave', async () => {
    rpcSpy.mockResolvedValue({
      data: aiConfigRow({ enabled: true, has_api_key: true }),
      error: null,
    });

    const config = await getAiConfig(INSTANCE_A);

    expect(config.hasApiKey).toBe(true);
    expect(config).not.toHaveProperty('apiKey');
    expect(config).not.toHaveProperty('ai_api_key');
    expectNoSecrets(config);
  });

  it('aiApiKeyIsSet retorna apenas o booleano de presença, nunca a chave', async () => {
    rpcSpy.mockResolvedValue({ data: true, error: null });

    const isSet = await aiApiKeyIsSet(INSTANCE_A);

    expect(isSet).toBe(true);
    expectNoSecrets(isSet);
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_instance_secret_is_set', {
      p_instance_id: INSTANCE_A,
      p_kind: 'AI',
    });
  });

  it('saveAiConfig não grava prompt/KB como segredo e mantém o audit limpo', async () => {
    rpcSpy.mockResolvedValue({ data: aiConfigRow({ enabled: true }), error: null });

    await saveAiConfig(INSTANCE_A, validSaveInput());

    const [input] = auditSpy.mock.calls[0];
    expectNoSecrets(input);
  });
});
