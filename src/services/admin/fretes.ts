/**
 * admin/fretes.ts
 *
 * Service de gestao de fretes do painel admin.
 * Toda mutacao passa por executeAdminMutation (audit-by-construction).
 * Nenhuma chamada direta a .update/.delete/.insert sem o wrapper.
 *
 * Dependencias: admin-foundation (Permission_Matrix, executeAdminMutation,
 * is_admin_with_permission RPC) e admin-users (users.is_active/ban_reason
 * para validacao de EMBARCADOR_INACTIVE).
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';

// ===================== Tipos publicos =====================

export type FreteStatus = 'ativo' | 'encerrado' | 'cancelado';
export type FreteStatusFilter = 'todos' | FreteStatus;
export type FreteSort = 'created_desc' | 'created_asc' | 'value_desc' | 'value_asc' | 'clicks_desc';

export interface FretesFilters {
  status: FreteStatusFilter;
  embarcadorId: string | null;
  from: string | null;
  to: string | null;
  q: string;
  sort: FreteSort;
  flagged: boolean;
  page: number;
  pageSize: number;
}

export const DEFAULT_FRETES_FILTERS: FretesFilters = {
  status: 'todos',
  embarcadorId: null,
  from: null,
  to: null,
  q: '',
  sort: 'created_desc',
  flagged: false,
  page: 1,
  pageSize: 10,
};

export interface FreteRow {
  id: string;
  embarcador_id: string;
  embarcador_name: string | null;
  embarcador_cnpj: string | null;
  embarcador_company_name: string | null;
  origin: string;
  destination: string;
  cargo_type: string;
  vehicle_type: string;
  weight: number;
  value: number;
  deadline: string;
  loading_time: number;
  unloading_time: number;
  specifications: string | null;
  status: FreteStatus;
  cancel_reason: string | null;
  flagged_for_review: boolean;
  flagged_reason: string | null;
  flagged_at: string | null;
  flagged_by: string | null;
  views_count: number;
  clicks_count: number;
  created_at: string;
  updated_at: string;
}

export interface FretesListResult {
  rows: FreteRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FreteEmbarcadorSnapshot {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  cnpj: string | null;
  company_name: string | null;
  branch_state: string | null;
  branch_city: string | null;
  is_active: boolean;
  ban_reason: string | null;
}

export interface FreteClickRow {
  click_id: string;
  motorista_id: string;
  motorista_name: string;
  motorista_phone: string;
  clicked_at: string;
}

export interface FreteAuditEntry {
  id: string;
  admin_id: string;
  admin_name: string | null;
  action: string;
  created_at: string;
  before_data: unknown;
  after_data: unknown;
}

export interface FreteMetrics {
  views_count: number;
  clicks_count: number;
  days_active: number;
  estimated_conversion: number | null;
}

export interface FreteDetailBundle {
  frete: FreteRow;
  embarcador: FreteEmbarcadorSnapshot | null;
  clicks: FreteClickRow[];
  clicksTotal: number;
  clicksPage: number;
  clicksPageSize: number;
  metrics: FreteMetrics;
  history: FreteAuditEntry[];
  errors: Partial<Record<'embarcador' | 'clicks' | 'history', string>>;
}

export interface FretesAlerts {
  flaggedCount: number;
  expiredActiveCount: number;
  noClicksRecentCount: number;
}

export type BulkSkipReason =
  | 'ALREADY_IN_TARGET_STATE'
  | 'INVALID_STATUS_TRANSITION'
  | 'EMBARCADOR_INACTIVE';

export interface BulkResult {
  success: string[];
  skipped: { id: string; reason: BulkSkipReason }[];
  failed: { id: string; reason: string }[];
}

export type FretesErrorCode =
  | 'STALE_VERSION'
  | 'EMBARCADOR_INACTIVE'
  | 'INVALID_INPUT'
  | 'INVALID_STATUS_TRANSITION'
  | 'TERMINAL_STATE_FIELD_LOCKED'
  | 'DEADLINE_IN_PAST'
  | 'ALREADY_CLOSED'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'BULK_LIMIT_EXCEEDED';

export class FretesServiceError extends Error {
  constructor(
    public code: FretesErrorCode,
    message?: string,
    public cause?: unknown
  ) {
    super(message ?? code);
    this.name = 'FretesServiceError';
  }
}

export const FRETES_ERROR_MESSAGES: Record<FretesErrorCode, string> = {
  STALE_VERSION: 'Os dados foram alterados por outro admin. Recarregue antes de salvar.',
  EMBARCADOR_INACTIVE: 'Embarcador esta desativado ou banido. Reative o embarcador antes.',
  INVALID_INPUT: 'Dados invalidos.',
  INVALID_STATUS_TRANSITION: 'Transicao de status nao permitida.',
  TERMINAL_STATE_FIELD_LOCKED: 'Frete em estado terminal nao permite alterar este campo.',
  DEADLINE_IN_PAST: 'Prazo deve ser igual ou maior que hoje.',
  ALREADY_CLOSED: 'Frete ja esta encerrado.',
  NOT_FOUND: 'Frete nao encontrado.',
  PERMISSION_DENIED: 'Operacao nao permitida.',
  BULK_LIMIT_EXCEEDED: 'Maximo de 200 fretes por operacao.',
};

export interface EditFretePayload {
  origin: string;
  origin_lat: number;
  origin_lng: number;
  destination: string;
  destination_lat: number;
  destination_lng: number;
  cargo_type: string;
  vehicle_type: string;
  weight: number;
  value: number;
  deadline: string;
  loading_time: number;
  unloading_time: number;
  specifications: string | null;
}

export const SPECIFICATIONS_PLACEHOLDER = '[Conteudo removido por moderacao]';

// ===================== Helpers puros =====================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_REGEX.test(s);
}

export function classifyFreteStatus(f: Pick<FreteRow, 'status'>): FreteStatus {
  return f.status;
}

export function calculateMetrics(args: {
  views_count: number;
  clicks_count: number;
  created_at: string;
  now?: Date;
}): FreteMetrics {
  const now = args.now ?? new Date();
  const created = new Date(args.created_at);
  const diffMs = now.getTime() - created.getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));

  let conversion: number | null = null;
  if (args.views_count > 0) {
    const ratio = (args.clicks_count / args.views_count) * 100;
    conversion = Math.round(ratio * 100) / 100;
  }

  return {
    views_count: args.views_count,
    clicks_count: args.clicks_count,
    days_active: days,
    estimated_conversion: conversion,
  };
}

function csvField(v: unknown, sep: string): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  const needsQuoting = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(sep);
  if (needsQuoting) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const FRETES_CSV_HEADER = [
  'id',
  'status',
  'origin',
  'destination',
  'cargo_type',
  'vehicle_type',
  'weight',
  'value',
  'deadline',
  'embarcador_id',
  'embarcador_name',
  'embarcador_company_name',
  'views_count',
  'clicks_count',
  'flagged_for_review',
  'cancel_reason',
  'created_at',
  'updated_at',
] as const;

export function exportFretesToCsvString(rows: FreteRow[]): string {
  const sep = ';';
  const bom = '\uFEFF';
  const header = FRETES_CSV_HEADER.join(sep);
  const body = rows
    .map((r) =>
      [
        r.id,
        r.status,
        r.origin,
        r.destination,
        r.cargo_type,
        r.vehicle_type,
        r.weight,
        r.value,
        r.deadline,
        r.embarcador_id,
        r.embarcador_name,
        r.embarcador_company_name,
        r.views_count,
        r.clicks_count,
        r.flagged_for_review ? 'true' : 'false',
        r.cancel_reason,
        r.created_at,
        r.updated_at,
      ]
        .map((v) => csvField(v, sep))
        .join(sep)
    )
    .join('\r\n');
  return bom + (rows.length > 0 ? `${header}\r\n${body}` : header);
}

function escapeOr(s: string): string {
  return s.replace(/,/g, '\\,').replace(/%/g, '\\%');
}

// ===================== URL <-> filtros =====================

const VALID_STATUSES: FreteStatusFilter[] = ['todos', 'ativo', 'encerrado', 'cancelado'];
const VALID_SORTS: FreteSort[] = [
  'created_desc',
  'created_asc',
  'value_desc',
  'value_asc',
  'clicks_desc',
];

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(s: string | null): string | null {
  if (s == null || !ISO_DATE_REGEX.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

export function parseFretesFiltersFromQuery(qs: URLSearchParams | string): FretesFilters {
  const sp = typeof qs === 'string' ? new URLSearchParams(qs) : qs;
  const status = sp.get('status') as FreteStatusFilter | null;
  const sort = sp.get('sort') as FreteSort | null;
  const embarcadorRaw = sp.get('embarcador');
  const embarcadorId = embarcadorRaw && isUuid(embarcadorRaw) ? embarcadorRaw : null;
  const page = parseInt(sp.get('page') ?? '', 10);
  const pageSizeRaw = parseInt(sp.get('pageSize') ?? '', 10);
  const pageSize = [10, 50, 100].includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_FRETES_FILTERS.pageSize;
  const flagged = sp.get('flagged') === '1' || sp.get('flagged') === 'true';

  return {
    status: status && VALID_STATUSES.includes(status) ? status : DEFAULT_FRETES_FILTERS.status,
    embarcadorId,
    from: parseIsoDate(sp.get('from')),
    to: parseIsoDate(sp.get('to')),
    q: sp.get('q') ?? DEFAULT_FRETES_FILTERS.q,
    sort: sort && VALID_SORTS.includes(sort) ? sort : DEFAULT_FRETES_FILTERS.sort,
    flagged,
    page: Number.isFinite(page) && page >= 1 ? page : DEFAULT_FRETES_FILTERS.page,
    pageSize,
  };
}

export function serializeFretesFiltersToQuery(f: FretesFilters): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set('status', f.status);
  if (f.embarcadorId) sp.set('embarcador', f.embarcadorId);
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  sp.set('q', f.q);
  sp.set('sort', f.sort);
  if (f.flagged) sp.set('flagged', '1');
  sp.set('page', String(f.page));
  sp.set('pageSize', String(f.pageSize));
  return sp;
}

// ===================== Listagem =====================

interface FreteDbRow {
  id: string;
  embarcador_id: string;
  origin: string;
  destination: string;
  cargo_type: string;
  vehicle_type: string;
  weight: number;
  value: number;
  deadline: string;
  loading_time: number;
  unloading_time: number;
  specifications: string | null;
  status: FreteStatus;
  cancel_reason: string | null;
  flagged_for_review: boolean;
  flagged_reason: string | null;
  flagged_at: string | null;
  flagged_by: string | null;
  views_count: number;
  clicks_count: number;
  created_at: string;
  updated_at: string;
}

function dbRowToFreteRow(
  r: FreteDbRow,
  enrich?: { name?: string | null; cnpj?: string | null; company_name?: string | null }
): FreteRow {
  return {
    id: r.id,
    embarcador_id: r.embarcador_id,
    embarcador_name: enrich?.name ?? null,
    embarcador_cnpj: enrich?.cnpj ?? null,
    embarcador_company_name: enrich?.company_name ?? null,
    origin: r.origin,
    destination: r.destination,
    cargo_type: r.cargo_type,
    vehicle_type: r.vehicle_type,
    weight: r.weight,
    value: r.value,
    deadline: r.deadline,
    loading_time: r.loading_time,
    unloading_time: r.unloading_time,
    specifications: r.specifications,
    status: r.status,
    cancel_reason: r.cancel_reason,
    flagged_for_review: r.flagged_for_review,
    flagged_reason: r.flagged_reason,
    flagged_at: r.flagged_at,
    flagged_by: r.flagged_by,
    views_count: r.views_count,
    clicks_count: r.clicks_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Select plano sem embeds — enriquecimento de nome/cnpj e feito em batch
// porque o PostgREST nao consegue desambiguar aninhamento embarcadores->users.
const FRETE_SELECT_COLS = `
  id, embarcador_id, origin, destination, cargo_type, vehicle_type,
  weight, value, deadline, loading_time, unloading_time, specifications,
  status, cancel_reason, flagged_for_review, flagged_reason, flagged_at,
  flagged_by, views_count, clicks_count, created_at, updated_at
`;

async function enrichFretesWithEmbarcador(rows: FreteRow[]): Promise<FreteRow[]> {
  if (rows.length === 0) return rows;
  const ids = Array.from(new Set(rows.map((r) => r.embarcador_id)));

  const [usersRes, embsRes] = await Promise.allSettled([
    supabase.from('users').select('id, name').in('id', ids),
    supabase.from('embarcadores').select('id, cnpj, company_name').in('id', ids),
  ]);

  const nameMap = new Map<string, string | null>();
  if (usersRes.status === 'fulfilled' && !usersRes.value.error) {
    for (const u of (usersRes.value.data ?? []) as Array<{
      id: string;
      name: string | null;
    }>) {
      nameMap.set(u.id, u.name);
    }
  }

  const embMap = new Map<string, { cnpj: string | null; company_name: string | null }>();
  if (embsRes.status === 'fulfilled' && !embsRes.value.error) {
    for (const e of (embsRes.value.data ?? []) as Array<{
      id: string;
      cnpj: string | null;
      company_name: string | null;
    }>) {
      embMap.set(e.id, { cnpj: e.cnpj, company_name: e.company_name });
    }
  }

  return rows.map((r) => {
    const emb = embMap.get(r.embarcador_id);
    return {
      ...r,
      embarcador_name: nameMap.get(r.embarcador_id) ?? null,
      embarcador_cnpj: emb?.cnpj ?? null,
      embarcador_company_name: emb?.company_name ?? null,
    };
  });
}

export async function listFretes(filters: FretesFilters): Promise<FretesListResult> {
  let query = supabase.from('fretes').select(FRETE_SELECT_COLS, { count: 'exact' });

  if (filters.status !== 'todos') {
    query = query.eq('status', filters.status);
  }
  if (filters.embarcadorId) {
    query = query.eq('embarcador_id', filters.embarcadorId);
  }
  if (filters.from) {
    query = query.gte('created_at', `${filters.from}T00:00:00Z`);
  }
  if (filters.to) {
    query = query.lte('created_at', `${filters.to}T23:59:59Z`);
  }
  if (filters.flagged) {
    query = query.eq('flagged_for_review', true);
  }
  if (filters.q.trim()) {
    const q = escapeOr(filters.q.trim());
    query = query.or(`origin.ilike.%${q}%,destination.ilike.%${q}%,cargo_type.ilike.%${q}%`);
  }

  const orderMap: Record<FreteSort, [string, { ascending: boolean }]> = {
    created_desc: ['created_at', { ascending: false }],
    created_asc: ['created_at', { ascending: true }],
    value_desc: ['value', { ascending: false }],
    value_asc: ['value', { ascending: true }],
    clicks_desc: ['clicks_count', { ascending: false }],
  };
  const [col, opts] = orderMap[filters.sort];
  query = query.order(col, opts);

  const from = (filters.page - 1) * filters.pageSize;
  query = query.range(from, from + filters.pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  const baseRows = ((data ?? []) as unknown as FreteDbRow[]).map((r) => dbRowToFreteRow(r));
  const rows = await enrichFretesWithEmbarcador(baseRows);
  return {
    rows,
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

// ===================== Alertas =====================

export async function getAlerts(): Promise<FretesAlerts> {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [flaggedRes, expiredRes, noClicksRes] = await Promise.allSettled([
    supabase
      .from('fretes')
      .select('id', { count: 'exact', head: true })
      .eq('flagged_for_review', true),
    supabase
      .from('fretes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ativo')
      .lt('deadline', today),
    supabase
      .from('fretes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ativo')
      .eq('clicks_count', 0)
      .lt('created_at', sevenDaysAgo),
  ]);

  const getCount = (
    res: PromiseSettledResult<{ count: number | null; error: unknown }>
  ): number => {
    if (res.status !== 'fulfilled' || res.value.error) return 0;
    return res.value.count ?? 0;
  };

  return {
    flaggedCount: getCount(flaggedRes),
    expiredActiveCount: getCount(expiredRes),
    noClicksRecentCount: getCount(noClicksRes),
  };
}

// ===================== Detalhe =====================

const CLICKS_PAGE_SIZE = 10;

export async function getFreteDetail(
  id: string,
  clicksPage: number = 1
): Promise<FreteDetailBundle> {
  if (!isUuid(id)) {
    throw new FretesServiceError('NOT_FOUND');
  }

  // 1) Frete principal
  const { data: freteData, error: freteErr } = await supabase
    .from('fretes')
    .select(FRETE_SELECT_COLS)
    .eq('id', id)
    .maybeSingle();

  if (freteErr || !freteData) {
    throw new FretesServiceError('NOT_FOUND', undefined, freteErr);
  }
  const freteBase = dbRowToFreteRow(freteData as unknown as FreteDbRow);
  const [frete] = await enrichFretesWithEmbarcador([freteBase]);

  const errors: FreteDetailBundle['errors'] = {};

  // 2) Embarcador snapshot, cliques paginados, contagem total, history
  const clicksFrom = (clicksPage - 1) * CLICKS_PAGE_SIZE;

  const [embRes, clicksRes, historyRes] = await Promise.allSettled([
    (async () => {
      const userRes = await supabase
        .from('users')
        .select('id, name, email, phone, is_active, ban_reason')
        .eq('id', frete.embarcador_id)
        .maybeSingle();
      if (userRes.error || !userRes.data) {
        return { data: null, error: userRes.error };
      }
      const embRow = await supabase
        .from('embarcadores')
        .select('cnpj, company_name, branch_state, branch_city')
        .eq('id', frete.embarcador_id)
        .maybeSingle();
      return {
        data: {
          ...userRes.data,
          embarcadores: embRow.data ?? null,
        },
        error: null,
      };
    })(),
    supabase
      .from('frete_clicks')
      .select('id, motorista_id, clicked_at', {
        count: 'exact',
      })
      .eq('frete_id', id)
      .order('clicked_at', { ascending: false })
      .range(clicksFrom, clicksFrom + CLICKS_PAGE_SIZE - 1),
    supabase
      .from('admin_audit_logs')
      .select('id, admin_id, action, created_at, before_data, after_data, users:admin_id(name)')
      .eq('target_type', 'fretes')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  let embarcador: FreteEmbarcadorSnapshot | null = null;
  if (embRes.status === 'fulfilled' && embRes.value.data) {
    const u = embRes.value.data as unknown as {
      id: string;
      name: string;
      email: string | null;
      phone: string;
      is_active: boolean;
      ban_reason: string | null;
      embarcadores: {
        cnpj: string | null;
        company_name: string | null;
        branch_state: string | null;
        branch_city: string | null;
      } | null;
    };
    embarcador = {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      cnpj: u.embarcadores?.cnpj ?? null,
      company_name: u.embarcadores?.company_name ?? null,
      branch_state: u.embarcadores?.branch_state ?? null,
      branch_city: u.embarcadores?.branch_city ?? null,
      is_active: u.is_active,
      ban_reason: u.ban_reason,
    };
  } else if (embRes.status === 'rejected') {
    errors.embarcador = String(embRes.reason);
  }

  let clicks: FreteClickRow[] = [];
  let clicksTotal = 0;
  if (clicksRes.status === 'fulfilled' && !clicksRes.value.error) {
    clicksTotal = clicksRes.value.count ?? 0;
    type ClickDb = {
      id: string;
      motorista_id: string;
      clicked_at: string;
    };
    const clickRows = (clicksRes.value.data ?? []) as unknown as ClickDb[];
    const motoristaIds = Array.from(new Set(clickRows.map((c) => c.motorista_id)));
    const userMap = new Map<string, { name: string; phone: string }>();
    if (motoristaIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name, phone')
        .in('id', motoristaIds);
      for (const u of (usersData ?? []) as Array<{
        id: string;
        name: string;
        phone: string;
      }>) {
        userMap.set(u.id, { name: u.name, phone: u.phone });
      }
    }
    clicks = clickRows.map((c) => {
      const u = userMap.get(c.motorista_id);
      return {
        click_id: c.id,
        motorista_id: c.motorista_id,
        motorista_name: u?.name ?? '—',
        motorista_phone: u?.phone ?? '—',
        clicked_at: c.clicked_at,
      };
    });
  } else {
    errors.clicks = 'Falha ao carregar cliques';
  }

  let history: FreteAuditEntry[] = [];
  if (historyRes.status === 'fulfilled' && !historyRes.value.error) {
    type HistDb = {
      id: string;
      admin_id: string;
      action: string;
      created_at: string;
      before_data: unknown;
      after_data: unknown;
      users: { name: string } | { name: string }[] | null;
    };
    history = ((historyRes.value.data ?? []) as unknown as HistDb[]).map((h) => {
      const u = Array.isArray(h.users) ? h.users[0] : h.users;
      return {
        id: h.id,
        admin_id: h.admin_id,
        admin_name: u?.name ?? null,
        action: h.action,
        created_at: h.created_at,
        before_data: h.before_data,
        after_data: h.after_data,
      };
    });
  } else {
    errors.history = 'Falha ao carregar historico';
  }

  const metrics = calculateMetrics({
    views_count: frete.views_count,
    clicks_count: frete.clicks_count,
    created_at: frete.created_at,
  });

  return {
    frete,
    embarcador,
    clicks,
    clicksTotal,
    clicksPage,
    clicksPageSize: CLICKS_PAGE_SIZE,
    metrics,
    history,
    errors,
  };
}

// ===================== Mutacoes — helpers =====================

async function loadFreteRow(id: string): Promise<FreteRow | null> {
  const { data } = await supabase
    .from('fretes')
    .select(FRETE_SELECT_COLS)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const base = dbRowToFreteRow(data as unknown as FreteDbRow);
  const [enriched] = await enrichFretesWithEmbarcador([base]);
  return enriched;
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Notifica o embarcador quando admin edita/cancela/exclui um frete.
 * Best-effort — não bloqueia a mutação principal.
 */
async function notifyEmbarcadorAboutFrete(
  embarcadorId: string,
  kind: 'edit' | 'cancel' | 'delete',
  freteSummary: string,
  reason: string | null
): Promise<void> {
  const titles: Record<typeof kind, string> = {
    edit: 'Frete editado pela equipe FreteGO',
    cancel: 'Frete cancelado pela equipe FreteGO',
    delete: 'Frete excluído pela equipe FreteGO',
  };
  const messages: Record<typeof kind, string> = {
    edit: `Seu frete (${freteSummary}) foi editado por motivos internos da nossa equipe.`,
    cancel: `Seu frete (${freteSummary}) foi cancelado por motivos internos da nossa equipe${reason ? `: ${reason}` : '.'}`,
    delete: `Seu frete (${freteSummary}) foi excluído por motivos internos da nossa equipe.`,
  };
  try {
    await supabase.rpc('admin_notify_user', {
      p_user_id: embarcadorId,
      p_type: 'admin_action',
      p_title: titles[kind],
      p_message: messages[kind],
      p_link: '/embarcador',
    });
  } catch {
    // best-effort, não bloqueia
  }
}

// ===================== editFrete (versionamento otimista) =====================

const TODAY = (): string => new Date().toISOString().slice(0, 10);

function validateEditPayload(data: EditFretePayload): void {
  if (!data.origin || data.origin.trim().length === 0) {
    throw new FretesServiceError('INVALID_INPUT', 'Origem obrigatoria');
  }
  if (!data.destination || data.destination.trim().length === 0) {
    throw new FretesServiceError('INVALID_INPUT', 'Destino obrigatorio');
  }
  if (!(data.weight > 0)) {
    throw new FretesServiceError('INVALID_INPUT', 'Peso deve ser positivo');
  }
  if (!(data.value > 0)) {
    throw new FretesServiceError('INVALID_INPUT', 'Valor deve ser positivo');
  }
  if (data.deadline < TODAY()) {
    throw new FretesServiceError('DEADLINE_IN_PAST');
  }
  if (data.loading_time < 0 || data.unloading_time < 0) {
    throw new FretesServiceError('INVALID_INPUT', 'Tempos devem ser >= 0');
  }
  if (data.specifications && data.specifications.length > 2000) {
    throw new FretesServiceError('INVALID_INPUT', 'Especificacoes ate 2000 chars');
  }
}

export async function editFrete(
  id: string,
  data: EditFretePayload,
  expectedUpdatedAt: string
): Promise<FreteRow> {
  validateEditPayload(data);

  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');
  if (target.status === 'cancelado') {
    throw new FretesServiceError('TERMINAL_STATE_FIELD_LOCKED');
  }

  const patch = {
    origin: data.origin,
    destination: data.destination,
    cargo_type: data.cargo_type,
    vehicle_type: data.vehicle_type,
    weight: data.weight,
    value: data.value,
    deadline: data.deadline,
    loading_time: data.loading_time,
    unloading_time: data.unloading_time,
    specifications: data.specifications,
    updated_at: new Date().toISOString(),
  };

  return executeAdminMutation(
    {
      action: 'FRETE_EDIT',
      targetType: 'fretes',
      targetId: id,
      before: {
        origin: target.origin,
        destination: target.destination,
        cargo_type: target.cargo_type,
        vehicle_type: target.vehicle_type,
        weight: target.weight,
        value: target.value,
        deadline: target.deadline,
        loading_time: target.loading_time,
        unloading_time: target.unloading_time,
        specifications: target.specifications,
      },
      after: patch,
    },
    async () => {
      const { data: row, error } = await supabase
        .from('fretes')
        .update(patch)
        .eq('id', id)
        .eq('updated_at', expectedUpdatedAt)
        .select(FRETE_SELECT_COLS)
        .maybeSingle();

      if (error) throw error;
      if (!row) {
        await logAdminAction({
          action: 'FRETE_EDIT_STALE_VERSION',
          targetType: 'fretes',
          targetId: id,
          before: { expectedUpdatedAt },
        }).catch(() => null);
        throw new FretesServiceError('STALE_VERSION');
      }
      const base = dbRowToFreteRow(row as unknown as FreteDbRow);
      const [enriched] = await enrichFretesWithEmbarcador([base]);
      await notifyEmbarcadorAboutFrete(
        enriched.embarcador_id,
        'edit',
        `${enriched.origin} → ${enriched.destination}`,
        null
      );
      return enriched;
    }
  );
}

// ===================== forceCloseFrete (idempotente) =====================

export async function forceCloseFrete(
  id: string
): Promise<{ ok: true } | { skipped: true; reason: 'ALREADY_IN_TARGET_STATE' }> {
  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');

  if (target.status === 'encerrado') {
    await logAdminAction({
      action: 'FRETE_FORCE_CLOSE_SKIPPED',
      targetType: 'fretes',
      targetId: id,
      before: { status: 'encerrado' },
      after: { reason: 'ALREADY_IN_TARGET_STATE' },
    }).catch(() => null);
    return { skipped: true, reason: 'ALREADY_IN_TARGET_STATE' };
  }

  if (target.status === 'cancelado') {
    throw new FretesServiceError('INVALID_STATUS_TRANSITION');
  }

  await executeAdminMutation(
    {
      action: 'FRETE_FORCE_CLOSE',
      targetType: 'fretes',
      targetId: id,
      before: { status: 'ativo' },
      after: { status: 'encerrado' },
    },
    async () => {
      const { error } = await supabase
        .from('fretes')
        .update({ status: 'encerrado', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    }
  );
  return { ok: true };
}

// ===================== cancelFrete (motivo obrigatorio) =====================

function validateReason(
  reason: unknown,
  max: number,
  code: FretesErrorCode = 'INVALID_INPUT'
): string {
  if (typeof reason !== 'string') {
    throw new FretesServiceError(code, 'Motivo obrigatorio');
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new FretesServiceError(code, 'Motivo obrigatorio');
  }
  if (trimmed.length > max) {
    throw new FretesServiceError(code, `Motivo ate ${max} chars`);
  }
  return trimmed;
}

export async function cancelFrete(
  id: string,
  reason: string
): Promise<{ ok: true } | { skipped: true; reason: 'ALREADY_IN_TARGET_STATE' }> {
  // Validacao ANTES de qualquer chamada ao banco (CP-2)
  const reasonClean = validateReason(reason, 1000);

  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');

  if (target.status === 'cancelado') {
    await logAdminAction({
      action: 'FRETE_FORCE_CANCEL_SKIPPED',
      targetType: 'fretes',
      targetId: id,
      before: { status: 'cancelado' },
      after: { reason: 'ALREADY_IN_TARGET_STATE' },
    }).catch(() => null);
    return { skipped: true, reason: 'ALREADY_IN_TARGET_STATE' };
  }

  await executeAdminMutation(
    {
      action: 'FRETE_FORCE_CANCEL',
      targetType: 'fretes',
      targetId: id,
      before: { status: target.status, cancel_reason: target.cancel_reason },
      after: { status: 'cancelado', cancel_reason: reasonClean },
    },
    async () => {
      const { error } = await supabase
        .from('fretes')
        .update({
          status: 'cancelado',
          cancel_reason: reasonClean,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    }
  );
  await notifyEmbarcadorAboutFrete(
    target.embarcador_id,
    'cancel',
    `${target.origin} → ${target.destination}`,
    reasonClean
  );
  return { ok: true };
}

// ===================== reactivateFrete (bloqueia EMBARCADOR_INACTIVE) =====================

export async function reactivateFrete(
  id: string
): Promise<{ ok: true } | { skipped: true; reason: 'ALREADY_IN_TARGET_STATE' }> {
  // Sem embeds aninhados (PostgREST nao desambigua embarcadores->users).
  const { data, error } = await supabase
    .from('fretes')
    .select('status, embarcador_id')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) throw new FretesServiceError('NOT_FOUND');

  const row = data as { status: FreteStatus; embarcador_id: string };

  // Busca status do embarcador via users (PK = users.id)
  const { data: userData, error: userErr } = await supabase
    .from('users')
    .select('is_active, ban_reason')
    .eq('id', row.embarcador_id)
    .maybeSingle();

  if (userErr || !userData) {
    throw new FretesServiceError('NOT_FOUND');
  }
  const u = userData as { is_active: boolean; ban_reason: string | null };

  if (!u.is_active || u.ban_reason) {
    throw new FretesServiceError('EMBARCADOR_INACTIVE');
  }

  if (row.status === 'ativo') {
    await logAdminAction({
      action: 'FRETE_REACTIVATE_SKIPPED',
      targetType: 'fretes',
      targetId: id,
      before: { status: 'ativo' },
      after: { reason: 'ALREADY_IN_TARGET_STATE' },
    }).catch(() => null);
    return { skipped: true, reason: 'ALREADY_IN_TARGET_STATE' };
  }

  await executeAdminMutation(
    {
      action: 'FRETE_REACTIVATE',
      targetType: 'fretes',
      targetId: id,
      before: { status: row.status },
      after: { status: 'ativo' },
    },
    async () => {
      const { error: upErr } = await supabase
        .from('fretes')
        .update({
          status: 'ativo',
          cancel_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (upErr) throw upErr;
    }
  );
  return { ok: true };
}

// ===================== deleteFrete via RPC =====================

export async function deleteFrete(
  id: string,
  options: { confirmedKeyword: 'EXCLUIR' }
): Promise<{ deleted: true; clicksDeleted: number }> {
  if (options.confirmedKeyword !== 'EXCLUIR') {
    throw new FretesServiceError('INVALID_INPUT', 'Confirmacao invalida');
  }

  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');

  // Pre-fetch contagem de cliques para o snapshot
  const { count: clicksBefore } = await supabase
    .from('frete_clicks')
    .select('id', { count: 'exact', head: true })
    .eq('frete_id', id);

  return executeAdminMutation(
    {
      action: 'FRETE_DELETE',
      targetType: 'fretes',
      targetId: id,
      before: { frete: target, clicks_count: clicksBefore ?? 0 },
      after: null,
    },
    async () => {
      const { data, error } = await supabase.rpc('admin_delete_frete', {
        p_frete_id: id,
      });
      if (error) {
        if (error.message.includes('permission_denied')) {
          throw new FretesServiceError('PERMISSION_DENIED', undefined, error);
        }
        if (error.message.includes('not_found')) {
          throw new FretesServiceError('NOT_FOUND', undefined, error);
        }
        throw error;
      }
      const result = data as { deleted: boolean; clicks_deleted: number };
      const clicksDeleted = result?.clicks_deleted ?? 0;

      // Log secundario com a contagem de cascade
      await logAdminAction({
        action: 'FRETE_DELETE_CASCADE_CLICKS',
        targetType: 'fretes',
        targetId: id,
        after: { clicks_deleted: clicksDeleted },
      }).catch(() => null);

      // Notifica embarcador (best-effort)
      await notifyEmbarcadorAboutFrete(
        target.embarcador_id,
        'delete',
        `${target.origin} → ${target.destination}`,
        null
      );

      return { deleted: true as const, clicksDeleted };
    }
  );
}

// ===================== flagFrete / unflagFrete =====================

export async function flagFrete(id: string, reason: string): Promise<{ ok: true }> {
  const reasonClean = validateReason(reason, 500);
  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');

  const adminId = await getCurrentUserId();

  await executeAdminMutation(
    {
      action: 'FRETE_FLAGGED',
      targetType: 'fretes',
      targetId: id,
      before: { flagged_for_review: target.flagged_for_review },
      after: { flagged_for_review: true, flagged_reason: reasonClean },
    },
    async () => {
      const { error } = await supabase
        .from('fretes')
        .update({
          flagged_for_review: true,
          flagged_reason: reasonClean,
          flagged_at: new Date().toISOString(),
          flagged_by: adminId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    }
  );
  return { ok: true };
}

export async function unflagFrete(id: string): Promise<{ ok: true }> {
  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');

  await executeAdminMutation(
    {
      action: 'FRETE_UNFLAGGED',
      targetType: 'fretes',
      targetId: id,
      before: {
        flagged_for_review: true,
        flagged_reason: target.flagged_reason,
      },
      after: { flagged_for_review: false },
    },
    async () => {
      const { error } = await supabase
        .from('fretes')
        .update({
          flagged_for_review: false,
          flagged_reason: null,
          flagged_at: null,
          flagged_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    }
  );
  return { ok: true };
}

// ===================== moderateSpecifications (idempotente) =====================

export async function moderateSpecifications(
  id: string
): Promise<{ ok: true } | { skipped: true; reason: 'ALREADY_MODERATED' }> {
  const target = await loadFreteRow(id);
  if (!target) throw new FretesServiceError('NOT_FOUND');

  if (target.specifications === SPECIFICATIONS_PLACEHOLDER) {
    await logAdminAction({
      action: 'FRETE_CONTENT_MODERATED_SKIPPED',
      targetType: 'fretes',
      targetId: id,
      before: { specifications: SPECIFICATIONS_PLACEHOLDER },
      after: { reason: 'ALREADY_MODERATED' },
    }).catch(() => null);
    return { skipped: true, reason: 'ALREADY_MODERATED' };
  }

  await executeAdminMutation(
    {
      action: 'FRETE_CONTENT_MODERATED',
      targetType: 'fretes',
      targetId: id,
      before: { specifications: target.specifications },
      after: { specifications: SPECIFICATIONS_PLACEHOLDER },
    },
    async () => {
      const { error } = await supabase
        .from('fretes')
        .update({
          specifications: SPECIFICATIONS_PLACEHOLDER,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    }
  );
  return { ok: true };
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

export async function bulkClose(ids: string[]): Promise<BulkResult> {
  if (ids.length > BULK_LIMIT) {
    throw new FretesServiceError('BULK_LIMIT_EXCEEDED');
  }

  // Pre-fetch de status
  const { data: rows } = await supabase.from('fretes').select('id, status').in('id', ids);
  const statusById = new Map<string, FreteStatus>();
  for (const r of rows ?? []) statusById.set(r.id, r.status as FreteStatus);

  const result: BulkResult = { success: [], skipped: [], failed: [] };
  const tasks: Array<() => Promise<void>> = [];

  for (const id of ids) {
    const status = statusById.get(id);
    if (!status) {
      result.failed.push({ id, reason: 'NOT_FOUND' });
      continue;
    }
    if (status === 'encerrado') {
      result.skipped.push({ id, reason: 'ALREADY_IN_TARGET_STATE' });
      await logAdminAction({
        action: 'FRETE_FORCE_CLOSE_SKIPPED',
        targetType: 'fretes',
        targetId: id,
        before: { status },
        after: { reason: 'ALREADY_IN_TARGET_STATE' },
      }).catch(() => null);
      continue;
    }
    if (status === 'cancelado') {
      result.skipped.push({ id, reason: 'INVALID_STATUS_TRANSITION' });
      await logAdminAction({
        action: 'FRETE_FORCE_CLOSE_SKIPPED',
        targetType: 'fretes',
        targetId: id,
        before: { status },
        after: { reason: 'INVALID_STATUS_TRANSITION' },
      }).catch(() => null);
      continue;
    }
    tasks.push(async () => {
      try {
        await executeAdminMutation(
          {
            action: 'FRETE_FORCE_CLOSE',
            targetType: 'fretes',
            targetId: id,
            before: { status: 'ativo' },
            after: { status: 'encerrado' },
          },
          async () => {
            const { error } = await supabase
              .from('fretes')
              .update({
                status: 'encerrado',
                updated_at: new Date().toISOString(),
              })
              .eq('id', id);
            if (error) throw error;
          }
        );
        result.success.push(id);
      } catch (err) {
        const code = err instanceof FretesServiceError ? err.code : (err as Error).message;
        result.failed.push({ id, reason: code });
      }
    });
  }

  await runWithConcurrency(tasks, BULK_CONCURRENCY);
  return result;
}

export async function bulkCancel(ids: string[], reason: string): Promise<BulkResult> {
  if (ids.length > BULK_LIMIT) {
    throw new FretesServiceError('BULK_LIMIT_EXCEEDED');
  }
  const reasonClean = validateReason(reason, 1000);

  const { data: rows } = await supabase.from('fretes').select('id, status').in('id', ids);
  const statusById = new Map<string, FreteStatus>();
  for (const r of rows ?? []) statusById.set(r.id, r.status as FreteStatus);

  const result: BulkResult = { success: [], skipped: [], failed: [] };
  const tasks: Array<() => Promise<void>> = [];

  for (const id of ids) {
    const status = statusById.get(id);
    if (!status) {
      result.failed.push({ id, reason: 'NOT_FOUND' });
      continue;
    }
    if (status === 'cancelado') {
      result.skipped.push({ id, reason: 'ALREADY_IN_TARGET_STATE' });
      await logAdminAction({
        action: 'FRETE_FORCE_CANCEL_SKIPPED',
        targetType: 'fretes',
        targetId: id,
        before: { status },
        after: { reason: 'ALREADY_IN_TARGET_STATE' },
      }).catch(() => null);
      continue;
    }
    tasks.push(async () => {
      try {
        await executeAdminMutation(
          {
            action: 'FRETE_FORCE_CANCEL',
            targetType: 'fretes',
            targetId: id,
            before: { status, cancel_reason: null },
            after: { status: 'cancelado', cancel_reason: reasonClean },
          },
          async () => {
            const { error } = await supabase
              .from('fretes')
              .update({
                status: 'cancelado',
                cancel_reason: reasonClean,
                updated_at: new Date().toISOString(),
              })
              .eq('id', id);
            if (error) throw error;
          }
        );
        result.success.push(id);
      } catch (err) {
        const code = err instanceof FretesServiceError ? err.code : (err as Error).message;
        result.failed.push({ id, reason: code });
      }
    });
  }

  await runWithConcurrency(tasks, BULK_CONCURRENCY);
  return result;
}

// ===================== Export CSV =====================

const EXPORT_LIMIT = 10_000;

export async function exportFretesCSV(
  filters: FretesFilters
): Promise<{ csv: string; totalExported: number; truncated: boolean }> {
  const allRows: FreteRow[] = [];
  let page = 1;
  const pageSize = 1000;
  let total = 0;

  while (allRows.length < EXPORT_LIMIT) {
    const result = await listFretes({ ...filters, page, pageSize });
    total = result.total;
    allRows.push(...result.rows);
    if (result.rows.length < pageSize) break;
    page += 1;
  }

  const limited = allRows.slice(0, EXPORT_LIMIT);
  const truncated = total > EXPORT_LIMIT;
  const csv = exportFretesToCsvString(limited);

  await executeAdminMutation(
    {
      action: 'FRETES_EXPORT',
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
      // No-op
    }
  );

  return { csv, totalExported: limited.length, truncated };
}
