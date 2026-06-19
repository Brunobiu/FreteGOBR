/**
 * operacao/ordering.ts — ordenação total de alertas e logs (alvo de CP9).
 * Comparadores puros, determinísticos, com desempate estável por id.
 *
 * Spec: .kiro/specs/admin-central-operacao (Task 2.11).
 */

import type { AlertSeverity } from './alertEvaluator';

export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

export interface AlertRow {
  id: string;
  severity: AlertSeverity;
  lastSeenAt: string;
}
export interface LogRow {
  id: string;
  occurredAt: string;
  eventType: string;
}

/** Ordem total: severidade asc, depois last_seen_at desc, depois id asc. */
export function compareAlerts(a: AlertRow, b: AlertRow): number {
  if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity])
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt < b.lastSeenAt ? 1 : -1; // desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // tiebreak estavel
}

/** Ordem total: occurred_at desc, depois event_type asc, depois id asc. */
export function compareLogs(a: LogRow, b: LogRow): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1; // desc
  if (a.eventType !== b.eventType) return a.eventType < b.eventType ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
