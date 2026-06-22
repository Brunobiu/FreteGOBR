/**
 * services/marketplace.ts
 *
 * Service do Marketplace (vitrine de anúncios entre usuários).
 *  - createMarketplacePost: valida (núcleo puro), sobe fotos e insere o post
 *    (RLS author_id = auth.uid()); rollback das fotos em falha de DB.
 *  - listMarketplacePosts / getMarketplacePost: leitura via RPCs SECURITY
 *    DEFINER (join do autor) — `marketplace_list_posts` / `marketplace_get_post`.
 *  - deleteMarketplacePost: soft-delete do próprio anúncio (status='removido').
 *  - uploadMarketplacePhotos: upload no bucket público `marketplace_photos`,
 *    caminhos prefixados pelo id do autor.
 *
 * Conteúdo de usuário: escrita autorizada por RLS de dono. A moderação admin
 * (remover anúncio de terceiro) NÃO mora aqui — fica no serviço admin via
 * executeAdminMutation + RPC `marketplace_remove_post`.
 */

import { supabase } from './supabase';
import type { GeographicPoint } from '../types';
import {
  validateMarketplacePostInput,
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  MIN_PHOTOS,
  MAX_PHOTOS,
  type PostType,
} from '../utils/marketplacePost';

const BUCKET = 'marketplace_photos';

export interface MarketplacePost {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoPath: string | null; // resolvido na UI via resolveProfilePhotoUrl
  postType: PostType;
  title: string;
  description: string;
  price: number | null;
  photoPaths: string[];
  photoUrls: string[]; // URLs públicas (getPublicUrl), ordenadas
  point: GeographicPoint | null;
  locationLabel: string;
  createdAt: string;
}

export interface CreateMarketplacePostInput {
  authorId: string;
  authorName: string;
  authorPhotoPath: string | null;
  postType: PostType;
  title: string;
  description: string;
  price: number | null;
  photos: File[];
  point: GeographicPoint; // obrigatório (Forced_Location)
  locationLabel: string;
}

/** Mensagens canônicas em pt-BR por error code. */
const MESSAGES: Record<string, string> = {
  NO_PHOTOS: 'Adicione pelo menos 1 foto.',
  TOO_MANY_PHOTOS: 'Você pode adicionar no máximo 10 fotos.',
  INVALID_FILE_TYPE: 'Envie apenas imagens (JPG, PNG, WebP ou GIF).',
  PHOTO_TOO_LARGE: 'Cada foto deve ter até 5 MB.',
  LOCATION_REQUIRED: 'Ative a localização para publicar.',
  TITLE_REQUIRED: 'Informe um título para o anúncio.',
  TITLE_TOO_LONG: 'O título deve ter até 120 caracteres.',
  DESCRIPTION_TOO_LONG: 'A descrição deve ter até 2000 caracteres.',
  PRICE_REQUIRED: 'Informe o valor do anúncio.',
  INVALID_PRICE: 'Informe um valor válido (maior que zero).',
  UPLOAD_FAILED: 'Não foi possível enviar as fotos. Tente novamente.',
  DATABASE_ERROR: 'Não foi possível concluir a operação. Tente novamente.',
  NOT_FOUND: 'Anúncio indisponível.',
  UNKNOWN: 'Algo deu errado. Tente novamente.',
};

/** Mensagem pt-BR canônica para um error code do Marketplace. */
export function marketplaceMessage(code: string): string {
  return MESSAGES[code] ?? MESSAGES.UNKNOWN;
}

export class MarketplaceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message?: string, httpStatus = 400) {
    super(message ?? marketplaceMessage(code));
    this.name = 'MarketplaceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function getPublicUrl(path: string): string {
  if (!path) return '';
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

interface MarketplaceRpcRow {
  id: string;
  author_id: string;
  author_name: string | null;
  author_photo_path: string | null;
  post_type: PostType;
  title: string;
  description: string | null;
  price: number | string | null;
  photo_paths: string[] | null;
  lat: number | string | null;
  lng: number | string | null;
  location_label: string | null;
  created_at: string;
}

/** Coerção segura para número finito (numeric do Postgres pode vir como string). */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function rpcRowToPost(row: MarketplaceRpcRow): MarketplacePost {
  const lat = toNumberOrNull(row.lat);
  const lng = toNumberOrNull(row.lng);
  const point = lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null;
  const photoPaths = row.photo_paths ?? [];
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name ?? '',
    authorPhotoPath: row.author_photo_path ?? null,
    postType: row.post_type,
    title: row.title,
    description: row.description ?? '',
    price: toNumberOrNull(row.price),
    photoPaths,
    photoUrls: photoPaths.map(getPublicUrl),
    point,
    locationLabel: row.location_label ?? '',
    createdAt: row.created_at,
  };
}

/**
 * Sobe as fotos no Marketplace_Bucket em `<userId>/<ts>_<rand>.<ext>` (Req 5.1,
 * 5.2). Valida MIME/limite por foto. Em falha no meio do caminho, remove as
 * fotos já enviadas (rollback parcial) e relança o erro.
 */
export async function uploadMarketplacePhotos(userId: string, files: File[]): Promise<string[]> {
  if (files.length < MIN_PHOTOS) throw new MarketplaceError('NO_PHOTOS');
  if (files.length > MAX_PHOTOS) throw new MarketplaceError('TOO_MANY_PHOTOS');

  const uploaded: string[] = [];
  try {
    for (const file of files) {
      if (!(ALLOWED_PHOTO_MIME as readonly string[]).includes(file.type)) {
        throw new MarketplaceError('INVALID_FILE_TYPE');
      }
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
        throw new MarketplaceError('PHOTO_TOO_LARGE');
      }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });
      if (error) throw new MarketplaceError('UPLOAD_FAILED', error.message);
      uploaded.push(path);
    }
    return uploaded;
  } catch (err) {
    if (uploaded.length > 0) {
      await supabase.storage
        .from(BUCKET)
        .remove(uploaded)
        .catch(() => {
          /* best-effort rollback */
        });
    }
    throw err;
  }
}

/**
 * Cria um anúncio: valida (núcleo puro), sobe as fotos e insere o post via RLS
 * (author_id = auth.uid()). Em falha de DB após o upload, remove as fotos
 * órfãs (Req 5.4). Retorna o post pronto para exibição.
 */
export async function createMarketplacePost(
  input: CreateMarketplacePostInput
): Promise<MarketplacePost> {
  const price = input.price;

  const validation = validateMarketplacePostInput({
    postType: input.postType,
    title: input.title,
    description: input.description,
    price,
    photos: input.photos.map((f) => ({ mime: f.type, sizeBytes: f.size })),
    hasLocation: Boolean(input.point),
  });
  if (!validation.ok) {
    const firstCode = Object.values(validation.fieldErrors)[0];
    throw new MarketplaceError(firstCode ?? 'UNKNOWN');
  }

  const paths = await uploadMarketplacePhotos(input.authorId, input.photos);

  const { data, error } = await supabase
    .from('marketplace_posts')
    .insert({
      author_id: input.authorId,
      post_type: input.postType,
      title: input.title.trim(),
      description: input.description ?? '',
      price,
      photo_paths: paths,
      location: `POINT(${input.point.longitude} ${input.point.latitude})`,
      location_label: input.locationLabel ?? '',
    })
    .select('id, created_at')
    .single();

  if (error || !data) {
    await supabase.storage
      .from(BUCKET)
      .remove(paths)
      .catch(() => {
        /* best-effort: evita fotos órfãs */
      });
    throw new MarketplaceError('DATABASE_ERROR', error?.message);
  }

  return {
    id: data.id,
    authorId: input.authorId,
    authorName: input.authorName,
    authorPhotoPath: input.authorPhotoPath,
    postType: input.postType,
    title: input.title.trim(),
    description: input.description ?? '',
    price,
    photoPaths: paths,
    photoUrls: paths.map(getPublicUrl),
    point: input.point,
    locationLabel: input.locationLabel ?? '',
    createdAt: data.created_at,
  };
}

/** Feed paginado de anúncios ativos (Req 6). */
export async function listMarketplacePosts(opts?: {
  limit?: number;
  offset?: number;
}): Promise<MarketplacePost[]> {
  const { data, error } = await supabase.rpc('marketplace_list_posts', {
    p_limit: opts?.limit ?? 20,
    p_offset: opts?.offset ?? 0,
  });
  if (error) throw new MarketplaceError('DATABASE_ERROR', error.message);
  return ((data as MarketplaceRpcRow[]) ?? []).map(rpcRowToPost);
}

/** Detalhe de um anúncio (Req 7). Retorna `null` quando indisponível. */
export async function getMarketplacePost(id: string): Promise<MarketplacePost | null> {
  const { data, error } = await supabase.rpc('marketplace_get_post', { p_id: id });
  if (error) throw new MarketplaceError('DATABASE_ERROR', error.message);
  const rows = (data as MarketplaceRpcRow[]) ?? [];
  return rows.length > 0 ? rpcRowToPost(rows[0]) : null;
}

/** Soft-delete do próprio anúncio (Req 11.1). RLS garante que só o dono remove. */
export async function deleteMarketplacePost(id: string): Promise<void> {
  const { error } = await supabase
    .from('marketplace_posts')
    .update({ status: 'removido' })
    .eq('id', id);
  if (error) throw new MarketplaceError('DATABASE_ERROR', error.message);
}
