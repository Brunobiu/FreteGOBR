/**
 * admin/users.ts
 *
 * Service de gestao de usuarios do painel admin.
 * Toda mutacao passa por executeAdminMutation (audit-by-construction).
 * Nenhuma chamada direta a .update/.delete/.insert sem o wrapper.
 *
 * Dependencias: admin-foundation (Permission_Matrix, executeAdminMutation,
 * is_admin_with_permission RPC, log_admin_action RPC).
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';
import type { AdminRole } from './permissions';

// ===================== Tipos publicos =====================

export type UserType = 'motorista' | 'embarcador';
export type UserTypeFilter = 'todos' | UserType;
export type UserStatusFilter = 'todos' | 'ativo' | 'inativo' | 'banido';
export type UserSort = 'created_desc' | 'created_asc' | 'activity_desc' | 'activity_asc';

export interface UsersFilters {
  type: UserTypeFilter;
  status: UserStatusFilter;
  q: string;
  sort: UserSort;
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: UsersFilters = {
  type: 'todos',
  status: 'todos',
  q: '',
  sort: 'created_desc',
  page: 1,
  pageSize: 10,
};

export interface UserRow {
  id: string;
  user_type: UserType;
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  cnpj: string | null;
  company_name: string | null;
  is_active: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  banned_by: string | null;
  profile_photo_url: string | null;
  admin_username: string | null;
  created_at: string;
  last_activity_at: string | null;
  updated_at: string;
}

export interface UsersListResult {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserDocument {
  id: string;
  document_type: string;
  file_name: string;
  uploaded_at: string;
}

export interface UserFreteRow {
  id: string;
  origin: string;
  destination: string;
  status: string;
  created_at: string;
  clicked_at?: string;
}

export interface UserRatingRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  rater_name: string;
}

export interface UserChatMetadata {
  conversation_id: string;
  total_messages: number;
  last_message_at: string | null;
  last_admin_reply_at: string | null;
}

export interface UserDetailBundle {
  user: UserRow;
  bannedByName: string | null;
  location: { latitude: number; longitude: number } | null;
  documents: UserDocument[];
  fretes: UserFreteRow[];
  fretesTotal: number;
  ratings: UserRatingRow[];
  chat: UserChatMetadata[];
  errors: Partial<Record<'documents' | 'fretes' | 'ratings' | 'chat' | 'location', string>>;
}

export type BulkSkipReason =
  | 'MASTER_ADMIN_IMMUTABLE'
  | 'SELF_ACTION_FORBIDDEN'
  | 'ALREADY_IN_TARGET_STATE';

export interface BulkResult {
  success: string[];
  skipped: { id: string; reason: BulkSkipReason }[];
  failed: { id: string; reason: string }[];
}

export type UsersErrorCode =
  | 'MASTER_ADMIN_IMMUTABLE'
  | 'SELF_ACTION_FORBIDDEN'
  | 'STALE_VERSION'
  | 'LAST_SUPER_ADMIN_PROTECTED'
  | 'NO_RECOVERY_CHANNEL'
  | 'PHONE_ALREADY_USED'
  | 'EMAIL_ALREADY_USED'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'BULK_LIMIT_EXCEEDED'
  | 'INVALID_INPUT';

export class UsersServiceError extends Error {
  constructor(
    public code: UsersErrorCode,
    message?: string,
    public cause?: unknown
  ) {
    super(message ?? code);
    this.name = 'UsersServiceError';
  }
}

export const USERS_ERROR_MESSAGES: Record<UsersErrorCode, string> = {
  MASTER_ADMIN_IMMUTABLE: 'Master_Admin e imutavel.',
  SELF_ACTION_FORBIDDEN: 'Nao e permitido aplicar esta acao na propria conta.',
  STALE_VERSION: 'Os dados foram alterados por outro admin. Recarregue antes de salvar.',
  LAST_SUPER_ADMIN_PROTECTED: 'Nao e possivel revogar o ultimo SUPER_ADMIN.',
  NO_RECOVERY_CHANNEL: 'Usuario nao possui email nem telefone valido para reset.',
  PHONE_ALREADY_USED: 'Telefone ja cadastrado em outra conta.',
  EMAIL_ALREADY_USED: 'Email ja cadastrado em outra conta.',
  NOT_FOUND: 'Usuario nao encontrado.',
  PERMISSION_DENIED: 'Operacao nao permitida.',
  BULK_LIMIT_EXCEEDED: 'Maximo de 200 por operacao.',
  INVALID_INPUT: 'Dados invalidos.',
};

export interface EditUserPayload {
  name: string;
  email: string | null;
  phone: string;
  cpf?: string | null;
  cnpj?: string | null;
  company_name?: string | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  admin_username: string | null;
  is_active: boolean;
  is_superuser: boolean;
  roles: AdminRole[];
  is_master: boolean;
  last_login_at: string | null;
}

// ===================== Helpers puros =====================

const MASTER_USERNAME = 'Nexus_Vortex99';

export function isMasterAdmin(u: { admin_username: string | null }): boolean {
  return u.admin_username === MASTER_USERNAME;
}

export function classifyUserStatus(
  u: Pick<UserRow, 'is_active' | 'ban_reason'>
): 'ativo' | 'inativo' | 'banido' {
  if (u.is_active) return 'ativo';
  if (u.ban_reason && u.ban_reason.length > 0) return 'banido';
  return 'inativo';
}

export function normalizeDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Escape de , e % em filtros .or() do PostgREST.
 */
export function escapeOr(s: string): string {
  return s.replace(/,/g, '\\,').replace(/%/g, '\\%');
}

/**
 * Escape RFC 4180: campos com separador, " \n \r ficam entre aspas duplas
 * e aspas internas sao duplicadas.
 */
function csvField(v: unknown, sep: string): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  const needsQuoting = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(sep);
  if (needsQuoting) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADER = [
  'id',
  'user_type',
  'name',
  'phone',
  'email',
  'cpf_or_cnpj',
  'company_name',
  'is_active',
  'created_at',
  'last_activity_at',
] as const;

export interface CsvOptions {
  separator?: ',' | ';';
  withBom?: boolean;
}

export function exportUsersToCsvString(rows: UserRow[], options: CsvOptions = {}): string {
  const sep = options.separator ?? ',';
  const bom = options.withBom ? '\uFEFF' : '';
  const header = CSV_HEADER.join(sep);
  const body = rows
    .map((r) =>
      [
        r.id,
        r.user_type,
        r.name,
        r.phone,
        r.email,
        r.user_type === 'motorista' ? r.cpf : r.cnpj,
        r.company_name,
        r.is_active ? 'true' : 'false',
        r.created_at,
        r.last_activity_at,
      ]
        .map((v) => csvField(v, sep))
        .join(sep)
    )
    .join('\r\n');
  return bom + (rows.length > 0 ? `${header}\r\n${body}` : header);
}

// ===================== URL <-> filtros =====================

const VALID_TYPES: UserTypeFilter[] = ['todos', 'motorista', 'embarcador'];
const VALID_STATUS: UserStatusFilter[] = ['todos', 'ativo', 'inativo', 'banido'];
const VALID_SORTS: UserSort[] = ['created_desc', 'created_asc', 'activity_desc', 'activity_asc'];

export function parseUsersFiltersFromQuery(qs: URLSearchParams | string): UsersFilters {
  const sp = typeof qs === 'string' ? new URLSearchParams(qs) : qs;
  const type = sp.get('type') as UserTypeFilter | null;
  const status = sp.get('status') as UserStatusFilter | null;
  const sort = sp.get('sort') as UserSort | null;
  const page = parseInt(sp.get('page') ?? '', 10);
  const pageSizeRaw = parseInt(sp.get('pageSize') ?? '', 10);
  const pageSize = [10, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : DEFAULT_FILTERS.pageSize;

  return {
    type: type && VALID_TYPES.includes(type) ? type : DEFAULT_FILTERS.type,
    status: status && VALID_STATUS.includes(status) ? status : DEFAULT_FILTERS.status,
    q: sp.get('q') ?? DEFAULT_FILTERS.q,
    sort: sort && VALID_SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    page: Number.isFinite(page) && page >= 1 ? page : DEFAULT_FILTERS.page,
    pageSize,
  };
}

export function serializeUsersFiltersToQuery(f: UsersFilters): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set('type', f.type);
  sp.set('status', f.status);
  sp.set('q', f.q);
  sp.set('sort', f.sort);
  sp.set('page', String(f.page));
  sp.set('pageSize', String(f.pageSize));
  return sp;
}

// ===================== Listagem =====================

interface UserDbRow {
  id: string;
  user_type: string;
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  is_active: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  banned_by: string | null;
  profile_photo_url: string | null;
  admin_username: string | null;
  created_at: string;
  last_activity_at: string | null;
  updated_at: string;
  embarcadores?: { cnpj: string | null; company_name: string | null } | null;
}

function dbRowToUserRow(r: UserDbRow): UserRow {
  const emb = Array.isArray(r.embarcadores) ? r.embarcadores[0] : r.embarcadores;
  return {
    id: r.id,
    user_type: r.user_type as UserType,
    name: r.name,
    phone: r.phone,
    email: r.email,
    cpf: r.cpf,
    cnpj: emb?.cnpj ?? null,
    company_name: emb?.company_name ?? null,
    is_active: r.is_active,
    ban_reason: r.ban_reason,
    banned_at: r.banned_at,
    banned_by: r.banned_by,
    profile_photo_url: r.profile_photo_url,
    admin_username: r.admin_username,
    created_at: r.created_at,
    last_activity_at: r.last_activity_at,
    updated_at: r.updated_at,
  };
}

export async function listUsers(filters: UsersFilters): Promise<UsersListResult> {
  let query = supabase
    .from('users')
    .select(
      `id, user_type, name, phone, email, cpf, is_active, ban_reason, banned_at,
       banned_by, profile_photo_url, admin_username, created_at, last_activity_at,
       updated_at, embarcadores(cnpj, company_name)`,
      { count: 'exact' }
    )
    .in('user_type', ['motorista', 'embarcador']);

  if (filters.type !== 'todos') {
    query = query.eq('user_type', filters.type);
  }

  switch (filters.status) {
    case 'ativo':
      query = query.eq('is_active', true);
      break;
    case 'inativo':
      query = query.eq('is_active', false).is('ban_reason', null);
      break;
    case 'banido':
      query = query.eq('is_active', false).not('ban_reason', 'is', null);
      break;
    default:
      break;
  }

  const q = filters.q.trim();
  if (q.length > 0) {
    const qDigits = normalizeDigits(q);
    const isDigitOnly = qDigits.length >= 8 && /^[\d\s().+-]+$/.test(q);
    const e = escapeOr(q);
    if (isDigitOnly) {
      query = query.or(
        `name.ilike.%${e}%,phone.ilike.%${escapeOr(qDigits)}%,cpf.ilike.%${escapeOr(qDigits)}%`
      );
    } else {
      query = query.or(`name.ilike.%${e}%,email.ilike.%${e}%`);
    }
  }

  const orderMap: Record<UserSort, [string, { ascending: boolean; nullsFirst?: boolean }]> = {
    created_desc: ['created_at', { ascending: false }],
    created_asc: ['created_at', { ascending: true }],
    activity_desc: ['last_activity_at', { ascending: false, nullsFirst: false }],
    activity_asc: ['last_activity_at', { ascending: true, nullsFirst: false }],
  };
  const [col, opts] = orderMap[filters.sort];
  query = query.order(col, opts);

  const from = (filters.page - 1) * filters.pageSize;
  query = query.range(from, from + filters.pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as UserDbRow[]).map(dbRowToUserRow);
  return {
    rows,
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

// ===================== Detalhe =====================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(s: string): boolean {
  return UUID_REGEX.test(s);
}

export async function getUserDetail(id: string): Promise<UserDetailBundle> {
  if (!isValidUuid(id)) {
    throw new UsersServiceError('NOT_FOUND');
  }

  // 1) Cabecalho do usuario (fonte da verdade)
  const { data: userData, error: userErr } = await supabase
    .from('users')
    .select(
      `id, user_type, name, phone, email, cpf, is_active, ban_reason, banned_at,
       banned_by, profile_photo_url, admin_username, created_at, last_activity_at,
       updated_at, embarcadores(cnpj, company_name)`
    )
    .eq('id', id)
    .maybeSingle();

  if (userErr || !userData) {
    throw new UsersServiceError('NOT_FOUND', undefined, userErr);
  }

  const user = dbRowToUserRow(userData as unknown as UserDbRow);

  if (user.user_type !== 'motorista' && user.user_type !== 'embarcador') {
    throw new UsersServiceError('NOT_FOUND');
  }

  const errors: UserDetailBundle['errors'] = {};

  // 2) Demais blocos em paralelo, com degradacao parcial
  const [bannedByRes, locRes, docsRes, fretesRes, ratingsRes, chatRes] = await Promise.allSettled([
    user.banned_by
      ? supabase.from('users').select('name').eq('id', user.banned_by).maybeSingle()
      : Promise.resolve({ data: null }),
    user.user_type === 'motorista'
      ? supabase.from('motoristas').select('location').eq('id', id).maybeSingle()
      : supabase.from('embarcadores').select('location').eq('id', id).maybeSingle(),
    supabase
      .from('documents')
      .select('id, document_type, file_name, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    user.user_type === 'embarcador'
      ? supabase
          .from('fretes')
          .select('id, origin, destination, status, created_at', {
            count: 'exact',
          })
          .eq('embarcador_id', id)
          .order('created_at', { ascending: false })
          .limit(10)
      : supabase
          .from('frete_clicks')
          .select('frete_id, clicked_at, fretes(id, origin, destination, status, created_at)', {
            count: 'exact',
          })
          .eq('motorista_id', id)
          .order('clicked_at', { ascending: false })
          .limit(10),
    fetchUserRatings(id, user.user_type),
    fetchChatMetadata(id),
  ]);

  let bannedByName: string | null = null;
  if (bannedByRes.status === 'fulfilled' && bannedByRes.value.data) {
    bannedByName = (bannedByRes.value.data as { name: string }).name;
  }

  let location: { latitude: number; longitude: number } | null = null;
  if (locRes.status === 'fulfilled' && locRes.value.data) {
    const raw = (locRes.value.data as { location: unknown }).location;
    location = parsePostgisPoint(raw);
  } else if (locRes.status === 'rejected') {
    errors.location = String(locRes.reason);
  }

  let documents: UserDocument[] = [];
  if (docsRes.status === 'fulfilled' && !docsRes.value.error) {
    documents = (docsRes.value.data ?? []).map((d) => ({
      id: d.id,
      document_type: d.document_type,
      file_name: d.file_name,
      uploaded_at: d.created_at,
    }));
  } else {
    errors.documents = 'Falha ao carregar documentos';
  }

  let fretes: UserFreteRow[] = [];
  let fretesTotal = 0;
  if (fretesRes.status === 'fulfilled' && !fretesRes.value.error) {
    fretesTotal = fretesRes.value.count ?? 0;
    if (user.user_type === 'embarcador') {
      fretes = (fretesRes.value.data ?? []) as UserFreteRow[];
    } else {
      type ClickRow = {
        frete_id: string;
        clicked_at: string;
        fretes: {
          id: string;
          origin: string;
          destination: string;
          status: string;
          created_at: string;
        } | null;
      };
      const clicks = (fretesRes.value.data ?? []) as unknown as ClickRow[];
      fretes = clicks.map((c) => ({
        id: c.fretes?.id ?? c.frete_id,
        origin: c.fretes?.origin ?? '',
        destination: c.fretes?.destination ?? '',
        status: c.fretes?.status ?? '',
        created_at: c.fretes?.created_at ?? c.clicked_at,
        clicked_at: c.clicked_at,
      }));
    }
  } else {
    errors.fretes = 'Falha ao carregar fretes';
  }

  let ratings: UserRatingRow[] = [];
  if (ratingsRes.status === 'fulfilled') {
    ratings = ratingsRes.value;
  } else {
    errors.ratings = 'Falha ao carregar avaliacoes';
  }

  let chat: UserChatMetadata[] = [];
  if (chatRes.status === 'fulfilled') {
    chat = chatRes.value;
  } else {
    errors.chat = 'Falha ao carregar conversas';
  }

  return {
    user,
    bannedByName,
    location,
    documents,
    fretes,
    fretesTotal,
    ratings,
    chat,
    errors,
  };
}

function parsePostgisPoint(raw: unknown): { latitude: number; longitude: number } | null {
  if (!raw) return null;
  // Supabase devolve como string WKT ou objeto GeoJSON dependendo do PostgREST.
  if (typeof raw === 'string') {
    const m = raw.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/i);
    if (m) {
      return { longitude: parseFloat(m[1]), latitude: parseFloat(m[2]) };
    }
    return null;
  }
  if (typeof raw === 'object' && raw !== null && 'coordinates' in raw) {
    const coords = (raw as { coordinates: number[] }).coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return { longitude: coords[0], latitude: coords[1] };
    }
  }
  return null;
}

async function fetchUserRatings(userId: string, userType: UserType): Promise<UserRatingRow[]> {
  // Embarcador recebe avaliacoes de motoristas (avaliacoes.embarcador_id)
  // Motorista recebe avaliacoes de embarcadores (avaliacoes.motorista_id)
  const col = userType === 'embarcador' ? 'embarcador_id' : 'motorista_id';
  const raterCol = userType === 'embarcador' ? 'motorista_id' : 'embarcador_id';

  const { data, error } = await supabase
    .from('avaliacoes')
    .select(`id, rating, comment, created_at, ${raterCol}`)
    .eq(col, userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data) return [];

  // Resolver nomes dos avaliadores em batch
  const raterIds = Array.from(
    new Set(data.map((r) => (r as Record<string, unknown>)[raterCol] as string))
  );
  const namesById = new Map<string, string>();
  if (raterIds.length > 0) {
    const { data: rRows } = await supabase.from('users').select('id, name').in('id', raterIds);
    for (const r of rRows ?? []) namesById.set(r.id, r.name);
  }

  return data.map((r) => {
    const row = r as unknown as {
      id: string;
      rating: number;
      comment: string | null;
      created_at: string;
    } & Record<string, unknown>;
    const raterId = row[raterCol] as string;
    return {
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      created_at: row.created_at,
      rater_name: namesById.get(raterId) ?? 'Desconhecido',
    };
  });
}

async function fetchChatMetadata(userId: string): Promise<UserChatMetadata[]> {
  const { data: convos } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (!convos || convos.length === 0) return [];

  const result: UserChatMetadata[] = [];
  for (const c of convos) {
    const { data: msgs, count } = await supabase
      .from('chat_messages')
      .select('created_at, is_admin', { count: 'exact' })
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(50);

    const total = count ?? 0;
    const last = msgs && msgs[0] ? msgs[0].created_at : null;
    const lastAdmin =
      (msgs ?? []).find((m) => (m as { is_admin: boolean }).is_admin)?.created_at ?? null;

    result.push({
      conversation_id: c.id,
      total_messages: total,
      last_message_at: last,
      last_admin_reply_at: lastAdmin,
    });
  }
  return result;
}

// ===================== Versionamento otimista =====================

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function loadUserBasic(id: string): Promise<UserRow | null> {
  const { data } = await supabase
    .from('users')
    .select(
      `id, user_type, name, phone, email, cpf, is_active, ban_reason, banned_at,
       banned_by, profile_photo_url, admin_username, created_at, last_activity_at,
       updated_at, embarcadores(cnpj, company_name)`
    )
    .eq('id', id)
    .maybeSingle();
  return data ? dbRowToUserRow(data as unknown as UserDbRow) : null;
}

async function assertNotMasterNorSelf(targetId: string): Promise<void> {
  const target = await loadUserBasic(targetId);
  if (!target) throw new UsersServiceError('NOT_FOUND');
  if (isMasterAdmin(target)) {
    throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE');
  }
  const callerId = await getCurrentUserId();
  if (callerId && callerId === targetId) {
    throw new UsersServiceError('SELF_ACTION_FORBIDDEN');
  }
}

interface VersionedUpdateArgs {
  id: string;
  patch: Record<string, unknown>;
  expectedUpdatedAt: string;
  action: string;
  before: unknown;
  after: unknown;
}

async function applyVersionedUpdateUsers(args: VersionedUpdateArgs): Promise<UserRow> {
  return executeAdminMutation(
    {
      action: args.action,
      targetType: 'users',
      targetId: args.id,
      before: args.before,
      after: args.after,
    },
    async () => {
      const { data, error } = await supabase
        .from('users')
        .update({ ...args.patch, updated_at: new Date().toISOString() })
        .eq('id', args.id)
        .eq('updated_at', args.expectedUpdatedAt)
        .select(
          `id, user_type, name, phone, email, cpf, is_active, ban_reason, banned_at,
           banned_by, profile_photo_url, admin_username, created_at, last_activity_at,
           updated_at, embarcadores(cnpj, company_name)`
        )
        .maybeSingle();

      if (error) {
        const code = (error as { code?: string }).code;
        if (code === '23505') {
          // Unique violation: detectar campo
          const msg = error.message.toLowerCase();
          if (msg.includes('phone')) {
            throw new UsersServiceError('PHONE_ALREADY_USED', undefined, error);
          }
          if (msg.includes('email')) {
            throw new UsersServiceError('EMAIL_ALREADY_USED', undefined, error);
          }
        }
        if (code === 'P0001') {
          // Trigger SQL bloqueou
          if (error.message.includes('master_admin_immutable')) {
            throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE', undefined, error);
          }
          if (error.message.includes('last_super_admin_protected')) {
            throw new UsersServiceError('LAST_SUPER_ADMIN_PROTECTED', undefined, error);
          }
        }
        throw error;
      }

      if (!data) {
        // 0 linhas -> concorrencia ou RLS
        await logAdminAction({
          action: `${args.action}_STALE_VERSION`,
          targetType: 'users',
          targetId: args.id,
          before: { expectedUpdatedAt: args.expectedUpdatedAt },
        }).catch(() => null);
        throw new UsersServiceError('STALE_VERSION');
      }
      return dbRowToUserRow(data as unknown as UserDbRow);
    }
  );
}

// ===================== Mutacoes =====================

export async function toggleActive(
  id: string,
  targetState: boolean,
  expectedUpdatedAt: string
): Promise<UserRow> {
  await assertNotMasterNorSelf(id);
  return applyVersionedUpdateUsers({
    id,
    patch: { is_active: targetState },
    expectedUpdatedAt,
    action: 'USER_TOGGLE_ACTIVE',
    before: { is_active: !targetState },
    after: { is_active: targetState },
  });
}

export interface BanUserBlacklistItem {
  type: 'phone' | 'cpf' | 'cnpj' | 'email';
  value: string;
}

export interface BanUserBlacklistResult {
  inserted: number;
  skipped: number;
  failed: number;
  details: Array<{
    type: BanUserBlacklistItem['type'];
    status: 'inserted' | 'skipped' | 'failed';
    error?: string;
  }>;
}

export interface BanUserResult {
  user: UserRow;
  blacklistResult?: BanUserBlacklistResult;
}

export interface UnbanUserResult {
  user: UserRow;
  blacklistRemoved?: number;
}

export async function banUser(
  id: string,
  reason: string,
  expectedUpdatedAt: string,
  options?: { addToBlacklist?: BanUserBlacklistItem[] }
): Promise<BanUserResult> {
  await assertNotMasterNorSelf(id);
  if (!reason || reason.trim().length === 0 || reason.length > 1000) {
    throw new UsersServiceError('INVALID_INPUT');
  }
  const callerId = await getCurrentUserId();
  const updated = await applyVersionedUpdateUsers({
    id,
    patch: {
      is_active: false,
      ban_reason: reason.trim(),
      banned_at: new Date().toISOString(),
      banned_by: callerId,
    },
    expectedUpdatedAt,
    action: 'USER_BAN',
    before: null,
    after: { ban_reason: reason.trim() },
  });

  const items = options?.addToBlacklist ?? [];
  if (items.length === 0) return { user: updated };

  const { addEntry, BlacklistServiceError } = await import('./blacklist');
  const details: BanUserBlacklistResult['details'] = [];
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  // Pool de concorrencia 5 herdado dos demais bulks
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        await addEntry({
          type: item.type,
          valueRaw: item.value,
          reason: reason.trim(),
          expiresAt: null,
          sourceUserId: id,
        });
        inserted++;
        details.push({ type: item.type, status: 'inserted' });
      } catch (err) {
        if (err instanceof BlacklistServiceError && err.code === 'ALREADY_BLACKLISTED') {
          skipped++;
          details.push({ type: item.type, status: 'skipped' });
        } else {
          failed++;
          details.push({
            type: item.type,
            status: 'failed',
            error: (err as Error).message,
          });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, () => worker()));

  return {
    user: updated,
    blacklistResult: { inserted, skipped, failed, details },
  };
}

export async function unbanUser(
  id: string,
  expectedUpdatedAt: string,
  options?: { removeBlacklistEntries?: boolean }
): Promise<UnbanUserResult> {
  await assertNotMasterNorSelf(id);
  const updated = await applyVersionedUpdateUsers({
    id,
    patch: {
      is_active: true,
      ban_reason: null,
      banned_at: null,
      banned_by: null,
    },
    expectedUpdatedAt,
    action: 'USER_UNBAN',
    before: null,
    after: { is_active: true },
  });

  if (!options?.removeBlacklistEntries) return { user: updated };

  // RPC admin_blacklist_remove_by_user (best-effort: nao aborta o unban)
  try {
    const { supabase } = await import('../supabase');
    const { logAdminAction } = await import('./audit');
    const { data, error } = await supabase.rpc('admin_blacklist_remove_by_user', {
      p_user_id: id,
    });
    if (error) {
      // best-effort: nao aborta unban; log opcional
      return { user: updated, blacklistRemoved: 0 };
    }
    const removedCount =
      typeof data === 'object' && data !== null && 'removed_count' in data
        ? Number((data as { removed_count: number }).removed_count) || 0
        : 0;
    try {
      await logAdminAction({
        action: 'BLACKLIST_REMOVED_BY_USER',
        targetType: 'users',
        targetId: id,
        before: { user_id: id },
        after: { removed_count: removedCount },
      });
    } catch {
      // best-effort
    }
    return { user: updated, blacklistRemoved: removedCount };
  } catch {
    return { user: updated, blacklistRemoved: 0 };
  }
}

// ===================== Edicao =====================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?\d{10,15}$/;

function isValidCpf(cpf: string): boolean {
  const d = normalizeDigits(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(d[i], 10) * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10) r = 0;
  if (r !== parseInt(d[9], 10)) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(d[i], 10) * (11 - i);
  r = (s * 10) % 11;
  if (r === 10) r = 0;
  return r === parseInt(d[10], 10);
}

function isValidCnpj(cnpj: string): boolean {
  const d = normalizeDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number): number => {
    const w =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < len; i++) s += parseInt(d[i], 10) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(d[12], 10) && calc(13) === parseInt(d[13], 10);
}

function validateEditPayload(data: EditUserPayload, userType: UserType): void {
  if (!data.name || data.name.length < 3 || data.name.length > 255) {
    throw new UsersServiceError('INVALID_INPUT', 'Nome deve ter 3..255 chars');
  }
  if (data.email && !EMAIL_REGEX.test(data.email)) {
    throw new UsersServiceError('INVALID_INPUT', 'Email invalido');
  }
  const phoneNorm = normalizeDigits(data.phone);
  if (!PHONE_REGEX.test(data.phone) && !PHONE_REGEX.test(`+${phoneNorm}`)) {
    throw new UsersServiceError('INVALID_INPUT', 'Telefone invalido');
  }
  if (userType === 'motorista' && data.cpf && !isValidCpf(data.cpf)) {
    throw new UsersServiceError('INVALID_INPUT', 'CPF invalido');
  }
  if (userType === 'embarcador') {
    if (!data.company_name || data.company_name.trim().length === 0) {
      throw new UsersServiceError('INVALID_INPUT', 'Razao social obrigatoria');
    }
    if (data.cnpj && !isValidCnpj(data.cnpj)) {
      throw new UsersServiceError('INVALID_INPUT', 'CNPJ invalido');
    }
  }
}

export async function editUser(
  id: string,
  data: EditUserPayload,
  expectedUpdatedAt: string
): Promise<UserRow> {
  const target = await loadUserBasic(id);
  if (!target) throw new UsersServiceError('NOT_FOUND');
  if (isMasterAdmin(target)) {
    throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE');
  }
  validateEditPayload(data, target.user_type);

  // Atualiza users
  const usersPatch: Record<string, unknown> = {
    name: data.name,
    email: data.email,
    phone: data.phone,
  };
  if (target.user_type === 'motorista' && data.cpf !== undefined) {
    usersPatch.cpf = data.cpf;
  }

  const updated = await applyVersionedUpdateUsers({
    id,
    patch: usersPatch,
    expectedUpdatedAt,
    action: 'USER_EDIT',
    before: {
      name: target.name,
      email: target.email,
      phone: target.phone,
      cpf: target.cpf,
    },
    after: usersPatch,
  });

  // Atualiza embarcadores se aplicavel (cnpj/company_name)
  if (
    target.user_type === 'embarcador' &&
    (data.cnpj !== undefined || data.company_name !== undefined)
  ) {
    const embPatch: Record<string, unknown> = {};
    if (data.cnpj !== undefined) embPatch.cnpj = data.cnpj ? normalizeDigits(data.cnpj) : null;
    if (data.company_name !== undefined) embPatch.company_name = data.company_name;

    const { error: embErr } = await supabase.from('embarcadores').update(embPatch).eq('id', id);
    if (embErr) {
      await logAdminAction({
        action: 'USER_EDIT_EMBARCADOR_ROLLBACK',
        targetType: 'embarcadores',
        targetId: id,
        after: { error: embErr.message },
      }).catch(() => null);
      throw embErr;
    }
    // Recarrega para devolver row com embarcadores join atualizado
    const refreshed = await loadUserBasic(id);
    return refreshed ?? updated;
  }

  return updated;
}

// ===================== Excluir conta via RPC =====================

export async function deleteUser(
  id: string,
  options: { confirmedName: string; cancelActiveFretes: boolean }
): Promise<{ deleted: true; cancelledFretes: number }> {
  const target = await loadUserBasic(id);
  if (!target) throw new UsersServiceError('NOT_FOUND');
  if (isMasterAdmin(target)) {
    throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE');
  }
  const callerId = await getCurrentUserId();
  if (callerId === id) {
    throw new UsersServiceError('SELF_ACTION_FORBIDDEN');
  }
  if (options.confirmedName.trim() !== target.name.trim()) {
    throw new UsersServiceError('INVALID_INPUT', 'Nome de confirmacao nao bate');
  }

  return executeAdminMutation(
    {
      action: 'USER_DELETE',
      targetType: 'users',
      targetId: id,
      before: { user: target },
      after: null,
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_delete_user', {
        p_user_id: id,
        p_cancel_active_fretes: options.cancelActiveFretes,
      });
      if (error) {
        if (error.message.includes('master_admin_immutable')) {
          throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE', undefined, error);
        }
        if (error.message.includes('self_action_forbidden')) {
          throw new UsersServiceError('SELF_ACTION_FORBIDDEN', undefined, error);
        }
        if (error.message.includes('permission_denied')) {
          throw new UsersServiceError('PERMISSION_DENIED', undefined, error);
        }
        throw error;
      }
      const result = data as { deleted: boolean; cancelled_fretes: number };
      return {
        deleted: true as const,
        cancelledFretes: result?.cancelled_fretes ?? 0,
      };
    }
  );
}

// ===================== Reset de senha =====================

function obfuscateEmail(e: string): string {
  const [local, domain] = e.split('@');
  if (!local || !domain) return '****';
  const stars = '*'.repeat(Math.max(0, local.length - 2));
  const lastChar = local.length > 1 ? local[local.length - 1] : '';
  const dStars = '*'.repeat(Math.max(0, domain.length - 5));
  const dTail = domain.slice(-4);
  return `${local[0]}${stars}${lastChar}@${domain[0]}${dStars}${dTail}`;
}

function obfuscatePhone(p: string): string {
  const d = normalizeDigits(p);
  return d.length >= 4 ? `${'*'.repeat(d.length - 4)}${d.slice(-4)}` : '****';
}

export async function requestPasswordReset(id: string): Promise<{ channel: 'email' | 'sms' }> {
  const target = await loadUserBasic(id);
  if (!target) throw new UsersServiceError('NOT_FOUND');
  if (isMasterAdmin(target)) {
    throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE');
  }

  const channel: 'email' | 'sms' | null = target.email ? 'email' : target.phone ? 'sms' : null;

  if (!channel) {
    throw new UsersServiceError('NO_RECOVERY_CHANNEL');
  }

  return executeAdminMutation(
    {
      action: 'USER_PASSWORD_RESET_REQUESTED',
      targetType: 'users',
      targetId: id,
      after: {
        channel,
        target_email_obfuscated: target.email ? obfuscateEmail(target.email) : null,
        target_phone_obfuscated: obfuscatePhone(target.phone),
      },
    },
    async () => {
      // O frontend nao tem privilegios de auth.admin via anon key.
      // Usamos resetPasswordForEmail (publico) que envia email.
      // Para SMS futuro, sera Edge Function.
      if (channel === 'email' && target.email) {
        const { error } = await supabase.auth.resetPasswordForEmail(target.email);
        if (error) throw error;
      }
      // SMS: nao implementado nesta spec; gera log mesmo assim.
      return { channel };
    }
  );
}

// ===================== Force logout via RPC =====================

export async function forceLogout(id: string): Promise<{ revokedTokens: number }> {
  const target = await loadUserBasic(id);
  if (!target) throw new UsersServiceError('NOT_FOUND');
  if (isMasterAdmin(target)) {
    throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE');
  }
  const callerId = await getCurrentUserId();
  if (callerId === id) {
    throw new UsersServiceError('SELF_ACTION_FORBIDDEN');
  }

  return executeAdminMutation(
    {
      action: 'USER_FORCE_LOGOUT',
      targetType: 'users',
      targetId: id,
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_force_logout', {
        p_user_id: id,
      });
      if (error) {
        if (error.message.includes('master_admin_immutable')) {
          throw new UsersServiceError('MASTER_ADMIN_IMMUTABLE', undefined, error);
        }
        if (error.message.includes('self_action_forbidden')) {
          throw new UsersServiceError('SELF_ACTION_FORBIDDEN', undefined, error);
        }
        if (error.message.includes('permission_denied')) {
          throw new UsersServiceError('PERMISSION_DENIED', undefined, error);
        }
        throw error;
      }
      const result = data as { revoked_tokens: number };
      return { revokedTokens: result?.revoked_tokens ?? 0 };
    }
  );
}

// ===================== Bulk =====================

const BULK_LIMIT = 200;
const BULK_CONCURRENCY = 5;

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function bulkToggleActive(ids: string[], targetState: boolean): Promise<BulkResult> {
  if (ids.length > BULK_LIMIT) {
    throw new UsersServiceError('BULK_LIMIT_EXCEEDED');
  }

  const callerId = await getCurrentUserId();
  // Carrega master e estados atuais em batch
  const { data: rows } = await supabase
    .from('users')
    .select('id, admin_username, is_active, updated_at')
    .in('id', ids);

  const byId = new Map<
    string,
    { admin_username: string | null; is_active: boolean; updated_at: string }
  >();
  for (const r of rows ?? []) byId.set(r.id, r);

  const result: BulkResult = { success: [], skipped: [], failed: [] };

  type Task = () => Promise<void>;
  const tasks: Task[] = [];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      result.failed.push({ id, reason: 'NOT_FOUND' });
      continue;
    }
    if (row.admin_username === MASTER_USERNAME) {
      result.skipped.push({ id, reason: 'MASTER_ADMIN_IMMUTABLE' });
      continue;
    }
    if (callerId && id === callerId) {
      result.skipped.push({ id, reason: 'SELF_ACTION_FORBIDDEN' });
      continue;
    }
    if (row.is_active === targetState) {
      result.skipped.push({ id, reason: 'ALREADY_IN_TARGET_STATE' });
      // Audit log de skip
      await logAdminAction({
        action: 'USER_TOGGLE_ACTIVE_SKIPPED',
        targetType: 'users',
        targetId: id,
        after: { reason: 'ALREADY_IN_TARGET_STATE', target_state: targetState },
      }).catch(() => null);
      continue;
    }

    tasks.push(async () => {
      try {
        await toggleActive(id, targetState, row.updated_at);
        result.success.push(id);
      } catch (err) {
        const code = err instanceof UsersServiceError ? err.code : (err as Error).message;
        result.failed.push({ id, reason: code });
      }
    });
  }

  await runWithConcurrency(tasks, BULK_CONCURRENCY);
  return result;
}

// ===================== Export CSV =====================

const EXPORT_LIMIT = 10_000;

export async function exportUsersCSV(
  filters: UsersFilters,
  options: CsvOptions = { separator: ';', withBom: true }
): Promise<{ csv: string; totalExported: number; truncated: boolean }> {
  const allRows: UserRow[] = [];
  let page = 1;
  const pageSize = 1000;
  let total = 0;

  while (allRows.length < EXPORT_LIMIT) {
    const result = await listUsers({ ...filters, page, pageSize });
    total = result.total;
    allRows.push(...result.rows);
    if (result.rows.length < pageSize) break;
    page += 1;
  }

  const limited = allRows.slice(0, EXPORT_LIMIT);
  const truncated = total > EXPORT_LIMIT;
  const csv = exportUsersToCsvString(limited, options);

  await executeAdminMutation(
    {
      action: 'USERS_EXPORT',
      targetType: null,
      targetId: null,
      after: {
        filters,
        total_exported: limited.length,
        requested_limit: EXPORT_LIMIT,
        truncated,
      },
    },
    async () => {
      // No-op: side-effect e o download client-side
    }
  );

  return { csv, totalExported: limited.length, truncated };
}

// ===================== Lista de admins =====================

export async function listAdmins(): Promise<AdminUserRow[]> {
  const { data: admins, error } = await supabase
    .from('users')
    .select('id, name, admin_username, is_active, is_superuser')
    .eq('is_superuser', true)
    .order('name', { ascending: true });

  if (error) throw error;
  if (!admins || admins.length === 0) return [];

  const ids = admins.map((a) => a.id);

  // Roles ativos por usuario
  const { data: rolesData } = await supabase
    .from('admin_roles')
    .select('user_id, role')
    .in('user_id', ids)
    .is('revoked_at', null);

  const rolesByUser = new Map<string, AdminRole[]>();
  for (const r of rolesData ?? []) {
    const arr = rolesByUser.get(r.user_id as string) ?? [];
    arr.push(r.role as AdminRole);
    rolesByUser.set(r.user_id as string, arr);
  }

  // Ultimo login por admin (subquery por id; em volume pequeno e ok)
  const lastLoginById = new Map<string, string | null>();
  for (const a of admins) {
    const { data: log } = await supabase
      .from('admin_audit_logs')
      .select('created_at')
      .eq('admin_id', a.id)
      .eq('action', 'ADMIN_LOGIN_SUCCESS')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastLoginById.set(a.id, log?.created_at ?? null);
  }

  return admins.map((a) => ({
    id: a.id,
    name: a.name,
    admin_username: a.admin_username,
    is_active: a.is_active,
    is_superuser: a.is_superuser,
    roles: rolesByUser.get(a.id) ?? [],
    is_master: a.admin_username === MASTER_USERNAME,
    last_login_at: lastLoginById.get(a.id) ?? null,
  }));
}

export async function countActiveSuperAdmins(): Promise<number> {
  const { data } = await supabase.rpc('count_active_super_admins');
  return typeof data === 'number' ? data : 0;
}
