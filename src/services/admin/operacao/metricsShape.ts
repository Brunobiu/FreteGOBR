/**
 * operacao/metricsShape.ts — forma do Operations_Metrics_Bundle + disponibilidade.
 *
 * Funções puras, determinísticas (alvo de CP1). Espelha o contrato da RPC
 * admin_operations_metrics. Dashboard_KPI: value=null NUNCA é exibido como 0;
 * available=false => UI mostra "indisponível". Partial_Degradation: grupo em
 * `errors` força todos os seus KPIs a indisponíveis.
 *
 * Spec: .kiro/specs/admin-central-operacao (Task 2.1).
 */

export type OperationsKpiKey =
  | 'USERS_TOTAL'
  | 'USERS_ONLINE'
  | 'SIGNUPS_TODAY'
  | 'SUBSCRIPTIONS_ACTIVE'
  | 'SUBSCRIPTIONS_EXPIRED'
  | 'TICKETS_OPEN'
  | 'TICKETS_IN_PROGRESS'
  | 'TICKETS_RESOLVED'
  | 'MESSAGES_SENT'
  | 'MESSAGES_SCHEDULED'
  | 'MESSAGES_ERROR';

export type OperationsGroupKey = 'users' | 'subscriptions' | 'tickets' | 'messages';

/** Dashboard_KPI: value=null nunca exibido como 0. */
export interface DashboardKpi {
  value: number | null;
  available: boolean;
}

export interface OperationsMetricsBundle {
  meta: { generatedAt: string; onlineWindowSec: number };
  kpis: Record<OperationsKpiKey, DashboardKpi>;
  errors: Partial<Record<OperationsGroupKey, string>>;
}

/** Mapa fixo KPI → grupo de degradação (Partial_Degradation). */
export const KPI_GROUP: Readonly<Record<OperationsKpiKey, OperationsGroupKey>> = {
  USERS_TOTAL: 'users',
  USERS_ONLINE: 'users',
  SIGNUPS_TODAY: 'users',
  SUBSCRIPTIONS_ACTIVE: 'subscriptions',
  SUBSCRIPTIONS_EXPIRED: 'subscriptions',
  TICKETS_OPEN: 'tickets',
  TICKETS_IN_PROGRESS: 'tickets',
  TICKETS_RESOLVED: 'tickets',
  MESSAGES_SENT: 'messages',
  MESSAGES_SCHEDULED: 'messages',
  MESSAGES_ERROR: 'messages',
};

export const OPERATIONS_KPI_KEYS = Object.keys(KPI_GROUP) as OperationsKpiKey[];

/** Entrada crua por KPI: contagem + disponibilidade da fonte. */
export interface RawKpi {
  value: number | null;
  available: boolean;
}

/** Builder puro de um KPI: fonte indisponível => {value:null, available:false}. */
export function buildKpi(raw: RawKpi | null | undefined): DashboardKpi {
  if (!raw || raw.available !== true) return { value: null, available: false };
  return { value: raw.value == null ? null : Number(raw.value), available: true };
}

/**
 * Adapta o bundle cru (saída da RPC) para o contrato público, aplicando
 * Partial_Degradation: para todo grupo presente em `errors`, TODOS os seus KPIs
 * viram {value:null, available:false} (nunca 0). Determinístico e total.
 */
export function adaptOperationsBundle(raw: {
  meta?: Partial<OperationsMetricsBundle['meta']>;
  kpis?: Partial<Record<OperationsKpiKey, RawKpi>>;
  errors?: Partial<Record<OperationsGroupKey, string>>;
}): OperationsMetricsBundle {
  const errors = { ...(raw.errors ?? {}) };
  const kpis = {} as Record<OperationsKpiKey, DashboardKpi>;
  for (const key of OPERATIONS_KPI_KEYS) {
    const group = KPI_GROUP[key];
    kpis[key] = group in errors ? { value: null, available: false } : buildKpi(raw.kpis?.[key]);
  }
  return {
    meta: {
      generatedAt: String(raw.meta?.generatedAt ?? ''),
      onlineWindowSec: Number(raw.meta?.onlineWindowSec ?? 300),
    },
    kpis,
    errors,
  };
}
