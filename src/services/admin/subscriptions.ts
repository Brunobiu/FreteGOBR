/**
 * admin/subscriptions.ts
 *
 * Service do módulo Assinaturas do painel admin (spec assinaturas-pagamento,
 * Fase 6). Listagem paginada e agrupada das assinaturas dos motoristas via
 * RPC `admin_list_subscriptions` (gated por FINANCEIRO_VIEW no servidor).
 *
 * Padrões (project-conventions.md + admin-patterns.md):
 *   - Gating server-side reaplicado na RPC; UI faz Stealth_404 com a mesma
 *     permissão (camada 1).
 *   - Erros mapeados para código tipado + mensagem pt-BR canônica.
 *   - Filtros deep-linkáveis na URL (parse/serialize), paginação 10/50/100.
 *
 * Somente leitura: nenhuma mutação de assinatura é exposta ao admin aqui
 * (transições são do webhook/cron). Mensagens user-facing em pt-BR.
 */

import { supabase } from '../supabase';

/** Grupo de exibição no painel. */
export type SubscriptionGroup = 'a_vencer' | 'pagas' | 'inadimplentes' | 'todos';

/** Status cru da assinatura (subscriptions.status). */
export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'suspended' | 'canceled';

export type SubscriptionSort = 'next_charge_asc' | 'next_charge_desc' | 'started_desc';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  user_name: string | null;
  user_phone: string | null;
  plan: 'mensal' | 'trimestral' | 'semestral';
  payment_method: 'credit_card' | 'pix' | 'boleto';
  status: SubscriptionStatus;
  auto_recurring: boolean;
  started_at: string | null;
  next_charge_at: string | null;
  grace_ends_at: string | null;
  canceled_at: string | null;
  updated_at: string;
  grupo: 'a_vencer' | 'pagas' | 'inadimplentes' | 'outros';
  admin_username: string | null;
}

export interface SubscriptionFilters {
  group: SubscriptionGroup;
  q: string | null;
  sort: SubscriptionSort;
  page: number;
  pageSize: number;
}

export interface SubscriptionListResult {
  rows: SubscriptionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export type SubscriptionAdminErrorCode = 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'UNKNOWN';

export const SUBSCRIPTION_ADMIN_ERROR_MESSAGES: Record<SubscriptionAdminErrorCode, string> = {
  PERMISSION_DENIED: 'Você não tem permissão para acessar esta área.',
  INVALID_INPUT: 'Filtro inválido. Verifique os parâmetros.',
  UNKNOWN: 'Não foi possível carregar as assinaturas. Tente novamente.',
};

export class SubscriptionAdminError extends Error {
  readonly code: SubscriptionAdminErrorCode;
  constructor(code: SubscriptionAdminErrorCode) {
    super(SUBSCRIPTION_ADMIN_ERROR_MESSAGES[code]);
    this.name = 'SubscriptionAdminError';
    this.code = code;
  }
}

function mapError(raw: unknown): SubscriptionAdminError {
  const e = (raw ?? {}) as { code?: string; message?: string };
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = (typeof e.message === 'string' ? e.message : '').toLowerCase();
  if (code === '42501' || msg.includes('permission_denied')) {
    return new SubscriptionAdminError('PERMISSION_DENIED');
  }
  if (msg.includes('invalid_input')) return new SubscriptionAdminError('INVALID_INPUT');
  return new SubscriptionAdminError('UNKNOWN');
}

const VALID_GROUPS: ReadonlySet<SubscriptionGroup> = new Set([
  'a_vencer',
  'pagas',
  'inadimplentes',
  'todos',
]);
const VALID_SORTS: ReadonlySet<SubscriptionSort> = new Set([
  'next_charge_asc',
  'next_charge_desc',
  'started_desc',
]);
const VALID_PAGE_SIZES: ReadonlySet<number> = new Set([10, 50, 100]);

export const DEFAULT_SUBSCRIPTION_FILTERS: SubscriptionFilters = {
  group: 'todos',
  q: null,
  sort: 'next_charge_asc',
  page: 1,
  pageSize: 10,
};

/** Lê filtros do query string (deep-link). Valores fora do domínio caem no default. */
export function parseSubscriptionFiltersFromQuery(
  qs: URLSearchParams | string
): SubscriptionFilters {
  const params =
    typeof qs === 'string' ? new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs) : qs;

  const group = params.get('group');
  const sort = params.get('sort');
  const pageRaw = Number(params.get('page'));
  const sizeRaw = Number(params.get('pageSize'));
  const q = params.get('q');

  return {
    group:
      group && VALID_GROUPS.has(group as SubscriptionGroup)
        ? (group as SubscriptionGroup)
        : 'todos',
    q: q && q.trim().length > 0 ? q.trim() : null,
    sort:
      sort && VALID_SORTS.has(sort as SubscriptionSort)
        ? (sort as SubscriptionSort)
        : 'next_charge_asc',
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    pageSize: VALID_PAGE_SIZES.has(sizeRaw) ? sizeRaw : 10,
  };
}

/** Serializa filtros para URLSearchParams (omite defaults p/ URL limpa). */
export function serializeSubscriptionFiltersToQuery(f: SubscriptionFilters): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.group && f.group !== DEFAULT_SUBSCRIPTION_FILTERS.group) qs.set('group', f.group);
  if (f.q && f.q.trim().length > 0) qs.set('q', f.q.trim());
  if (f.sort && f.sort !== DEFAULT_SUBSCRIPTION_FILTERS.sort) qs.set('sort', f.sort);
  if (f.page && f.page !== 1) qs.set('page', String(f.page));
  if (f.pageSize && f.pageSize !== DEFAULT_SUBSCRIPTION_FILTERS.pageSize) {
    qs.set('pageSize', String(f.pageSize));
  }
  return qs;
}

/** Lista assinaturas via RPC admin_list_subscriptions. */
export async function listSubscriptions(
  filters: SubscriptionFilters
): Promise<SubscriptionListResult> {
  const offset = (filters.page - 1) * filters.pageSize;
  const { data, error } = await supabase.rpc('admin_list_subscriptions', {
    p_group: filters.group === 'todos' ? null : filters.group,
    p_q: filters.q,
    p_sort: filters.sort,
    p_limit: filters.pageSize,
    p_offset: offset,
  });

  if (error) throw mapError(error);
  const raw = (data ?? {}) as { rows?: SubscriptionRow[]; total?: number };
  return {
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    total: Number(raw.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

// ===================== Formatadores =====================

const EMPTY = '\u2014';

const PLAN_LABELS: Record<SubscriptionRow['plan'], string> = {
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
};

const METHOD_LABELS: Record<SubscriptionRow['payment_method'], string> = {
  credit_card: 'Cartão',
  pix: 'PIX',
  boleto: 'Boleto',
};

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  pending: 'Aguardando pagamento',
  active: 'Ativa',
  past_due: 'Em atraso',
  suspended: 'Suspensa',
  canceled: 'Cancelada',
};

export function formatPlan(p: SubscriptionRow['plan']): string {
  return PLAN_LABELS[p] ?? p;
}

export function formatMethod(m: SubscriptionRow['payment_method']): string {
  return METHOD_LABELS[m] ?? m;
}

export function formatStatus(s: SubscriptionStatus): string {
  return STATUS_LABELS[s] ?? s;
}

export function formatDate(iso: string | null): string {
  if (iso == null) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
