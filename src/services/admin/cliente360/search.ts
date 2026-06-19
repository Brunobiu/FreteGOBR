/**
 * cliente360/search.ts — sanitizacao e classificacao do Search_Query (PURO).
 *
 * Espelha EXATAMENTE a logica SQL de `admin_global_search` (migration 116):
 *   - normalizeQuery  <-> regexp_replace(btrim(q), '\s+', ' ', 'g')
 *   - escapeIlike     <-> replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')
 *   - clampSearchLimit<-> COALESCE(p_limit,20) com range [1,50]
 *
 * Sem I/O, deterministico — alvo das Correctness Properties CP-1 e CP-3.
 * Reusa isValidUuid de admin-users (NAO recria o regex de UUID).
 *
 * Spec: .kiro/specs/admin-cliente-360/{requirements,design,tasks}.md (Task 3.1).
 */

import { isValidUuid, normalizeDigits } from '../users';

export type QueryKind = 'empty' | 'uuid' | 'digits' | 'text';

export interface SanitizedQuery {
  /** trim + colapso de espacos internos. */
  normalized: string;
  /** normalized com % _ \ escapados para ILIKE seguro (ESCAPE '\'). */
  escaped: string;
  /** somente digitos de normalized (telefone/CPF). */
  digits: string;
}

/**
 * trim + colapso de espacos internos. Espelha
 * `regexp_replace(btrim(v_raw), '\s+', ' ', 'g')`: btrim remove apenas espacos
 * (ASCII 32) das pontas; em seguida qualquer corrida de whitespace vira um
 * unico espaco.
 */
export function normalizeQuery(raw: string): string {
  return raw.replace(/^ +| +$/g, '').replace(/\s+/g, ' ');
}

/**
 * Escapa os curingas de ILIKE: `\` PRIMEIRO (vira `\\`), depois `%` (vira `\%`)
 * e `_` (vira `\_`). Garante que nenhum curinga do usuario atue como curinga
 * quando o padrao e usado com `ESCAPE '\'`. (CP-3)
 */
export function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** trim + colapso + escape + digitos, em um passo (Sanitized_Query). */
export function sanitizeQuery(raw: string): SanitizedQuery {
  const normalized = normalizeQuery(raw ?? '');
  return {
    normalized,
    escaped: escapeIlike(normalized),
    digits: normalizeDigits(normalized),
  };
}

/**
 * Classifica o termo normalizado:
 *   - 'uuid'   : UUID valido (match exato de id, rank 0).
 *   - 'empty'  : menos de 2 chars e nao-UUID => busca retorna vazio sem erro.
 *   - 'digits' : somente digitos (>= 2 chars).
 *   - 'text'   : qualquer outro texto.
 * O match por telefone/CPF depende de `digits.length >= 8` (independente do
 * kind), espelhando a RPC.
 */
export function classifyQueryKind(normalized: string): QueryKind {
  if (isValidUuid(normalized)) return 'uuid';
  if (normalized.length < 2) return 'empty';
  if (/^\d+$/.test(normalized)) return 'digits';
  return 'text';
}

/**
 * Clampa p_limit em [1,50], default 20 quando ausente/NaN/fora de faixa.
 * Espelha `COALESCE(p_limit,20)` + checagem de range da RPC. (CP-3)
 */
export function clampSearchLimit(limit: number | null | undefined): number {
  const v = limit ?? 20;
  if (!Number.isFinite(v) || v < 1 || v > 50) return 20;
  return Math.floor(v);
}
