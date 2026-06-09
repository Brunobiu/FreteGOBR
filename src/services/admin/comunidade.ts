/**
 * Service do módulo Frete Comunidade (admin) — spec frete-comunidade (Fase 4).
 *
 * Orquestra as RPCs SECURITY DEFINER da migration 063, o upload da foto da
 * marca (bucket público `community_profile`) e o mapeamento de erros para
 * mensagens pt-BR (anti-enumeração quando aplicável). Espelha o estilo de
 * `subscriptions.ts` (tipos + mapError + classe de erro).
 *
 * Toda mensagem user-facing em pt-BR; error codes/identifiers em inglês.
 */

import { supabase } from '../supabase';

// ─── Tipos ───────────────────────────────────────────────────────────────

export interface CommunityProfile {
  photoPath: string | null;
  photoUrl: string | null;
  name: string;
  secondaryName: string;
  enabled: boolean;
  updatedAt: string;
}

export interface CommunityFreteRow {
  id: string;
  origin: string;
  destination: string;
  value: number;
  product: string | null;
  carrierName: string | null;
  contactPhone: string | null;
  refDate: string;
  daysLeft: number;
  createdAt: string;
  status: string;
}

export interface CommunityFretesListResult {
  rows: CommunityFreteRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface CommunityFretesFilters {
  q?: string;
  sort?: 'recent' | 'value_asc' | 'value_desc';
  limit?: number;
  offset?: number;
}

export const DEFAULT_COMMUNITY_FILTERS: Required<CommunityFretesFilters> = {
  q: '',
  sort: 'recent',
  limit: 10,
  offset: 0,
};

/** Linha pronta para publicação (já geocodificada no preview). */
export interface PublishRowInput {
  carrierName: string;
  origin: string;
  destination: string;
  originDetail: string;
  destinationDetail: string;
  value: number;
  product: string;
  contactPhone: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  distanceKm: number;
  dedupAction?: 'insert' | 'update' | 'skip';
  existingFreteId?: string | null;
}

export interface PublishResult {
  published: number;
  updated: number;
  skipped: number;
  errors: number;
}

// ─── Erros ───────────────────────────────────────────────────────────────

export type CommunityErrorCode =
  | 'PERMISSION_DENIED'
  | 'STALE_VERSION'
  | 'INVALID_INPUT'
  | 'INVALID_FILE_TYPE'
  | 'NO_PROFILE'
  | 'FEATURE_DISABLED'
  | 'CITY_UNRESOLVED'
  | 'UNKNOWN';

export const COMMUNITY_ERROR_MESSAGES: Record<CommunityErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para acessar esta área.',
  STALE_VERSION: 'Outro admin atualizou. Recarregando.',
  INVALID_INPUT: 'Dados inválidos. Verifique os campos e tente novamente.',
  INVALID_FILE_TYPE: 'Tipo de arquivo inválido. Envie um arquivo no formato permitido.',
  NO_PROFILE: 'Configure o perfil comunidade antes de publicar.',
  FEATURE_DISABLED: 'A feature Frete Comunidade está desativada.',
  CITY_UNRESOLVED: 'Resolva as cidades de origem e destino antes de publicar esta linha.',
  UNKNOWN: 'Não foi possível concluir a operação. Tente novamente.',
};

export class CommunityError extends Error {
  readonly code: CommunityErrorCode;
  constructor(code: CommunityErrorCode) {
    super(COMMUNITY_ERROR_MESSAGES[code]);
    this.name = 'CommunityError';
    this.code = code;
  }
}

/** Traduz um erro cru (Supabase/RPC) para CommunityError com código interno. */
export function mapError(err: unknown): CommunityError {
  const raw =
    (err as { message?: string; code?: string } | null)?.message ??
    String(err ?? '');
  const code = (err as { code?: string } | null)?.code ?? '';

  if (code === '42501' || /permission_denied/i.test(raw)) {
    return new CommunityError('PERMISSION_DENIED');
  }
  if (/STALE_VERSION/.test(raw)) return new CommunityError('STALE_VERSION');
  if (/NO_PROFILE/.test(raw)) return new CommunityError('NO_PROFILE');
  if (/FEATURE_DISABLED/.test(raw)) return new CommunityError('FEATURE_DISABLED');
  if (/CITY_UNRESOLVED/.test(raw)) return new CommunityError('CITY_UNRESOLVED');
  if (/INVALID_FILE_TYPE/.test(raw)) return new CommunityError('INVALID_FILE_TYPE');
  if (/INVALID_INPUT/.test(raw)) return new CommunityError('INVALID_INPUT');
  return new CommunityError('UNKNOWN');
}

// ─── Filtros (parse/serialize espelho de subscriptions/admin) ──────────────

export function parseCommunityFilters(params: URLSearchParams): CommunityFretesFilters {
  const sortRaw = params.get('sort');
  const sort: CommunityFretesFilters['sort'] =
    sortRaw === 'value_asc' || sortRaw === 'value_desc' ? sortRaw : 'recent';
  const limitRaw = Number(params.get('limit'));
  const limit = [10, 50, 100].includes(limitRaw) ? limitRaw : DEFAULT_COMMUNITY_FILTERS.limit;
  const offsetRaw = Number(params.get('offset'));
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  return { q: params.get('q') ?? '', sort, limit, offset };
}

export function serializeCommunityFilters(filters: CommunityFretesFilters): URLSearchParams {
  const sp = new URLSearchParams();
  const q = (filters.q ?? '').trim();
  if (q) sp.set('q', q);
  if (filters.sort && filters.sort !== 'recent') sp.set('sort', filters.sort);
  if (filters.limit && filters.limit !== DEFAULT_COMMUNITY_FILTERS.limit) {
    sp.set('limit', String(filters.limit));
  }
  if (filters.offset && filters.offset > 0) sp.set('offset', String(filters.offset));
  return sp;
}

// ─── Foto (upload + validação) ─────────────────────────────────────────────

export const COMMUNITY_BUCKET = 'community_profile';
const ALLOWED_PHOTO_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Valida MIME/tamanho da foto (Req 2.7). Pura — testável isolada. */
export function validatePhotoFile(file: { type: string; size: number }): CommunityErrorCode | null {
  if (!ALLOWED_PHOTO_MIME.includes(file.type)) return 'INVALID_FILE_TYPE';
  if (file.size > MAX_PHOTO_BYTES) return 'INVALID_FILE_TYPE';
  return null;
}

function photoExt(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export async function uploadCommunityPhoto(file: File): Promise<string> {
  const invalid = validatePhotoFile(file);
  if (invalid) throw new CommunityError(invalid);

  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${photoExt(file.type)}`;
  const { error } = await supabase.storage.from(COMMUNITY_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw mapError(error);
  return path;
}

export function communityPhotoPublicUrl(photoPath: string | null): string | null {
  if (!photoPath) return null;
  const { data } = supabase.storage.from(COMMUNITY_BUCKET).getPublicUrl(photoPath);
  return data.publicUrl ?? null;
}

// ─── Perfil ──────────────────────────────────────────────────────────────

interface ProfileRpcRow {
  photo_path: string | null;
  name: string;
  secondary_name: string;
  enabled: boolean;
  updated_at: string;
}

export async function getCommunityProfile(): Promise<CommunityProfile | null> {
  const { data, error } = await supabase.rpc('community_profile_get');
  if (error) throw mapError(error);
  if (!data) return null;
  const row = data as ProfileRpcRow;
  return {
    photoPath: row.photo_path,
    photoUrl: communityPhotoPublicUrl(row.photo_path),
    name: row.name ?? '',
    secondaryName: row.secondary_name ?? '',
    enabled: !!row.enabled,
    updatedAt: row.updated_at,
  };
}

export async function upsertCommunityProfile(
  input: { photoPath: string | null; name: string; secondaryName: string; enabled: boolean },
  expectedUpdatedAt: string
): Promise<string> {
  const { data, error } = await supabase.rpc('community_profile_upsert', {
    p_photo_path: input.photoPath,
    p_name: input.name,
    p_secondary_name: input.secondaryName,
    p_enabled: input.enabled,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw mapError(error);
  return (data as { updated_at: string }).updated_at;
}

export async function setCommunityEnabled(
  enabled: boolean,
  current: { photoPath: string | null; name: string; secondaryName: string },
  expectedUpdatedAt: string
): Promise<string> {
  return upsertCommunityProfile({ ...current, enabled }, expectedUpdatedAt);
}

// ─── Listagem ──────────────────────────────────────────────────────────────

interface FreteRpcRow {
  id: string;
  origin: string;
  destination: string;
  value: number;
  product: string | null;
  carrier_name: string | null;
  contact_phone: string | null;
  ref_date: string;
  days_left: number;
  created_at: string;
  status: string;
}

export async function listCommunityFretes(
  filters: CommunityFretesFilters
): Promise<CommunityFretesListResult> {
  const { data, error } = await supabase.rpc('admin_list_community_fretes', {
    p_q: filters.q ?? null,
    p_sort: filters.sort ?? 'recent',
    p_limit: filters.limit ?? DEFAULT_COMMUNITY_FILTERS.limit,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw mapError(error);
  const payload = data as { rows: FreteRpcRow[]; total: number; limit: number; offset: number };
  return {
    rows: (payload.rows ?? []).map((r) => ({
      id: r.id,
      origin: r.origin,
      destination: r.destination,
      value: typeof r.value === 'string' ? parseFloat(r.value) : r.value,
      product: r.product,
      carrierName: r.carrier_name,
      contactPhone: r.contact_phone,
      refDate: r.ref_date,
      daysLeft: r.days_left,
      createdAt: r.created_at,
      status: r.status,
    })),
    total: payload.total ?? 0,
    limit: payload.limit ?? DEFAULT_COMMUNITY_FILTERS.limit,
    offset: payload.offset ?? 0,
  };
}

// ─── Publicação em lote ──────────────────────────────────────────────────

export async function publishCommunityFretes(rows: PublishRowInput[]): Promise<PublishResult> {
  const payload = rows.map((r) => ({
    carrierName: r.carrierName,
    origin: r.origin,
    destination: r.destination,
    originDetail: r.originDetail,
    destinationDetail: r.destinationDetail,
    value: r.value,
    product: r.product,
    contactPhone: r.contactPhone,
    originLat: r.originLat,
    originLng: r.originLng,
    destinationLat: r.destinationLat,
    destinationLng: r.destinationLng,
    distanceKm: r.distanceKm,
    dedupAction: r.dedupAction ?? 'insert',
    existingFreteId: r.existingFreteId ?? null,
  }));

  const { data, error } = await supabase.rpc('community_publish_fretes', { p_payload: payload });
  if (error) throw mapError(error);
  return data as PublishResult;
}
