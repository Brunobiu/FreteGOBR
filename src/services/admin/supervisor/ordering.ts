/**
 * supervisor/ordering.ts — ordenação total de insights e diagnósticos (alvo de
 * CP8). Comparadores puros, determinísticos, com desempate estável por id.
 * Espelha os ORDER BY das RPCs supervisor_insights_list / supervisor_diagnostics_list.
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.5).
 */

import type { InsightSeverity } from './severityClassifier';

export const SEVERITY_RANK: Readonly<Record<InsightSeverity, number>> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

export interface InsightRow {
  id: string;
  severity: InsightSeverity;
  createdAt: string;
}
export interface DiagnosticRow {
  id: string;
  lastSeenAt: string;
}

/** Ordem total: severidade asc, depois created_at desc, depois id asc. */
export function compareInsights(a: InsightRow, b: InsightRow): number {
  if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity])
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1; // desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // tiebreak estável
}

/** Ordem total: last_seen_at desc, depois id asc. */
export function compareDiagnostics(a: DiagnosticRow, b: DiagnosticRow): number {
  if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt < b.lastSeenAt ? 1 : -1; // desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
