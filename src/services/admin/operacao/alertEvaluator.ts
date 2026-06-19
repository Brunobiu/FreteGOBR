/**
 * operacao/alertEvaluator.ts — Alert_Evaluator + Alert_Severity_Map + dedupKey +
 * reconciliação (alvo de CP3/CP4/CP5). Funções puras, determinísticas, que
 * espelham a lógica da RPC admin_alerts_evaluate. Campo de fonte ausente
 * (undefined) = módulo não presente => omite o tipo (sem fabricar).
 *
 * Spec: .kiro/specs/admin-central-operacao (Task 2.5).
 */

export type AlertType =
  | 'WHATSAPP_DISCONNECTED'
  | 'CAMPAIGN_PAUSED'
  | 'CAMPAIGN_ERROR'
  | 'INTEGRATION_FAILURE'
  | 'SUBSCRIPTION_EXPIRING'
  | 'CUSTOMER_AWAITING';
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AlertState = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

/** Alert_Severity_Map: determinístico Alert_Type → Alert_Severity (Req 6.4). */
export const ALERT_SEVERITY_MAP: Readonly<Record<AlertType, AlertSeverity>> = {
  WHATSAPP_DISCONNECTED: 'CRITICAL',
  CAMPAIGN_ERROR: 'CRITICAL',
  INTEGRATION_FAILURE: 'CRITICAL',
  CAMPAIGN_PAUSED: 'WARNING',
  SUBSCRIPTION_EXPIRING: 'WARNING',
  CUSTOMER_AWAITING: 'WARNING',
};

export interface AlertSource {
  sourceType: string;
  sourceId: string;
}
export interface ActiveSituation {
  alertType: AlertType;
  source: AlertSource;
  severity: AlertSeverity;
}

/** Alert_Dedup_Key determinística (Req 6.5). */
export function dedupKey(t: AlertType, s: AlertSource): string {
  return `${t}:${s.sourceType}:${s.sourceId}`;
}

/** Snapshot das fontes. Campo ausente (undefined) = módulo não presente. */
export interface EvaluatorInput {
  whatsappSessions?: ReadonlyArray<{ instanceId: string; status: string }>;
  dispatchJobs?: ReadonlyArray<{ dispatchId: string; status: string }>;
  integrations?: ReadonlyArray<{ key: string; failures: number }>;
  subscriptions?: ReadonlyArray<{ userId: string; status: string; nextChargeAt: string | null }>;
  awaitingTickets?: ReadonlyArray<{ ticketId: string; state: string; waitingMinutes: number }>;
  config: {
    now: string;
    expiringWindowDays: number;
    awaitingThresholdMin: number;
    integrationFailureThreshold: number;
  };
}

function push(out: ActiveSituation[], alertType: AlertType, sourceType: string, sourceId: string): void {
  out.push({ alertType, source: { sourceType, sourceId }, severity: ALERT_SEVERITY_MAP[alertType] });
}

function withinExpiring(nextChargeAt: string | null, cfg: EvaluatorInput['config']): boolean {
  if (!nextChargeAt) return false;
  const due = Date.parse(nextChargeAt);
  const now = Date.parse(cfg.now);
  if (Number.isNaN(due) || Number.isNaN(now)) return false;
  const horizon = now + cfg.expiringWindowDays * 86_400_000;
  return due >= now && due <= horizon;
}

/**
 * Alert_Evaluator: determinístico. Para o mesmo snapshot, produz sempre o mesmo
 * conjunto de situações ativas (ordenado por dedupKey para estabilidade — CP3).
 */
export function evaluate(input: EvaluatorInput): ActiveSituation[] {
  const out: ActiveSituation[] = [];
  for (const s of input.whatsappSessions ?? [])
    if (s.status === 'DISCONNECTED' || s.status === 'EXPIRED')
      push(out, 'WHATSAPP_DISCONNECTED', 'whatsapp_session', s.instanceId);
  for (const j of input.dispatchJobs ?? []) {
    if (j.status === 'PAUSED') push(out, 'CAMPAIGN_PAUSED', 'dispatch_job', j.dispatchId);
    if (j.status === 'FAILED') push(out, 'CAMPAIGN_ERROR', 'dispatch_job', j.dispatchId);
  }
  for (const i of input.integrations ?? [])
    if (i.failures >= input.config.integrationFailureThreshold)
      push(out, 'INTEGRATION_FAILURE', 'integration', i.key);
  for (const sub of input.subscriptions ?? [])
    if (sub.status === 'active' && withinExpiring(sub.nextChargeAt, input.config))
      push(out, 'SUBSCRIPTION_EXPIRING', 'subscription', sub.userId);
  for (const t of input.awaitingTickets ?? [])
    if (
      t.state !== 'resolved' &&
      t.state !== 'closed' &&
      t.waitingMinutes >= input.config.awaitingThresholdMin
    )
      push(out, 'CUSTOMER_AWAITING', 'support_ticket', t.ticketId);
  return out.sort((a, b) =>
    dedupKey(a.alertType, a.source).localeCompare(dedupKey(b.alertType, b.source))
  );
}

// ── Reconciliação (modelo puro espelhado pela Alerts_Evaluate_RPC) ──

export interface ExistingActiveAlert {
  dedupKey: string;
  state: 'OPEN' | 'ACKNOWLEDGED';
}
export interface ReconcilePlan {
  toOpen: ActiveSituation[]; // situações ativas sem alerta ativo correspondente
  toTouch: string[]; // dedup keys ativos a atualizar last_seen_at
  toResolve: string[]; // dedup keys ativos sem situação => auto-resolver
}

/**
 * Reconcilia o conjunto de alertas ativos com as situações do evaluator.
 * Idempotente sob reaplicação (CP4) e auto-resolve consistente (CP5).
 */
export function reconcile(
  existing: ReadonlyArray<ExistingActiveAlert>,
  situations: ReadonlyArray<ActiveSituation>
): ReconcilePlan {
  const existingKeys = new Set(existing.map((e) => e.dedupKey));
  const situationKeys = new Set(situations.map((s) => dedupKey(s.alertType, s.source)));
  const toOpen = situations.filter((s) => !existingKeys.has(dedupKey(s.alertType, s.source)));
  const toTouch = [...situationKeys].filter((k) => existingKeys.has(k)).sort();
  const toResolve = [...existingKeys].filter((k) => !situationKeys.has(k)).sort();
  return { toOpen, toTouch, toResolve };
}
