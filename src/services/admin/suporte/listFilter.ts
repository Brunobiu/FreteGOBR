/**
 * listFilter.ts — filtro/ordenação/paginação puro da lista de atendimentos.
 *
 * Espelha o filtro server-side de `support_admin_list_tickets` (115b). Função
 * pura, reusada pela UI (filtro client-side opcional) e alvo do property test
 * CP7*. A busca/paginação principal acontece no servidor; este módulo garante
 * coerência e é testável isoladamente.
 *
 * Validates: Requirements 2.5, 2.6, 2.7, 2.10
 */

import type { TicketStatus } from './statusMachine';
import type { ResponderMode } from './responderModeReducer';
import type { PriorityLevel } from './priorityClassifier';

/** Tamanhos de página suportados (project-conventions). Default 10. */
export const PAGE_SIZES = [10, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export function normalizePageSize(value: number): PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value) ? (value as PageSize) : 10;
}

export interface SupportFilterCriteria {
  status?: TicketStatus | null;
  priorityLevel?: PriorityLevel | null;
  responderMode?: ResponderMode | null;
  /** ISO date strings (inclusive). */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Busca textual (case-insensitive) em subject/nome/email. */
  search?: string | null;
}

/** Campos mínimos de um atendimento para filtro/ordenação. */
export interface SupportTicketLite {
  status: TicketStatus;
  priorityLevel: PriorityLevel;
  responderMode: ResponderMode;
  createdAt: string;
  subject: string;
  clientName?: string | null;
  clientEmail?: string | null;
}

function matchesSearch(t: SupportTicketLite, term: string): boolean {
  const hay = `${t.subject} ${t.clientName ?? ''} ${t.clientEmail ?? ''}`.toLowerCase();
  return hay.includes(term.toLowerCase());
}

/** true se o atendimento satisfaz TODOS os critérios ativos. */
export function matchesFilter(t: SupportTicketLite, c: SupportFilterCriteria): boolean {
  if (c.status != null && t.status !== c.status) return false;
  if (c.priorityLevel != null && t.priorityLevel !== c.priorityLevel) return false;
  if (c.responderMode != null && t.responderMode !== c.responderMode) return false;
  if (c.dateFrom != null && t.createdAt < c.dateFrom) return false;
  if (c.dateTo != null && t.createdAt > c.dateTo) return false;
  if (c.search != null && c.search.trim() !== '' && !matchesSearch(t, c.search.trim())) return false;
  return true;
}

/** Ordenação por created_at decrescente (ordenação inicial — Req 2.6). */
export function sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Aplica filtro + ordenação (created_at desc) + paginação. Retorna a página
 * solicitada (no máximo `pageSize` itens) e o total filtrado.
 */
export function filterSortPaginate(
  items: SupportTicketLite[],
  criteria: SupportFilterCriteria,
  page: number,
  pageSize: number
): { items: SupportTicketLite[]; total: number } {
  const size = normalizePageSize(pageSize);
  const safePage = Math.max(0, Math.floor(page));
  const filtered = sortByCreatedDesc(items.filter((t) => matchesFilter(t, criteria)));
  const start = safePage * size;
  return { items: filtered.slice(start, start + size), total: filtered.length };
}
