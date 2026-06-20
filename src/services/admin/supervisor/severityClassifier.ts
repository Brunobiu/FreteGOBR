/**
 * supervisor/severityClassifier.ts — Severity_Classifier (alvo de CP1).
 *
 * Função pura, total e determinística: mapeia um diagnóstico/evento para uma
 * Insight_Severity (CRITICAL/WARNING/INFO) por um mapa fixo, e decide se a
 * notificação deve ser imediata (CRITICAL) ou agrupada no resumo. Espelha o
 * CASE de severidade da RPC supervisor_evaluate.
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.1).
 */

export type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

/** Módulos cuja falha é sempre CRÍTICA (financeiro/auth/integração/fila). */
export const CRITICAL_MODULES_SET: ReadonlySet<string> = new Set([
  'financeiro',
  'auth',
  'integration',
  'queue',
]);

export interface DiagnosticInput {
  module: string;
  /** Severidade declarada na origem (opcional). */
  severity?: InsightSeverity;
  errorCode?: string;
  /** Quantas vezes a mesma situação ocorreu (rolling). */
  occurrenceCount: number;
  /** Limite a partir do qual a recorrência vira CRÍTICA. */
  criticalThreshold?: number;
}

/**
 * Classifica a severidade de um diagnóstico. Determinística e total:
 *   - severidade de origem CRITICAL ⇒ CRITICAL;
 *   - módulo crítico ⇒ CRITICAL;
 *   - occurrenceCount ≥ criticalThreshold (default 20) ⇒ CRITICAL;
 *   - severidade de origem WARNING/INFO é preservada quando não há escalada;
 *   - sem severidade de origem ⇒ WARNING (default seguro, nunca silencia).
 */
export function classifySeverity(input: DiagnosticInput): InsightSeverity {
  const threshold = Math.max(1, input.criticalThreshold ?? 20);
  if (input.severity === 'CRITICAL') return 'CRITICAL';
  if (CRITICAL_MODULES_SET.has(input.module)) return 'CRITICAL';
  if (input.occurrenceCount >= threshold) return 'CRITICAL';
  if (input.severity === 'WARNING' || input.severity === 'INFO') return input.severity;
  return 'WARNING';
}

/** Notification_Router: CRITICAL ⇒ notificação imediata; senão agrupada. */
export function notifyImmediately(severity: InsightSeverity): boolean {
  return severity === 'CRITICAL';
}
