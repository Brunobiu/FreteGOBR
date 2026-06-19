/**
 * cliente360/ranking.ts — matched_field, match_rank e ordenacao total (PURO).
 *
 * Espelha EXATAMENTE as duas expressoes CASE de `admin_global_search`
 * (migration 116): a sequencia de branches que define `matched_field` e a que
 * define `match_rank`. Como o `id` e unico, o desempate (`match_rank ASC ->
 * name ASC -> id ASC`) e TOTAL e deterministico.
 *
 * Alvo das Correctness Properties CP-1 (determinismo/ordenacao) e CP-2
 * (isolamento: nenhum resultado com user_type='admin'). Reusa normalizeDigits
 * de admin-users.
 *
 * Spec: .kiro/specs/admin-cliente-360/{requirements,design,tasks}.md (Task 3.2).
 */

import { normalizeDigits } from '../users';
import {
  classifyQueryKind,
  clampSearchLimit,
  sanitizeQuery,
  type QueryKind,
  type SanitizedQuery,
} from './search';

export interface SearchCandidate {
  id: string;
  /** Inclui 'admin' para que runSearch possa EXCLUI-LO (Req 2.7, CP-2). */
  user_type: 'motorista' | 'embarcador' | 'admin';
  name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  cpf: string | null;
}

export interface SearchResult {
  id: string;
  user_type: 'motorista' | 'embarcador';
  name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  matched_field: 'id' | 'email' | 'phone' | 'name' | 'company_name';
  match_rank: 0 | 1 | 2;
}

/**
 * Atribui matched_field + match_rank deterministico a um candidato; null se nao
 * casa ou se for admin. A ordem dos branches e identica a da RPC:
 *   rank 0: id exato (UUID) | email exato | phone exato (>=8 digitos)
 *   rank 1: prefixo de name | prefixo de company_name
 *   rank 2: substring de name | email | company_name | phone/cpf (>=8 digitos)
 */
export function assignMatchRank(
  cand: SearchCandidate,
  sanitized: SanitizedQuery,
  kind: QueryKind
): SearchResult | null {
  // Exclui admin (Req 2.7, CP-2) e termos vazios/curtos (Req 2.3).
  if (cand.user_type !== 'motorista' && cand.user_type !== 'embarcador') return null;
  if (kind === 'empty') return null;

  const norm = sanitized.normalized.toLowerCase();
  const digits = sanitized.digits;
  const digitsActive = digits.length >= 8;

  const name = (cand.name ?? '').toLowerCase();
  const email = cand.email ? cand.email.toLowerCase() : null;
  const company = cand.company_name ? cand.company_name.toLowerCase() : null;
  const phoneDigits = normalizeDigits(cand.phone ?? '');
  const cpfDigits = normalizeDigits(cand.cpf ?? '');

  let field: SearchResult['matched_field'] | null = null;
  let rank: 0 | 1 | 2 | null = null;

  if (kind === 'uuid' && cand.id.toLowerCase() === norm) {
    field = 'id';
    rank = 0;
  } else if (email !== null && email === norm) {
    field = 'email';
    rank = 0;
  } else if (digitsActive && phoneDigits === digits) {
    field = 'phone';
    rank = 0;
  } else if (name.startsWith(norm)) {
    field = 'name';
    rank = 1;
  } else if (company !== null && company.startsWith(norm)) {
    field = 'company_name';
    rank = 1;
  } else if (name.includes(norm)) {
    field = 'name';
    rank = 2;
  } else if (email !== null && email.includes(norm)) {
    field = 'email';
    rank = 2;
  } else if (company !== null && company.includes(norm)) {
    field = 'company_name';
    rank = 2;
  } else if (digitsActive && (phoneDigits.includes(digits) || cpfDigits.includes(digits))) {
    field = 'phone';
    rank = 2;
  }

  if (field === null || rank === null) return null;

  return {
    id: cand.id,
    user_type: cand.user_type,
    name: cand.name,
    email: cand.email,
    phone: cand.phone,
    company_name: cand.company_name,
    matched_field: field,
    match_rank: rank,
  };
}

/**
 * Comparador de ordenacao TOTAL: match_rank ASC -> name ASC -> id ASC.
 * Usa comparacao por code-point (deterministica); o id unico garante o
 * desempate total. (Req 3.4, 3.5, CP-1)
 */
export function compareSearchResults(a: SearchResult, b: SearchResult): number {
  if (a.match_rank !== b.match_rank) return a.match_rank - b.match_rank;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Pipeline puro completo: sanitiza, classifica, casa cada candidato, ordena
 * pela ordem total e aplica o clamp de limite. Usado nos property tests e como
 * fallback de reordenacao no cliente.
 */
export function runSearch(
  candidates: SearchCandidate[],
  rawQuery: string,
  limit: number
): SearchResult[] {
  const sanitized = sanitizeQuery(rawQuery);
  const kind = classifyQueryKind(sanitized.normalized);
  if (kind === 'empty') return [];

  const matched: SearchResult[] = [];
  for (const c of candidates) {
    const r = assignMatchRank(c, sanitized, kind);
    if (r) matched.push(r);
  }
  matched.sort(compareSearchResults);
  return matched.slice(0, clampSearchLimit(limit));
}
