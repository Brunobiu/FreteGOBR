/**
 * rastreamento/funnelMetrics.ts — Funnel_Metrics (CP6/CP7).
 *
 * `computeFunnelMetrics` é PURA e determinística. Recebe as contagens por
 * etapa (já agregadas por `Time_Window`) e produz as taxas do funil, TODAS
 * clampadas a `[0, 1]` (robusto mesmo se a entrada não for perfeitamente
 * não-crescente). Para cada transição com denominador > 0 vale
 * `Stage_Conversion_Rate + Stage_Abandonment_Rate = 1`; com denominador 0,
 * `Stage_Conversion_Rate = 0` (e abandono 0).
 *
 * A etapa terminal (`RECURRING_USER`) não tem transição de saída: suas taxas
 * de conversão/abandono são 0 por construção.
 *
 * Espelha a autoridade SQL da migration 124 (agregação do funil).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 3.3).
 * _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7_
 */

import { FUNNEL_ORDER, type FunnelStage } from './domain';
import { stageIndex } from './stageDerivation';

/** Contagens por etapa do funil (agregadas por janela). */
export type StageCounts = Record<FunnelStage, number>;

/**
 * Agrega as etapas dos usuários em contagens CUMULATIVAS por etapa do funil:
 * um usuário na etapa X é contado em todas as etapas `0..X`. Isso garante, por
 * construção, a monotonicidade do funil (CP6): `count(etapa_i) ≥ count(etapa_{i+1})`.
 *
 * Espelha a contagem cumulativa da migration 124 (usuários com índice de etapa
 * ≥ ao da etapa contada).
 */
export function aggregateFunnelCounts(userStages: readonly FunnelStage[]): StageCounts {
  const counts = {} as StageCounts;
  for (const stage of FUNNEL_ORDER) counts[stage] = 0;
  for (const userStage of userStages) {
    const reached = stageIndex(userStage);
    for (let i = 0; i <= reached; i += 1) {
      counts[FUNNEL_ORDER[i]] += 1;
    }
  }
  return counts;
}

/** Conjunto determinístico de métricas do funil. */
export interface FunnelMetrics {
  /** Taxa de conversão para a etapa seguinte, por etapa (`[0,1]`). */
  stage_conversion_rate: Record<FunnelStage, number>;
  /** Taxa de abandono por etapa (`1 - conversão` quando denom > 0). */
  stage_abandonment_rate: Record<FunnelStage, number>;
  /** Conversão geral (assinantes / visitantes), `[0,1]`. */
  overall_conversion_rate: number;
  /** Retenção (recorrentes / primeiro frete), `[0,1]`. */
  retention_rate: number;
  /** Churn (`1 - retenção` quando denom > 0), `[0,1]`. */
  churn_rate: number;
  /** Ativação (app ativo / cadastro concluído), `[0,1]`. */
  activation_rate: number;
}

/** Clampa um número ao intervalo fechado `[0, 1]` (não-finito ⇒ 0). */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Razão segura clampada a `[0,1]`: 0 quando o denominador é ≤ 0. */
function safeRate(numerator: number, denominator: number): number {
  if (!(denominator > 0)) return 0;
  return clamp01(numerator / denominator);
}

/** Contagem não-negativa e finita de uma etapa (entrada fora do contrato ⇒ 0). */
function countOf(counts: StageCounts, stage: FunnelStage): number {
  const v = counts[stage];
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Calcula as `Funnel_Metrics` a partir das contagens por etapa.
 * Determinística: o mesmo `counts` sempre produz exatamente as mesmas taxas.
 */
export function computeFunnelMetrics(counts: StageCounts): FunnelMetrics {
  const stage_conversion_rate = {} as Record<FunnelStage, number>;
  const stage_abandonment_rate = {} as Record<FunnelStage, number>;

  for (let i = 0; i < FUNNEL_ORDER.length; i += 1) {
    const stage = FUNNEL_ORDER[i];
    const current = countOf(counts, stage);
    const next = i + 1 < FUNNEL_ORDER.length ? countOf(counts, FUNNEL_ORDER[i + 1]) : 0;

    if (i + 1 >= FUNNEL_ORDER.length) {
      // Etapa terminal: sem transição de saída.
      stage_conversion_rate[stage] = 0;
      stage_abandonment_rate[stage] = 0;
      continue;
    }

    const conversion = safeRate(next, current);
    stage_conversion_rate[stage] = conversion;
    // Abandono é 0 quando não há ninguém na etapa (denom 0); senão complemento.
    stage_abandonment_rate[stage] = current > 0 ? clamp01(1 - conversion) : 0;
  }

  const visitors = countOf(counts, 'VISITOR');
  const signupCompleted = countOf(counts, 'SIGNUP_COMPLETED');
  const subscriptionPaid = countOf(counts, 'SUBSCRIPTION_PAID');
  const appActive = countOf(counts, 'APP_ACTIVE');
  const firstFreight = countOf(counts, 'FIRST_FREIGHT');
  const recurring = countOf(counts, 'RECURRING_USER');

  const retention_rate = safeRate(recurring, firstFreight);

  return {
    stage_conversion_rate,
    stage_abandonment_rate,
    overall_conversion_rate: safeRate(subscriptionPaid, visitors),
    retention_rate,
    churn_rate: firstFreight > 0 ? clamp01(1 - retention_rate) : 0,
    activation_rate: safeRate(appActive, signupCompleted),
  };
}
