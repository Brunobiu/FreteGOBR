/**
 * rastreamento/atRiskList.ts — filtragem + ordenação total da At_Risk_List (CP10).
 *
 * `filterAndSortAtRisk` é PURA e determinística. O resultado é um SUBCONJUNTO
 * da entrada, toda linha retornada satisfaz TODOS os filtros ativos, e a ordem
 * é total: `risk_score` DESC com desempate `user_id` ASC. Uma faixa de score
 * com `min_score > max_score` produz conjunto vazio (sem erro) — faixa
 * impossível é permitida, não rejeitada (Req 13.9).
 *
 * O texto de busca é normalizado com `normalizeQuery` (reuso de cliente-360);
 * o escape de `ILIKE` é aplicado server-side via `escapeIlike` (autoridade SQL).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.4).
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 13.3, 13.9_
 */

import {
  type AbandonmentCause,
  type ContactStatus,
  type RiskBand,
  type RiskCategory,
} from './domain';
import { normalizeQuery } from './trackingFilter';

/** Uma linha da lista de usuários em risco (sem PII bruta: telefone mascarado). */
export interface AtRiskRow {
  user_id: string;
  risk_score: number;
  risk_band: RiskBand;
  abandonment_cause: AbandonmentCause;
  risk_category: RiskCategory;
  contact_status: ContactStatus;
  name: string;
  /** Telefone MASCARADO (ex.: `(62) 9****-**88`) — nunca o número bruto. */
  phone_masked: string;
  /** Perfil do usuário (motorista/embarcador). */
  profile: 'motorista' | 'embarcador';
  /** Instante da última atividade (epoch ms) — base do filtro de data. */
  last_activity_at: number;
}

/** Critérios do Tracking_Filter (todos opcionais; ausência = sem filtro). */
export interface TrackingFilterInput {
  text?: string;
  risk_category?: RiskCategory;
  min_score?: number;
  max_score?: number;
  problem_type?: AbandonmentCause;
  /** Limite inferior do filtro de data (epoch ms, inclusivo). */
  from?: number;
  /** Limite superior do filtro de data (epoch ms, inclusivo). */
  to?: number;
  profile?: 'motorista' | 'embarcador';
}

/** Normaliza texto para comparação case-insensitive (trim + colapso + lower). */
function foldText(value: string): string {
  return normalizeQuery(value).toLowerCase();
}

/** `true` sse a linha satisfaz TODOS os critérios ativos do filtro. */
function matchesFilter(row: AtRiskRow, f: TrackingFilterInput): boolean {
  if (f.risk_category !== undefined && row.risk_category !== f.risk_category) return false;
  if (f.problem_type !== undefined && row.abandonment_cause !== f.problem_type) return false;
  if (f.profile !== undefined && row.profile !== f.profile) return false;

  if (f.min_score !== undefined && row.risk_score < f.min_score) return false;
  if (f.max_score !== undefined && row.risk_score > f.max_score) return false;

  if (f.from !== undefined && row.last_activity_at < f.from) return false;
  if (f.to !== undefined && row.last_activity_at > f.to) return false;

  if (f.text !== undefined) {
    const needle = foldText(f.text);
    if (needle.length > 0) {
      const haystack = `${foldText(row.name)} ${row.phone_masked.toLowerCase()}`;
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

/**
 * Comparador de ordenação total: `risk_score` DESC, desempate `user_id` ASC.
 * `user_id` único garante ordem total e determinística.
 */
export function compareAtRiskRows(a: AtRiskRow, b: AtRiskRow): number {
  if (a.risk_score !== b.risk_score) return b.risk_score - a.risk_score;
  if (a.user_id < b.user_id) return -1;
  if (a.user_id > b.user_id) return 1;
  return 0;
}

/**
 * Mapeia a `Abandonment_Cause` à `Risk_Category` da At_Risk_List (total).
 * Espelha o `CASE` SQL de `rpc_tracking_at_risk_list` na migration 124.
 */
export function deriveRiskCategory(cause: AbandonmentCause): RiskCategory {
  switch (cause) {
    case 'SIGNUP_ABANDONED':
      return 'SIGNUP_ABANDONED';
    case 'PAYMENT_DECLINED':
    case 'CHECKOUT_ABANDONED':
      return 'PAYMENT_PENDING';
    case 'PROLONGED_INACTIVITY':
      return 'INACTIVE';
    case 'FREIGHTS_IGNORED':
      return 'COLD_DRIVER';
    case 'UPLOAD_ERROR':
    case 'LOGIN_FAILURE':
    case 'APP_CRASH':
    case 'INTERNAL_ERROR':
    case 'NETWORK_TIMEOUT':
      return 'RECURRING_ERROR';
    default:
      return 'INACTIVE';
  }
}

/**
 * Filtra e ordena a `At_Risk_List`.
 *
 * @returns Subconjunto ordenado (`risk_score` DESC, `user_id` ASC). Faixa de
 *          score impossível (`min_score > max_score`) ⇒ `[]` sem erro.
 */
export function filterAndSortAtRisk(
  rows: readonly AtRiskRow[],
  f: TrackingFilterInput
): AtRiskRow[] {
  // Faixa impossível: conjunto vazio, sem erro (Req 13.9).
  if (f.min_score !== undefined && f.max_score !== undefined && f.min_score > f.max_score) {
    return [];
  }
  return rows.filter((row) => matchesFilter(row, f)).sort(compareAtRiskRows);
}
