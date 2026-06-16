// Feature: whatsapp-automation, Task 9.3: INVALID_FILE_TYPE + Content inválido
/**
 * Testes unitários da camada de serviço de Contents
 * (`src/services/admin/whatsapp/contents.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirement 6.5.
 * Design: design.md → §Content (`is_valid` = texto OU ≥1 mídia).
 *
 * Cobre (task 9.3 — parte "Content inválido"):
 *  - Content SEM texto E SEM mídia ⇒ inválido (`EMPTY_CONTENT`), BLOQUEADO antes
 *    de persistir em `createContent`/`updateContent` (Canonical_Message pt-BR);
 *    como o serviço recusa a persistência, esse Content nunca se torna
 *    disponível para um disparo;
 *  - qualquer combinação válida (só texto / só mídia / texto+mídia) é aceita;
 *  - quando um Content fica inválido server-side (`is_valid=false`, p.ex. mídia
 *    removida), `listContents` o reflete e ele é excluído do conjunto utilizável
 *    em disparo (apenas `isValid===true` é elegível) — Req 6.5.
 *
 * Convenções: `vi.mock` hoisted, spies via `globalThis`; reuso de `validateContent`
 * (não reimplementa a regra). Identifiers/codes em inglês; mensagens pt-BR.
 *
 * **Validates: Requirements 6.3, 6.5**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waContentsRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waContentsAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  createContent,
  updateContent,
  listContents,
  type WhatsAppContent,
} from '../../../services/admin/whatsapp/contents';

const rpcSpy = (globalThis as Record<string, unknown>).__waContentsRpcSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waContentsAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const JOB_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const EMPTY_CONTENT_MESSAGE = 'Informe um texto ou anexe ao menos uma mídia.';

/** Linha crua (snake_case) como retornada pelas RPCs de Content. */
function contentRow(
  overrides: Partial<{
    id: string;
    body: string | null;
    position: number;
    media_count: number;
    is_valid: boolean;
  }> = {}
): Record<string, unknown> {
  return {
    id: overrides.id ?? 'content-1',
    instance_id: INSTANCE_A,
    dispatch_job_id: JOB_A,
    body: 'body' in overrides ? (overrides.body ?? null) : 'Olá {{nome}}',
    position: overrides.position ?? 0,
    media_count: overrides.media_count ?? 0,
    is_valid: overrides.is_valid ?? true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  auditSpy.mockClear();
});

describe('createContent — Content sem texto E sem mídia é BLOQUEADO (Req 6.5)', () => {
  it.each([
    ['body undefined + mediaCount 0', { position: 0 }],
    ['body vazio + mediaCount 0', { body: '', position: 0, mediaCount: 0 }],
    ['body só espaços + mediaCount 0', { body: '   \n\t ', position: 0, mediaCount: 0 }],
  ])('%s ⇒ rejeita com Canonical_Message e não persiste', async (_label, input) => {
    await expect(createContent(INSTANCE_A, input)).rejects.toThrow(EMPTY_CONTENT_MESSAGE);

    // Bloqueio client-side, antes do backend: nada é persistido nem auditado,
    // portanto o Content nunca se torna disponível para um disparo.
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('updateContent — tornar um Content inválido (sem texto e sem mídia) é BLOQUEADO', () => {
  it('limpar o texto sem mídia ⇒ rejeita e não chama a RPC', async () => {
    await expect(
      updateContent(INSTANCE_A, 'content-1', {
        body: '',
        position: 0,
        mediaCount: 0,
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      })
    ).rejects.toThrow(EMPTY_CONTENT_MESSAGE);

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('createContent — combinações válidas são aceitas (Req 6.5)', () => {
  it('só texto ⇒ persiste', async () => {
    rpcSpy.mockResolvedValue({ data: contentRow({ body: 'Olá', media_count: 0 }), error: null });

    const content = await createContent(INSTANCE_A, {
      body: 'Olá',
      position: 0,
      dispatchJobId: JOB_A,
      mediaCount: 0,
    });

    expect(content.isValid).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith(
      'whatsapp_upsert_content',
      expect.objectContaining({ p_instance_id: INSTANCE_A, p_body: 'Olá' })
    );
  });

  it('só mídia (sem texto) ⇒ persiste', async () => {
    rpcSpy.mockResolvedValue({
      data: contentRow({ body: null, media_count: 1 }),
      error: null,
    });

    const content = await createContent(INSTANCE_A, {
      body: null,
      position: 1,
      dispatchJobId: JOB_A,
      mediaCount: 1,
    });

    expect(content.isValid).toBe(true);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });

  it('texto + mídia ⇒ persiste', async () => {
    rpcSpy.mockResolvedValue({
      data: contentRow({ body: 'Confira', media_count: 2 }),
      error: null,
    });

    const content = await createContent(INSTANCE_A, {
      body: 'Confira',
      position: 2,
      dispatchJobId: JOB_A,
      mediaCount: 2,
    });

    expect(content.isValid).toBe(true);
  });

  it('a escrita carrega o instance_id no audit (escopo por instância)', async () => {
    rpcSpy.mockResolvedValue({ data: contentRow({ body: 'Olá' }), error: null });

    await createContent(INSTANCE_A, { body: 'Olá', position: 0, dispatchJobId: JOB_A });

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_CONTENT_CREATE',
      targetType: 'whatsapp_contents',
    });
    expect((input as { after: { instance_id: string } }).after.instance_id).toBe(INSTANCE_A);
  });
});

describe('Content inválido (is_valid=false) é excluído do conjunto utilizável em disparo', () => {
  it('listContents reflete is_valid e só os válidos são elegíveis ao disparo', async () => {
    // Cenário: um Content válido (texto) e outro que ficou inválido server-side
    // (ex.: mídia removida) — sem texto e sem mídia ⇒ is_valid=false.
    rpcSpy.mockResolvedValue({
      data: [
        contentRow({ id: 'valido', body: 'Olá {{nome}}', media_count: 0, is_valid: true }),
        contentRow({ id: 'invalido', body: null, media_count: 0, is_valid: false, position: 1 }),
      ],
      error: null,
    });

    const contents = await listContents(INSTANCE_A, JOB_A);

    // O serviço reflete fielmente a validade recalculada no backend.
    const invalido = contents.find((c) => c.id === 'invalido') as WhatsAppContent;
    expect(invalido.isValid).toBe(false);

    // Gate do disparo: apenas Contents válidos são utilizáveis (Req 6.5).
    const usableForDispatch = contents.filter((c) => c.isValid);
    expect(usableForDispatch.map((c) => c.id)).toEqual(['valido']);
    expect(usableForDispatch.some((c) => c.id === 'invalido')).toBe(false);

    // Leitura é escopada por instância e disparo.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_list_contents', {
      p_instance_id: INSTANCE_A,
      p_dispatch_job_id: JOB_A,
    });
  });
});
