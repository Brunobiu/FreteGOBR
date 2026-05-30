/**
 * admin/trial.ts
 *
 * Service de gestao de trial de motoristas no painel admin.
 *
 * Este arquivo concentra:
 *   - O contrato de tipos do modulo (filtros, linhas, resultado, error codes).
 *   - Helpers PUROS (sem I/O): classificacao de estado, predicados de
 *     prestes-a-expirar e versionamento otimista, e (de)serializacao de
 *     filtros via URL — espelhando exatamente as convencoes de
 *     `admin/users.ts` e `admin/blacklist.ts`.
 *
 * As funcoes de I/O (`listTrialMotoristas` via RPC `admin_list_trial_motoristas`
 * e `extendTrial` via `executeAdminMutation` -> RPC `admin_extend_trial`) sao
 * adicionadas na tarefa 8.2, neste mesmo arquivo.
 *
 * Convencoes: pt-BR em texto user-facing; ingles em error codes e
 * identificadores. Reusa `SubscriptionStatus` do nucleo puro de trial.
 */

import { supabase } from '../supabase';
import { executeAdminMutation, logAdminAction } from './audit';
import type { SubscriptionStatus } from '../../utils/trialStatus';

// ===================== Tipos publicos =====================

export type TrialStatusFilter = 'todos' | 'em_trial' | 'expirado' | 'assinante';

export type TrialSort = 'days_left_asc' | 'days_left_desc' | 'created_desc';

export interface TrialFilters {
  status: TrialStatusFilter;
  /** `days_left <= 5` E `days_left > 0` (Req 10.3). */
  aboutToExpire: boolean;
  q: string;
  sort: TrialSort;
  page: number;
  /** 10 | 50 | 100, default 10. */
  pageSize: number;
}

export const DEFAULT_TRIAL_FILTERS: TrialFilters = {
  status: 'todos',
  aboutToExpire: false,
  q: '',
  sort: 'days_left_asc',
  page: 1,
  pageSize: 10,
};

export interface TrialMotoristaRow {
  id: string;
  name: string;
  phone: string;
  trial_ends_at: string | null;
  subscription_status: SubscriptionStatus;
  is_subscribed: boolean;
  /** Computado pelo servidor (now() autoritativo). */
  days_left: number;
  trial_state: 'em_trial' | 'expirado' | 'assinante';
  /** Para versionamento otimista. */
  updated_at: string;
  admin_username: string | null;
}

export interface TrialListResult {
  rows: TrialMotoristaRow[];
  total: number;
  page: number;
  pageSize: number;
}

export type TrialErrorCode =
  | 'STALE_VERSION'
  | 'MASTER_PROTECTED'
  | 'NOT_FOUND'
  | 'NOT_MOTORISTA'
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED';

/** Mensagens user-facing canonicas (pt-BR) por error code. */
export const TRIAL_ERROR_MESSAGES: Record<TrialErrorCode, string> = {
  STALE_VERSION: 'Outro admin atualizou os dados. Recarregando.',
  MASTER_PROTECTED: 'O Master Admin é imutável.',
  NOT_FOUND: 'Motorista não encontrado.',
  NOT_MOTORISTA: 'Este usuário não é motorista.',
  INVALID_INPUT: 'Dados inválidos. A nova data deve ser futura.',
  PERMISSION_DENIED: 'Operação não permitida.',
};

export class TrialServiceError extends Error {
  constructor(
    public code: TrialErrorCode,
    message?: string,
    public cause?: unknown
  ) {
    super(message ?? TRIAL_ERROR_MESSAGES[code] ?? code);
    this.name = 'TrialServiceError';
  }
}

// ===================== Helpers puros =====================

/** Numero de dias do limiar "prestes a expirar". */
const ABOUT_TO_EXPIRE_DAYS = 5;

/**
 * Classifica o estado de trial de um motorista a partir das colunas brutas,
 * espelhando o `CASE` da RPC `admin_list_trial_motoristas`:
 *
 *   assinante  <= is_subscribed = true
 *   expirado   <= trial_ends_at IS NOT NULL E trial_ends_at <= now
 *   em_trial   <= caso contrario
 *
 * `now` e injetavel para testes determinísticos (default `new Date()`).
 * `trial_ends_at` aceita ISO string, `Date` ou `null`.
 */
export function classifyTrialState(
  row: { is_subscribed: boolean; trial_ends_at: string | Date | null },
  now: Date = new Date()
): 'em_trial' | 'expirado' | 'assinante' {
  if (row.is_subscribed) return 'assinante';

  if (row.trial_ends_at != null) {
    const ends =
      row.trial_ends_at instanceof Date ? row.trial_ends_at : new Date(row.trial_ends_at);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() <= now.getTime()) {
      return 'expirado';
    }
  }

  return 'em_trial';
}

/**
 * Verdadeiro quando o trial esta "prestes a expirar": `0 < daysLeft <= 5`
 * (Req 10.3). Motoristas ja expirados (`daysLeft === 0`) nao contam.
 */
export function isAboutToExpire(daysLeft: number): boolean {
  return daysLeft > 0 && daysLeft <= ABOUT_TO_EXPIRE_DAYS;
}

/**
 * Verdadeiro quando o `updated_at` esperado diverge do atual — indicando que
 * outro admin alterou o registro entre a leitura e o envio (Req 11.3).
 * Comparacao estrita de string ISO (a fonte de verdade e o servidor).
 */
export function isStaleVersion(expectedUpdatedAt: string, currentUpdatedAt: string): boolean {
  return expectedUpdatedAt !== currentUpdatedAt;
}

// ===================== URL <-> filtros =====================

const VALID_TRIAL_STATUS: readonly TrialStatusFilter[] = [
  'todos',
  'em_trial',
  'expirado',
  'assinante',
] as const;

const VALID_TRIAL_SORTS: readonly TrialSort[] = [
  'days_left_asc',
  'days_left_desc',
  'created_desc',
] as const;

const VALID_PAGE_SIZES: readonly number[] = [10, 50, 100];

/**
 * Le filtros da URL com defaults seguros para valores ausentes/invalidos.
 * Valida dominio fechado de status/sort. pageSize aceita apenas 10/50/100
 * (default 10). `aboutToExpire` e booleano via 'true'.
 */
export function parseTrialFiltersFromQuery(qs: URLSearchParams | string): TrialFilters {
  const sp = typeof qs === 'string' ? new URLSearchParams(qs) : qs;

  const status = sp.get('status') as TrialStatusFilter | null;
  const sort = sp.get('sort') as TrialSort | null;

  const page = parseInt(sp.get('page') ?? '', 10);
  const pageSizeRaw = parseInt(sp.get('pageSize') ?? '', 10);
  const pageSize = VALID_PAGE_SIZES.includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_TRIAL_FILTERS.pageSize;

  return {
    status: status && VALID_TRIAL_STATUS.includes(status) ? status : DEFAULT_TRIAL_FILTERS.status,
    aboutToExpire: sp.get('aboutToExpire') === 'true',
    q: sp.get('q') ?? DEFAULT_TRIAL_FILTERS.q,
    sort: sort && VALID_TRIAL_SORTS.includes(sort) ? sort : DEFAULT_TRIAL_FILTERS.sort,
    page: Number.isFinite(page) && page >= 1 ? page : DEFAULT_TRIAL_FILTERS.page,
    pageSize,
  };
}

/**
 * Serializa filtros para URLSearchParams. Omite valores default para manter a
 * URL limpa (mesmo padrao de `serializeBlacklistFiltersToQuery`).
 */
export function serializeTrialFiltersToQuery(f: TrialFilters): URLSearchParams {
  const sp = new URLSearchParams();
  const d = DEFAULT_TRIAL_FILTERS;

  if (f.status !== d.status) sp.set('status', f.status);
  if (f.aboutToExpire) sp.set('aboutToExpire', 'true');
  if (f.q && f.q !== d.q) sp.set('q', f.q);
  if (f.sort !== d.sort) sp.set('sort', f.sort);
  if (f.page !== d.page) sp.set('page', String(f.page));
  if (f.pageSize !== d.pageSize) sp.set('pageSize', String(f.pageSize));

  return sp;
}

// ===================== Mapeamento de erros de RPC =====================

/**
 * Mapeia mensagens/codigos de erro das RPCs SQL (RAISE EXCEPTION) para
 * `TrialServiceError` tipados. Devolve `null` quando nao reconhece o padrao,
 * para que o caller propague o erro original.
 *
 * Espelha o estilo de `blacklist.ts::parseRpcError`. As RPCs do modulo
 * (`admin_list_trial_motoristas`, `admin_extend_trial`, migration 044) usam:
 *   - 'permission_denied: ...'  (ERRCODE 42501) -> PERMISSION_DENIED
 *   - 'MASTER_PROTECTED'        (P0001)         -> MASTER_PROTECTED
 *   - 'NOT_MOTORISTA'           (P0001)         -> NOT_MOTORISTA
 *   - 'NOT_FOUND'               (P0001)         -> NOT_FOUND
 *   - 'STALE_VERSION: ...'      (P0001)         -> STALE_VERSION
 *   - 'INVALID_INPUT: ...'      (P0001)         -> INVALID_INPUT (com detalhe)
 */
function parseTrialRpcError(err: unknown): TrialServiceError | null {
  const e = (err ?? {}) as { message?: unknown; code?: unknown };
  const msg = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';

  // Gating: mensagem 'permission_denied' OU SQLSTATE 42501 (insufficient_privilege).
  if (msg.includes('permission_denied') || code === '42501') {
    return new TrialServiceError('PERMISSION_DENIED', undefined, err);
  }
  if (msg.includes('MASTER_PROTECTED')) {
    return new TrialServiceError('MASTER_PROTECTED', undefined, err);
  }
  // NOT_MOTORISTA antes de NOT_FOUND (substrings distintas, mas mantemos a ordem clara).
  if (msg.includes('NOT_MOTORISTA')) {
    return new TrialServiceError('NOT_MOTORISTA', undefined, err);
  }
  if (msg.includes('NOT_FOUND')) {
    return new TrialServiceError('NOT_FOUND', undefined, err);
  }
  if (msg.includes('STALE_VERSION')) {
    return new TrialServiceError('STALE_VERSION', undefined, err);
  }
  if (msg.includes('INVALID_INPUT')) {
    const idx = msg.indexOf('INVALID_INPUT');
    const detail = msg
      .slice(idx)
      .replace(/^INVALID_INPUT:?\s*/i, '')
      .trim();
    return new TrialServiceError('INVALID_INPUT', detail.length > 0 ? detail : undefined, err);
  }
  return null;
}

// ===================== Mapeamento DB -> Row =====================

interface TrialRpcRow {
  id: string;
  name: string | null;
  phone: string | null;
  trial_ends_at: string | null;
  subscription_status: string | null;
  is_subscribed: boolean | null;
  days_left: number | null;
  trial_state: string | null;
  updated_at: string;
  admin_username: string | null;
}

function rpcRowToTrialRow(r: TrialRpcRow): TrialMotoristaRow {
  return {
    id: r.id,
    name: r.name ?? '',
    phone: r.phone ?? '',
    trial_ends_at: r.trial_ends_at,
    subscription_status: (r.subscription_status ?? 'trial') as SubscriptionStatus,
    is_subscribed: Boolean(r.is_subscribed),
    days_left: typeof r.days_left === 'number' ? r.days_left : 0,
    trial_state: (r.trial_state ?? 'em_trial') as TrialMotoristaRow['trial_state'],
    updated_at: r.updated_at,
    admin_username: r.admin_username,
  };
}

// ===================== 8.2 Listagem (USER_VIEW) =====================

/**
 * Lista paginada de motoristas com status de trial computado no servidor.
 *
 * Chama a RPC `admin_list_trial_motoristas` (migration 044), que recebe
 * `p_status`, `p_about_to_expire`, `p_q`, `p_sort`, `p_limit`, `p_offset` e
 * retorna `{ rows, total, limit, offset }`. O `days_left`/`trial_state` sao
 * computados com o `now()` autoritativo do banco.
 *
 * Paginacao: `offset = (page - 1) * pageSize`. A `page` do resultado e
 * derivada do `offset`/`limit` devolvidos pelo servidor
 * (`page = floor(offset / pageSize) + 1`).
 *
 * Erros de gating (`permission_denied` / SQLSTATE 42501) e validacao
 * (`INVALID_INPUT`) sao traduzidos para `TrialServiceError`. A UI faz o gate
 * em primeira camada com `useAdminPermission('USER_VIEW')` + `Stealth404`.
 */
export async function listTrialMotoristas(filters: TrialFilters): Promise<TrialListResult> {
  const limit = filters.pageSize;
  const offset = Math.max(0, (filters.page - 1) * filters.pageSize);

  const { data, error } = await supabase.rpc('admin_list_trial_motoristas', {
    p_status: filters.status === 'todos' ? null : filters.status,
    p_about_to_expire: filters.aboutToExpire,
    p_q: filters.q?.trim() ? filters.q.trim() : null,
    p_sort: filters.sort,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    const mapped = parseTrialRpcError(error);
    if (mapped) throw mapped;
    throw error;
  }

  const payload = (data ?? {}) as {
    rows?: TrialRpcRow[] | null;
    total?: number | null;
    limit?: number | null;
    offset?: number | null;
  };

  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const resultLimit =
    typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : limit;
  const resultOffset =
    typeof payload.offset === 'number' && payload.offset >= 0 ? payload.offset : offset;

  return {
    rows: rawRows.map(rpcRowToTrialRow),
    total: typeof payload.total === 'number' ? payload.total : 0,
    page: Math.floor(resultOffset / resultLimit) + 1,
    pageSize: resultLimit,
  };
}

// ===================== 8.2 Extensao de trial (USER_EDIT) =====================

/**
 * Le o `trial_ends_at` atual do alvo para compor o snapshot `before` do audit
 * (best-effort: falha de leitura nao bloqueia a mutacao, apenas deixa o
 * snapshot anterior como `null`).
 */
async function fetchCurrentTrialEndsAt(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('users')
      .select('trial_ends_at')
      .eq('id', userId)
      .maybeSingle();
    return (data?.trial_ends_at as string | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Estende manualmente o `trial_ends_at` de um motorista, com versionamento
 * otimista (`expectedUpdatedAt`).
 *
 * Envolve a chamada com `executeAdminMutation` (audit-by-construction):
 *   - `action: 'TRIAL_EXTEND'`, `targetType: 'users'`, `targetId: userId`;
 *   - `before` = `{ trial_ends_at: <antigo> }`, `after` = `{ trial_ends_at: <novo> }`.
 * Em falha, o wrapper grava automaticamente `TRIAL_EXTEND_ROLLBACK`.
 *
 * A RPC `admin_extend_trial` (migration 044) faz o gating `USER_EDIT`, protege
 * o Master Admin antes de qualquer touch, valida data futura e aplica a guarda
 * otimista. Os erros SQL sao mapeados para `TrialServiceError`:
 *   STALE_VERSION | MASTER_PROTECTED | NOT_FOUND | NOT_MOTORISTA |
 *   INVALID_INPUT | PERMISSION_DENIED.
 *
 * Em `STALE_VERSION`, grava um audit log secundario best-effort
 * (`TRIAL_EXTEND_STALE_VERSION`); a UI exibe toast "Outro admin atualizou.
 * Recarregando." + refetch (padrao da casa).
 */
export async function extendTrial(
  userId: string,
  newTrialEndsAt: string,
  expectedUpdatedAt: string
): Promise<{ ok: true; updated_at: string }> {
  const previousTrialEndsAt = await fetchCurrentTrialEndsAt(userId);

  try {
    return await executeAdminMutation<{ ok: true; updated_at: string }>(
      {
        action: 'TRIAL_EXTEND',
        targetType: 'users',
        targetId: userId,
        before: { trial_ends_at: previousTrialEndsAt },
        after: { trial_ends_at: newTrialEndsAt },
      },
      async () => {
        const { data, error } = await supabase.rpc('admin_extend_trial', {
          p_user_id: userId,
          p_new_trial_ends_at: newTrialEndsAt,
          p_expected_updated_at: expectedUpdatedAt,
        });
        if (error) {
          const mapped = parseTrialRpcError(error);
          if (mapped) throw mapped;
          throw error;
        }
        const updatedAt =
          data && typeof data === 'object' && 'updated_at' in (data as Record<string, unknown>)
            ? (((data as Record<string, unknown>).updated_at as string) ?? '')
            : '';
        return { ok: true as const, updated_at: updatedAt };
      }
    );
  } catch (err) {
    if (err instanceof TrialServiceError && err.code === 'STALE_VERSION') {
      await logAdminAction({
        action: 'TRIAL_EXTEND_STALE_VERSION',
        targetType: 'users',
        targetId: userId,
        before: { expected_updated_at: expectedUpdatedAt },
        after: { reason: 'STALE_VERSION' },
      }).catch(() => null);
    }
    throw err;
  }
}
