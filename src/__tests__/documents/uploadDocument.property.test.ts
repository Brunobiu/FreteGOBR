/**
 * Teste de regressão (simulação de salvar) — uploadDocument salva no lugar
 * certo e sincroniza a foto de perfil.
 *
 * CONTEXTO / BUG HISTÓRICO:
 * O upload de foto de perfil (motorista E embarcador) já quebrou várias vezes:
 * arquivo ia para o storage mas a coluna `users.profile_photo_url` não era
 * atualizada, então a foto "não salvava" do ponto de vista do usuário.
 *
 * Este teste simula o salvar de uma foto/documento e verifica:
 *  1. O arquivo vai para o bucket `documents` no path `<userId>/<tipo>_<ts>.<ext>`
 *     (o primeiro segmento DEVE ser o userId — é o que a RLS do storage exige).
 *  2. O registro é inserido em `documents` com user_id correto.
 *  3. Quando o tipo é `profile_photo`, `users.profile_photo_url` é atualizado
 *     (defesa em profundidade, caso o trigger SQL não esteja ativo).
 *  4. Tipo de documento inválido é rejeitado antes de qualquer rede.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mock hoisted do supabase: captura uploads, inserts e updates -----
vi.mock('../../services/supabase', () => {
  const storageUploadSpy = vi.fn();
  const usersUpdateSpy = vi.fn();
  const documentsInsertSpy = vi.fn();
  const g = globalThis as Record<string, unknown>;
  g.__udStorageUploadSpy = storageUploadSpy;
  g.__udUsersUpdateSpy = usersUpdateSpy;
  g.__udDocumentsInsertSpy = documentsInsertSpy;

  return {
    supabase: {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string, _file: unknown) => {
            storageUploadSpy(path);
            return { data: { path }, error: null };
          }),
          remove: vi.fn(async () => ({ error: null })),
        })),
      },
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        builder.insert = vi.fn((row: Record<string, unknown>) => {
          if (table === 'documents') documentsInsertSpy(row);
          return builder;
        });
        builder.select = vi.fn(() => builder);
        builder.single = vi.fn(async () => {
          const lastInsert = documentsInsertSpy.mock.calls[
            documentsInsertSpy.mock.calls.length - 1
          ]?.[0] as { user_id?: string; document_type?: string } | undefined;
          return {
            data: {
              id: 'doc-1',
              user_id: lastInsert?.user_id,
              document_type: lastInsert?.document_type,
              file_name: 'foto.jpg',
              file_path: 'path',
              file_size: 1234,
              mime_type: 'image/jpeg',
              created_at: '2026-01-01T00:00:00Z',
            },
            error: null,
          };
        });
        builder.update = vi.fn((payload: Record<string, unknown>) => {
          if (table === 'users') usersUpdateSpy(payload);
          return builder;
        });
        builder.eq = vi.fn().mockResolvedValue({ error: null });
        return builder;
      }),
    },
  };
});

import { uploadDocument } from '../../services/documents';

function makeFile(name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

const g = globalThis as Record<string, unknown>;
const storageUploadSpy = () => g.__udStorageUploadSpy as ReturnType<typeof vi.fn>;
const usersUpdateSpy = () => g.__udUsersUpdateSpy as ReturnType<typeof vi.fn>;
const documentsInsertSpy = () => g.__udDocumentsInsertSpy as ReturnType<typeof vi.fn>;

describe('uploadDocument — simulação de salvar documento/foto', () => {
  beforeEach(() => {
    storageUploadSpy().mockClear();
    usersUpdateSpy().mockClear();
    documentsInsertSpy().mockClear();
  });

  it('faz upload no path <userId>/... e registra o documento com user_id correto', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('cnh', 'antt', 'vehicle_registration', 'profile_photo'),
        async (userId, docType) => {
          storageUploadSpy().mockClear();
          documentsInsertSpy().mockClear();

          await uploadDocument(userId, docType, makeFile('foto.jpg'));

          const upCalls = storageUploadSpy().mock.calls;
          const uploadedPath = upCalls[upCalls.length - 1]?.[0] as string;
          // A RLS do storage exige que o primeiro segmento do path seja o userId.
          expect(uploadedPath.split('/')[0]).toBe(userId);

          const insCalls = documentsInsertSpy().mock.calls;
          const insertedRow = insCalls[insCalls.length - 1]?.[0] as {
            user_id: string;
            document_type: string;
          };
          expect(insertedRow.user_id).toBe(userId);
          expect(insertedRow.document_type).toBe(docType);
        }
      ),
      { numRuns: 60 }
    );
  });

  it('sincroniza users.profile_photo_url quando o tipo é profile_photo', async () => {
    await uploadDocument(
      '11111111-1111-1111-1111-111111111111',
      'profile_photo',
      makeFile('p.jpg')
    );
    // A foto "salva" de verdade: a coluna do avatar é atualizada.
    expect(usersUpdateSpy()).toHaveBeenCalledTimes(1);
    const payload = usersUpdateSpy().mock.calls[0][0] as Record<string, unknown>;
    expect('profile_photo_url' in payload).toBe(true);
  });

  it('NÃO atualiza users quando o documento não é foto de perfil', async () => {
    await uploadDocument('22222222-2222-2222-2222-222222222222', 'cnh', makeFile('cnh.jpg'));
    expect(usersUpdateSpy()).not.toHaveBeenCalled();
  });

  it('rejeita tipo de documento inválido antes de qualquer chamada de rede', async () => {
    await expect(
      uploadDocument('33333333-3333-3333-3333-333333333333', 'tipo_invalido', makeFile('x.jpg'))
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_TYPE' });
    expect(storageUploadSpy()).not.toHaveBeenCalled();
  });
});
