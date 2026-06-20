/**
 * supervisor/anomalyDetector.ts — Anomaly_Detector + reconciliação (alvo de
 * CP2/CP3). Funções puras, determinísticas, que espelham a lógica da RPC
 * supervisor_evaluate. Campo de fonte ausente (undefined) ⇒ omite o tipo (sem
 * fabricar registros).
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.2).
 */

import { classifySeverity, type InsightSeverity } from './severityClassifier';

export type InsightType = 'ANOMALY' | 'SUGGESTION' | 'SUMMARY' | 'SECURITY';

export interface AnomalySnapshot {
  /** Diagnósticos rolling (occurrence_count agregado por dedup_key). */
  diagnostics?: ReadonlyArray<{
    dedupKey: string;
    module: string;
    errorCode?: string;
    occurrenceCount: number;
    severity?: InsightSeverity;
  }>;
  /** Alertas CRÍTICOS abertos vindos de admin-central-operacao (117). */
  openCriticalAlerts?: ReadonlyArray<{ dedupKey: string; alertType: string }>;
  config: { errorThreshold: number };
}

export interface ActiveAnomaly {
  dedupKey: string;
  insightType: 'ANOMALY' | 'SECURITY';
  severity: InsightSeverity;
  title: string;
}

/** Insight_Dedup_Key determinística para uma anomalia de diagnóstico. */
export function anomalyDedupKey(diagnosticDedupKey: string): string {
  return `ANOMALY:diagnostic:${diagnosticDedupKey}`;
}

/**
 * Anomaly_Detector: determinístico. Diagnósticos com occurrenceCount ≥ threshold
 * viram anomalias; alertas críticos de 117 viram SECURITY. Saída ordenada por
 * dedupKey (estabilidade — CP2). Fonte ausente (undefined) ⇒ zero itens daquele
 * tipo (omissão sem fabricação).
 */
export function detectAnomalies(snapshot: AnomalySnapshot): ActiveAnomaly[] {
  const threshold = Math.max(1, snapshot.config.errorThreshold);
  const out: ActiveAnomaly[] = [];

  for (const d of snapshot.diagnostics ?? []) {
    if (d.occurrenceCount >= threshold) {
      out.push({
        dedupKey: anomalyDedupKey(d.dedupKey),
        insightType: 'ANOMALY',
        severity: classifySeverity({
          module: d.module,
          severity: d.severity,
          errorCode: d.errorCode,
          occurrenceCount: d.occurrenceCount,
        }),
        title: `Erros recorrentes em ${d.module} (${d.occurrenceCount}x)`,
      });
    }
  }

  for (const a of snapshot.openCriticalAlerts ?? []) {
    out.push({
      dedupKey: `SECURITY:alert:${a.dedupKey}`,
      insightType: 'SECURITY',
      severity: 'CRITICAL',
      title: `Alerta crítico ativo: ${a.alertType}`,
    });
  }

  return out.sort((x, y) => x.dedupKey.localeCompare(y.dedupKey));
}

// ── Reconciliação (modelo puro espelhado pela RPC supervisor_evaluate) ──

export interface ExistingActiveInsight {
  dedupKey: string;
  state: 'OPEN' | 'ACKNOWLEDGED';
}

export interface ReconcilePlan {
  toOpen: ActiveAnomaly[]; // anomalias ativas sem insight ativo correspondente
  toTouch: string[]; // dedup keys ativos a atualizar last_seen_at
  toDismiss: string[]; // dedup keys ativos sem anomalia => auto-dismiss
}

/**
 * Reconcilia o conjunto de insights ativos com as anomalias detectadas.
 * Idempotente sob reaplicação (CP3): após abrir `toOpen`, reconciliar de novo
 * sobre o mesmo estado produz `toOpen` vazio.
 */
export function reconcileInsights(
  existing: ReadonlyArray<ExistingActiveInsight>,
  anomalies: ReadonlyArray<ActiveAnomaly>
): ReconcilePlan {
  const existingKeys = new Set(existing.map((e) => e.dedupKey));
  const anomalyKeys = new Set(anomalies.map((a) => a.dedupKey));
  const toOpen = anomalies.filter((a) => !existingKeys.has(a.dedupKey));
  const toTouch = [...anomalyKeys].filter((k) => existingKeys.has(k)).sort();
  const toDismiss = [...existingKeys].filter((k) => !anomalyKeys.has(k)).sort();
  return { toOpen, toTouch, toDismiss };
}
