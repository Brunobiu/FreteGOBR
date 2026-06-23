/**
 * rastreamento/riskScore.ts — Risk_Score_Calculator + Risk_Band (CP2/CP3/CP4).
 *
 * `calculateRiskScore` é PURA e determinística: soma ponderada dos `Risk_Factor`
 * com pesos fixos NÃO-NEGATIVOS, **clampada** e arredondada ao inteiro em
 * `[0, 100]`. Pesos não-negativos + clamp + arredondamento ⇒ monotonicidade
 * não-decrescente em cada fator (aumentar um fator nunca diminui o score).
 *
 * `deriveRiskBand` é total sobre os reais: `[…,24]→LOW`, `[25,49]→MEDIUM`,
 * `[50,74]→HIGH`, `[75,…]→CRITICAL`; score maior ⇒ banda de severidade ≥.
 *
 * Espelha a autoridade SQL da migration 124 (cálculo de risco).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 2.5).
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
 */

import { RISK_BANDS, type RiskBand } from './domain';

/** Critérios objetivos de entrada do cálculo de risco (todos ≥ 0). */
export interface RiskFactors {
  days_since_last_access: number;
  recent_failures: number;
  frustrated_attempts: number;
  freight_refusals: number;
  no_conversion: 0 | 1;
}

/** Pesos fixos NÃO-NEGATIVOS por fator (fonte da monotonicidade). */
export const RISK_WEIGHTS: Readonly<Record<keyof RiskFactors, number>> = {
  days_since_last_access: 2,
  recent_failures: 8,
  frustrated_attempts: 6,
  freight_refusals: 5,
  no_conversion: 15,
};

/** Limites do score. */
export const RISK_SCORE_MIN = 0;
export const RISK_SCORE_MAX = 100;

/** Coerção segura para número finito ≥ 0 (entradas fora do contrato viram 0). */
function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Calcula o `Risk_Score` inteiro em `[0, 100]` (clamp + arredondamento).
 *
 * Determinístico (mesmos fatores ⇒ mesmo score) e monotônico não-decrescente
 * em cada fator (pesos ≥ 0).
 */
export function calculateRiskScore(f: RiskFactors): number {
  const raw =
    RISK_WEIGHTS.days_since_last_access * nonNegativeFinite(f.days_since_last_access) +
    RISK_WEIGHTS.recent_failures * nonNegativeFinite(f.recent_failures) +
    RISK_WEIGHTS.frustrated_attempts * nonNegativeFinite(f.frustrated_attempts) +
    RISK_WEIGHTS.freight_refusals * nonNegativeFinite(f.freight_refusals) +
    RISK_WEIGHTS.no_conversion * (f.no_conversion === 1 ? 1 : 0);

  const clamped = Math.min(RISK_SCORE_MAX, Math.max(RISK_SCORE_MIN, raw));
  return Math.round(clamped);
}

/**
 * Deriva a `Risk_Band` a partir do score (função total sobre os reais).
 * `[…,24]→LOW`, `[25,49]→MEDIUM`, `[50,74]→HIGH`, `[75,…]→CRITICAL`.
 */
export function deriveRiskBand(score: number): RiskBand {
  if (score <= 24) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 74) return 'HIGH';
  return 'CRITICAL';
}

/** Severidade ordinal de uma `Risk_Band` (índice em `RISK_BANDS`). */
export function riskBandSeverity(band: RiskBand): number {
  return RISK_BANDS.indexOf(band);
}

/** Rótulos pt-BR das faixas de risco (para exibição na UI). */
export const RISK_BAND_LABELS: Readonly<Record<RiskBand, string>> = {
  LOW: 'Baixo',
  MEDIUM: 'Médio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
};
