/**
 * Teste de regressão — resolveProfilePhotoUrl.
 *
 * CONTEXTO: a foto de perfil é guardada como um PATH no bucket privado
 * `documents` (ex: `<userId>/profile_photo_<ts>.jpeg`). Para exibir, o app
 * precisa transformar esse path numa signed URL. Este teste fixa as regras
 * que já causaram bugs:
 *   1. URL http(s) já pronta passa direto (não tenta assinar de novo).
 *   2. Path de imagem → pede signed URL ao storage e retorna a assinada.
 *   3. Path de extensão não-imagem (ex: .pdf legado) → retorna null sem
 *      chamar a API (evita 400 ruidoso).
 *   4. Erro do storage → retorna null (UI cai na inicial, sem quebrar).
 *   5. null/undefined → null.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/supabase', () => {
  const createSignedUrlSpy = vi.fn();
  (globalThis as Record<string, unknown>).__rpCreateSignedUrlSpy = createSignedUrlSpy;
  return {
    supabase: {
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: (...args: unknown[]) => createSignedUrlSpy(...args),
        })),
      },
    },
  };
});

import { resolveProfilePhotoUrl } from '../../services/documents';

const signedSpy = () =>
  (globalThis as Record<string, unknown>).__rpCreateSignedUrlSpy as ReturnType<typeof vi.fn>;

describe('resolveProfilePhotoUrl', () => {
  beforeEach(() => {
    signedSpy().mockReset();
  });

  it('retorna null para null/undefined/vazio', async () => {
    expect(await resolveProfilePhotoUrl(null)).toBeNull();
    expect(await resolveProfilePhotoUrl(undefined)).toBeNull();
    expect(await resolveProfilePhotoUrl('')).toBeNull();
    expect(signedSpy()).not.toHaveBeenCalled();
  });

  it('passa URL http(s) direto sem chamar o storage', async () => {
    const url = 'https://cdn.exemplo.com/foto.jpg';
    expect(await resolveProfilePhotoUrl(url)).toBe(url);
    expect(signedSpy()).not.toHaveBeenCalled();
  });

  it('gera signed URL para path de imagem no bucket privado', async () => {
    signedSpy().mockResolvedValue({ data: { signedUrl: 'https://signed/foto.jpeg' }, error: null });
    const result = await resolveProfilePhotoUrl(
      '4475d264-2271-4f74-ac84-4d07f0480a72/profile_photo_123.jpeg'
    );
    expect(result).toBe('https://signed/foto.jpeg');
    expect(signedSpy()).toHaveBeenCalledTimes(1);
  });

  it('retorna null sem chamar API para extensão não-imagem (ex: pdf legado)', async () => {
    const result = await resolveProfilePhotoUrl('user/algum_documento.pdf');
    expect(result).toBeNull();
    expect(signedSpy()).not.toHaveBeenCalled();
  });

  it('retorna null quando o storage devolve erro (UI cai na inicial)', async () => {
    signedSpy().mockResolvedValue({ data: null, error: { message: 'denied' } });
    const result = await resolveProfilePhotoUrl('user/profile_photo_9.png');
    expect(result).toBeNull();
  });
});
