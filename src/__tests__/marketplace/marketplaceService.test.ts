/**
 * Testes do service do Marketplace (src/services/marketplace.ts).
 *
 * Cobre:
 *  - marketplaceMessage: todos os codes mapeiam para pt-BR; desconhecido ⇒ fallback.
 *  - createMarketplacePost: caminhos negativos de validação (sem rede — lança
 *    antes de qualquer chamada ao supabase) e rollback das fotos em falha de DB.
 *  - listMarketplacePosts / getMarketplacePost: mapeamento do retorno da RPC
 *    (coerção de numeric/string, montagem de point, photoUrls públicas).
 *  - deleteMarketplacePost: soft-delete.
 *
 * Convenção do projeto: `vi.mock` é hoisted — impls mutáveis expostos via
 * `globalThis.__mp*` (nunca referenciar variáveis externas no factory).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/supabase', () => {
  const g = globalThis as Record<string, unknown>;
  return {
    supabase: {
      rpc: (...a: unknown[]) => (g.__mpRpc as ((...x: unknown[]) => unknown))?.(...a),
      from: (...a: unknown[]) => (g.__mpFrom as ((...x: unknown[]) => unknown))?.(...a),
      storage: { from: (...a: unknown[]) => (g.__mpStorage as ((...x: unknown[]) => unknown))?.(...a) },
    },
  };
});

import {
  createMarketplacePost,
  listMarketplacePosts,
  getMarketplacePost,
  deleteMarketplacePost,
  marketplaceMessage,
  MarketplaceError,
  type CreateMarketplacePostInput,
} from '../../services/marketplace';

const g = globalThis as Record<string, unknown>;

function makeFile(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function baseInput(overrides: Partial<CreateMarketplacePostInput> = {}): CreateMarketplacePostInput {
  return {
    authorId: 'user-1',
    authorName: 'Bruno',
    authorPhotoPath: null,
    postType: 'venda',
    title: 'Caminhão 2008',
    description: 'Completo, ar gelando.',
    price: 65000,
    photos: [makeFile('a.jpg', 'image/jpeg')],
    point: { latitude: -16.3, longitude: -49.5 },
    locationLabel: 'Indiara, GO',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete g.__mpRpc;
  delete g.__mpFrom;
  delete g.__mpStorage;
});

describe('marketplaceMessage', () => {
  it('mapeia codes conhecidos para pt-BR', () => {
    expect(marketplaceMessage('INVALID_FILE_TYPE')).toMatch(/imagens/i);
    expect(marketplaceMessage('LOCATION_REQUIRED')).toMatch(/localização/i);
    expect(marketplaceMessage('TOO_MANY_PHOTOS')).toMatch(/10 fotos/i);
    expect(marketplaceMessage('PHOTO_TOO_LARGE')).toMatch(/5 MB/i);
  });

  it('code desconhecido ⇒ fallback genérico', () => {
    expect(marketplaceMessage('SOMETHING_ELSE')).toBe(marketplaceMessage('UNKNOWN'));
  });
});

describe('createMarketplacePost — validação (sem rede)', () => {
  it('sem fotos ⇒ NO_PHOTOS', async () => {
    await expect(createMarketplacePost(baseInput({ photos: [] }))).rejects.toMatchObject({
      code: 'NO_PHOTOS',
    });
  });

  it('sem localização ⇒ LOCATION_REQUIRED', async () => {
    await expect(
      createMarketplacePost(baseInput({ point: undefined as unknown as CreateMarketplacePostInput['point'] }))
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
  });

  it('título vazio ⇒ TITLE_REQUIRED', async () => {
    await expect(createMarketplacePost(baseInput({ title: '   ' }))).rejects.toMatchObject({
      code: 'TITLE_REQUIRED',
    });
  });

  it('foto com MIME inválido ⇒ INVALID_FILE_TYPE', async () => {
    await expect(
      createMarketplacePost(baseInput({ photos: [makeFile('x.pdf', 'application/pdf')] }))
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  it('valor <= 0 em venda ⇒ INVALID_PRICE', async () => {
    await expect(createMarketplacePost(baseInput({ price: 0 }))).rejects.toMatchObject({
      code: 'INVALID_PRICE',
    });
  });

  it('mais de 10 fotos ⇒ TOO_MANY_PHOTOS', async () => {
    const photos = Array.from({ length: 11 }, (_, i) => makeFile(`p${i}.jpg`, 'image/jpeg'));
    await expect(createMarketplacePost(baseInput({ photos }))).rejects.toMatchObject({
      code: 'TOO_MANY_PHOTOS',
    });
  });
});

describe('createMarketplacePost — happy path e rollback', () => {
  it('publica: sobe fotos, insere e retorna o post com URLs públicas', async () => {
    const uploads: string[] = [];
    g.__mpStorage = () => ({
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
      remove: async () => ({ error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
    });
    g.__mpFrom = () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: { id: 'post-1', created_at: '2026-06-22T12:00:00Z' },
            error: null,
          }),
        }),
      }),
    });

    const post = await createMarketplacePost(baseInput({ photos: [makeFile('a.jpg', 'image/jpeg')] }));
    expect(post.id).toBe('post-1');
    expect(post.authorId).toBe('user-1');
    expect(post.photoPaths).toHaveLength(1);
    expect(post.photoUrls[0]).toMatch(/^https:\/\/cdn\/user-1\//);
    expect(post.point).toEqual({ latitude: -16.3, longitude: -49.5 });
    expect(post.price).toBe(65000);
  });

  it('sem valor ⇒ PRICE_REQUIRED (sem rede)', async () => {
    await expect(createMarketplacePost(baseInput({ price: null }))).rejects.toMatchObject({
      code: 'PRICE_REQUIRED',
    });
  });

  it('falha de DB após upload ⇒ rollback remove as fotos e lança DATABASE_ERROR', async () => {
    const uploaded: string[] = [];
    let removedPaths: string[] | null = null;
    g.__mpStorage = () => ({
      upload: async (path: string) => {
        uploaded.push(path);
        return { error: null };
      },
      remove: async (paths: string[]) => {
        removedPaths = paths;
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
    });
    g.__mpFrom = () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }),
      }),
    });

    await expect(
      createMarketplacePost(baseInput({ photos: [makeFile('a.jpg', 'image/jpeg')] }))
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(removedPaths).toEqual(uploaded);
    expect(uploaded).toHaveLength(1);
  });
});

describe('listMarketplacePosts / getMarketplacePost — mapeamento da RPC', () => {
  const rpcRow = {
    id: 'p1',
    author_id: 'u1',
    author_name: 'Bruno',
    author_photo_path: 'u1/avatar.jpg',
    post_type: 'venda',
    title: '2008 Volkswagen Gol',
    description: 'Completo',
    price: '65000.00', // numeric do Postgres pode vir como string
    photo_paths: ['u1/a.jpg', 'u1/b.jpg'],
    lat: -16.6864,
    lng: -49.2643,
    location_label: 'Goiânia, GO',
    created_at: '2026-06-18T10:00:00Z',
  };

  beforeEach(() => {
    g.__mpStorage = () => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
    });
  });

  it('lista mapeia linhas, coage price e monta point + photoUrls', async () => {
    g.__mpRpc = async (name: string) => {
      expect(name).toBe('marketplace_list_posts');
      return { data: [rpcRow], error: null };
    };
    const posts = await listMarketplacePosts({ limit: 20, offset: 0 });
    expect(posts).toHaveLength(1);
    expect(posts[0].price).toBe(65000);
    expect(posts[0].point).toEqual({ latitude: -16.6864, longitude: -49.2643 });
    expect(posts[0].photoUrls).toEqual(['https://cdn/u1/a.jpg', 'https://cdn/u1/b.jpg']);
    expect(posts[0].authorName).toBe('Bruno');
  });

  it('detalhe retorna o post quando a RPC traz uma linha', async () => {
    g.__mpRpc = async () => ({ data: [rpcRow], error: null });
    const post = await getMarketplacePost('p1');
    expect(post?.id).toBe('p1');
    expect(post?.title).toMatch(/Gol/);
  });

  it('detalhe retorna null quando a RPC traz lista vazia', async () => {
    g.__mpRpc = async () => ({ data: [], error: null });
    expect(await getMarketplacePost('missing')).toBeNull();
  });

  it('erro de RPC ⇒ MarketplaceError DATABASE_ERROR', async () => {
    g.__mpRpc = async () => ({ data: null, error: { message: 'rpc down' } });
    await expect(listMarketplacePosts()).rejects.toBeInstanceOf(MarketplaceError);
  });
});

describe('deleteMarketplacePost', () => {
  it('faz update status=removido e resolve sem erro', async () => {
    let patch: unknown = null;
    g.__mpFrom = () => ({
      update: (p: unknown) => {
        patch = p;
        return { eq: async () => ({ error: null }) };
      },
    });
    await expect(deleteMarketplacePost('p1')).resolves.toBeUndefined();
    expect(patch).toEqual({ status: 'removido' });
  });
});
