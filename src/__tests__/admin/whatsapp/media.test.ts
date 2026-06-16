// Feature: whatsapp-automation, Task 9.3: INVALID_FILE_TYPE + Content inválido
/**
 * Testes unitários do upload de Content_Media (`src/services/admin/whatsapp/media.ts`).
 *
 * Spec: .kiro/specs/whatsapp-automation/requirements.md → Requirements 6.3, 6.5.
 * Design: design.md → "Storage" (MIME validado, `INVALID_FILE_TYPE`) e §Content.
 *
 * Cobre (task 9.3):
 *  - MIME não suportado ⇒ erro `INVALID_FILE_TYPE` (Canonical_Message pt-BR),
 *    sem deixar órfão no bucket;
 *  - QUALQUER combinação de texto/imagem/vídeo/áudio/documento é aceita — cada
 *    media_type suportado sobe e é associado quando o upload CONCLUI (Req 6.2);
 *  - Regra de governança de uploads do projeto:
 *      • a rejeição/validação acontece no caminho em que o upload CONCLUI;
 *      • uma falha ANTES da conclusão (rede/limite/timeout) NÃO exige validação
 *        extra — ela apenas se propaga e nunca é reclassificada como
 *        `INVALID_FILE_TYPE`;
 *      • a rejeição server-side (RPC) ocorre SOMENTE após o upload concluído e,
 *        nesse caso, o objeto recém-enviado é removido (rollback best-effort).
 *
 * Convenções: `vi.mock` hoisted, spies expostos via `globalThis`; reuso dos
 * helpers/validadores canônicos (não reimplementa MIME nem validação).
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 *
 * **Validates: Requirements 6.3, 6.5**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc + storage (upload/remove) via globalThis ---
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  const uploadSpy = vi.fn();
  const removeSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waMediaRpcSpy = rpcSpy;
  (globalThis as Record<string, unknown>).__waMediaUploadSpy = uploadSpy;
  (globalThis as Record<string, unknown>).__waMediaRemoveSpy = removeSpy;
  return {
    supabase: {
      rpc: (...args: unknown[]) => rpcSpy(...args),
      storage: {
        from: (_bucket: string) => ({
          upload: (...args: unknown[]) => uploadSpy(...args),
          remove: (...args: unknown[]) => removeSpy(...args),
        }),
      },
    },
  };
});

// ----- Mock hoisted do audit: executa a fn e registra o input de auditoria ----
vi.mock('../../../services/admin/audit', () => {
  const executeAdminMutationSpy = vi.fn(async (_input: unknown, fn: () => Promise<unknown>) =>
    fn()
  );
  (globalThis as Record<string, unknown>).__waMediaAuditSpy = executeAdminMutationSpy;
  return {
    executeAdminMutation: (input: unknown, fn: () => Promise<unknown>) =>
      executeAdminMutationSpy(input, fn),
  };
});

import {
  uploadContentMedia,
  removeContentMedia,
  mediaTypeForMime,
  MediaValidationError,
  type WhatsAppMediaType,
} from '../../../services/admin/whatsapp/media';
import { SUPPORTED_MIME_TYPES } from '../../../services/admin/whatsapp/validation';
import { WHATSAPP_CANONICAL_OPERATION_FAILED } from '../../../services/admin/whatsapp/guards';
import { expectNoSecrets } from '../../_helpers/logAssertions';

const rpcSpy = (globalThis as Record<string, unknown>).__waMediaRpcSpy as ReturnType<typeof vi.fn>;
const uploadSpy = (globalThis as Record<string, unknown>).__waMediaUploadSpy as ReturnType<
  typeof vi.fn
>;
const removeSpy = (globalThis as Record<string, unknown>).__waMediaRemoveSpy as ReturnType<
  typeof vi.fn
>;
const auditSpy = (globalThis as Record<string, unknown>).__waMediaAuditSpy as ReturnType<
  typeof vi.fn
>;

const INSTANCE_A = '11111111-1111-1111-1111-111111111111';
const CONTENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Cria um `File` (jsdom) com o MIME declarado informado. */
function makeFile(name: string, mime: string): File {
  return new File(['conteudo-binario-de-teste'], name, { type: mime });
}

/** Linha crua (snake_case) como retornada por `whatsapp_add_content_media`. */
function mediaRow(
  mediaType: WhatsAppMediaType,
  mime: string,
  storagePath: string
): Record<string, unknown> {
  return {
    id: 'media-1',
    instance_id: INSTANCE_A,
    content_id: CONTENT_A,
    media_type: mediaType,
    storage_path: storagePath,
    mime_type: mime,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  rpcSpy.mockReset();
  uploadSpy.mockReset();
  removeSpy.mockReset();
  auditSpy.mockClear();
  // Defaults seguros: upload conclui e remove resolve (rollback best-effort).
  uploadSpy.mockResolvedValue({ error: null });
  removeSpy.mockResolvedValue({ error: null });
});

describe('mediaTypeForMime — derivação do media_type a partir do MIME', () => {
  it('mapeia cada MIME suportado ao seu media_type', () => {
    expect(mediaTypeForMime('image/png')).toBe('IMAGE');
    expect(mediaTypeForMime('video/mp4')).toBe('VIDEO');
    expect(mediaTypeForMime('audio/mpeg')).toBe('AUDIO');
    expect(mediaTypeForMime('application/pdf')).toBe('DOCUMENT');
  });

  it('ignora caixa e parâmetros pós-";"', () => {
    expect(mediaTypeForMime('IMAGE/PNG')).toBe('IMAGE');
    expect(mediaTypeForMime('text/plain; charset=utf-8')).toBe('DOCUMENT');
  });

  it('retorna null para MIME não suportado, vazio ou não-string', () => {
    expect(mediaTypeForMime('application/x-msdownload')).toBeNull();
    expect(mediaTypeForMime('')).toBeNull();
    expect(mediaTypeForMime(undefined)).toBeNull();
    expect(mediaTypeForMime(123)).toBeNull();
  });
});

describe('uploadContentMedia — MIME não suportado ⇒ INVALID_FILE_TYPE (Req 6.3)', () => {
  it('rejeita MIME não suportado com code INVALID_FILE_TYPE e mensagem pt-BR', async () => {
    const file = makeFile('instalador.exe', 'application/x-msdownload');

    await expect(uploadContentMedia(INSTANCE_A, CONTENT_A, file)).rejects.toMatchObject({
      name: 'MediaValidationError',
      code: 'INVALID_FILE_TYPE',
      message: 'Tipo de arquivo não suportado.',
    });

    // É um MediaValidationError tipado (uso programático do Error_Code).
    await expect(uploadContentMedia(INSTANCE_A, CONTENT_A, file)).rejects.toBeInstanceOf(
      MediaValidationError
    );

    // Não há órfão: o arquivo inválido nem sobe, nada é registrado/auditado.
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('rejeita MIME ausente/vazio com INVALID_FILE_TYPE', async () => {
    const file = makeFile('misterio', '');

    await expect(uploadContentMedia(INSTANCE_A, CONTENT_A, file)).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE',
      message: 'Tipo de arquivo não suportado.',
    });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['executável', 'application/x-msdownload'],
    ['página HTML', 'text/html'],
    ['arquivo ZIP', 'application/zip'],
    ['script', 'application/javascript'],
    ['SVG (não suportado)', 'image/svg+xml'],
  ])('rejeita %s (%s) com INVALID_FILE_TYPE', async (_label, mime) => {
    const file = makeFile('arquivo', mime);
    await expect(uploadContentMedia(INSTANCE_A, CONTENT_A, file)).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE',
    });
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe('uploadContentMedia — combinações aceitas quando o upload CONCLUI (Req 6.2)', () => {
  /** Um MIME representativo de cada media_type suportado. */
  const REPRESENTATIVES: Array<[WhatsAppMediaType, string]> = [
    ['IMAGE', 'image/png'],
    ['VIDEO', 'video/mp4'],
    ['AUDIO', 'audio/mpeg'],
    ['DOCUMENT', 'application/pdf'],
  ];

  it.each(REPRESENTATIVES)(
    'aceita media_type %s (%s): upload conclui, RPC associa e retorna a mídia',
    async (mediaType, mime) => {
      uploadSpy.mockResolvedValue({ error: null });
      rpcSpy.mockImplementation(async (_fn: string, params: Record<string, unknown>) => ({
        data: mediaRow(mediaType, mime, params.p_storage_path as string),
        error: null,
      }));

      const file = makeFile(`arquivo.${mediaType.toLowerCase()}`, mime);
      const media = await uploadContentMedia(INSTANCE_A, CONTENT_A, file);

      // Upload concluiu antes da associação.
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(media.mediaType).toBe(mediaType);
      expect(media.mimeType).toBe(mime);
      expect(media.instanceId).toBe(INSTANCE_A);
      expect(media.contentId).toBe(CONTENT_A);

      // RPC chamada com o media_type derivado e path isolado por instância.
      expect(rpcSpy).toHaveBeenCalledWith(
        'whatsapp_add_content_media',
        expect.objectContaining({
          p_instance_id: INSTANCE_A,
          p_content_id: CONTENT_A,
          p_media_type: mediaType,
          p_mime_type: mime,
        })
      );
      const [, params] = rpcSpy.mock.calls[0];
      expect((params as { p_storage_path: string }).p_storage_path).toMatch(
        new RegExp(`^${INSTANCE_A}/${CONTENT_A}/`)
      );

      // Sem rollback no caminho de sucesso.
      expect(removeSpy).not.toHaveBeenCalled();
    }
  );

  it('cada MIME declarado em SUPPORTED_MIME_TYPES é aceito e sobe', async () => {
    for (const group of Object.keys(SUPPORTED_MIME_TYPES) as WhatsAppMediaType[]) {
      for (const mime of SUPPORTED_MIME_TYPES[group]) {
        uploadSpy.mockResolvedValue({ error: null });
        rpcSpy.mockImplementation(async (_fn: string, params: Record<string, unknown>) => ({
          data: mediaRow(group, mime, params.p_storage_path as string),
          error: null,
        }));

        const file = makeFile('arquivo', mime);
        const media = await uploadContentMedia(INSTANCE_A, CONTENT_A, file);
        expect(media.mediaType).toBe(group);
      }
    }
  });

  it('o audit carrega o instance_id e NUNCA o conteúdo binário do arquivo', async () => {
    rpcSpy.mockImplementation(async (_fn: string, params: Record<string, unknown>) => ({
      data: mediaRow('IMAGE', 'image/png', params.p_storage_path as string),
      error: null,
    }));

    await uploadContentMedia(INSTANCE_A, CONTENT_A, makeFile('foto.png', 'image/png'));

    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_MEDIA_ADD',
      targetType: 'whatsapp_content_media',
      targetId: CONTENT_A,
    });
    const after = (input as { after: Record<string, unknown> }).after;
    expect(after).toMatchObject({
      instance_id: INSTANCE_A,
      content_id: CONTENT_A,
      media_type: 'IMAGE',
      mime_type: 'image/png',
    });
    // Apenas metadados: nada de binário/arquivo no log.
    expect(after).not.toHaveProperty('file');
    expect(after).not.toHaveProperty('data');
    expect(after).not.toHaveProperty('bytes');
    expectNoSecrets(input);
  });
});

describe('regra do projeto: falha ANTES da conclusão não exige validação extra', () => {
  it.each([
    ['rede', { message: 'network error' }],
    ['limite', { message: 'The object exceeded the maximum allowed size' }],
    ['timeout', { message: 'request timeout' }],
  ])(
    'MIME suportado, mas o upload falha por %s ⇒ propaga o erro, sem INVALID_FILE_TYPE',
    async (_label, uploadError) => {
      uploadSpy.mockResolvedValue({ error: uploadError });

      const file = makeFile('foto.png', 'image/png'); // MIME válido

      const err = await uploadContentMedia(INSTANCE_A, CONTENT_A, file).catch((e) => e);

      // O upload foi tentado, mas não concluiu.
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      // O erro propagado é o da falha de transporte, NÃO uma reclassificação
      // como INVALID_FILE_TYPE (a validação extra não é exigida aqui).
      expect((err as Error).message).toBe(uploadError.message);
      expect(err).not.toBeInstanceOf(MediaValidationError);

      // Nada a associar e nada a limpar (não houve objeto concluído).
      expect(rpcSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    }
  );
});

describe('regra do projeto: rejeição server-side ocorre SOMENTE após upload concluído', () => {
  it('upload conclui, a RPC rejeita ⇒ objeto órfão é removido (rollback)', async () => {
    uploadSpy.mockResolvedValue({ error: null }); // upload CONCLUI
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'rejeição do servidor após o upload', code: 'P0001' },
    });

    const file = makeFile('foto.png', 'image/png');
    const err = await uploadContentMedia(INSTANCE_A, CONTENT_A, file).catch((e) => e);

    // O upload concluiu antes da rejeição (a validação server-side veio depois).
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledTimes(1);

    // Rollback best-effort: o objeto recém-enviado é removido para não deixar órfão.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    const [removedPaths] = removeSpy.mock.calls[0];
    expect((removedPaths as string[])[0]).toMatch(new RegExp(`^${INSTANCE_A}/${CONTENT_A}/`));

    // Erro propagado é o do servidor, não INVALID_FILE_TYPE.
    expect(err).not.toBeInstanceOf(MediaValidationError);
  });

  it('rejeição cruzada/instância inexistente ⇒ Canonical_Message anti-enumeração + rollback', async () => {
    uploadSpy.mockResolvedValue({ error: null });
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'WHATSAPP_NOT_FOUND', code: 'P0001' },
    });

    const file = makeFile('foto.png', 'image/png');
    await expect(uploadContentMedia(INSTANCE_A, CONTENT_A, file)).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('removeContentMedia — remoção do registro e do objeto', () => {
  it('remove a mídia, apaga o objeto do bucket e retorna o restante', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        id: 'media-1',
        content_id: CONTENT_A,
        storage_path: `${INSTANCE_A}/${CONTENT_A}/foto.png`,
        remaining: 0,
      },
      error: null,
    });

    const result = await removeContentMedia(INSTANCE_A, 'media-1');

    expect(result).toEqual({ id: 'media-1', contentId: CONTENT_A, remaining: 0 });
    expect(removeSpy).toHaveBeenCalledWith([`${INSTANCE_A}/${CONTENT_A}/foto.png`]);
    const [input] = auditSpy.mock.calls[0];
    expect(input).toMatchObject({
      action: 'WHATSAPP_MEDIA_REMOVE',
      targetType: 'whatsapp_content_media',
      targetId: 'media-1',
    });
  });
});
