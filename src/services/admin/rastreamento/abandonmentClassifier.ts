/**
 * rastreamento/abandonmentClassifier.ts — Abandonment_Cause_Classifier (CP1).
 *
 * Função PURA, TOTAL e DETERMINÍSTICA: dado um `Journey_Summary` e o limite de
 * inatividade configurado, retorna EXATAMENTE uma `Abandonment_Cause` do
 * domínio fechado. Causas concorrentes são resolvidas por `ABANDONMENT_PRECEDENCE`
 * (ordem total fixa); quando nada se aplica, retorna `UNKNOWN` (totalidade).
 *
 * O sinal primário é `last_relevant_event` (evento problemático mais recente);
 * causas de estado (`SIGNUP_ABANDONED`), de recusa (`FREIGHTS_IGNORED`) e de
 * inatividade (`PROLONGED_INACTIVITY`) compõem o conjunto de candidatos e a
 * precedência decide o vencedor. Exibida na coluna "CAUSA PROVÁVEL DA PERDA".
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 2.3).
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_
 */

import { ABANDONMENT_PRECEDENCE, type AbandonmentCause } from './domain';
import { type JourneySummary } from './journeySummary';

/** A partir de quantos fretes ignorados a causa `FREIGHTS_IGNORED` se aplica. */
export const FREIGHTS_IGNORED_THRESHOLD = 3;

/** Mapeia o evento relevante mais recente à causa correspondente. */
function causeOfLastEvent(summary: JourneySummary): AbandonmentCause | null {
  switch (summary.last_relevant_event) {
    case 'APP_CRASH':
      return 'APP_CRASH';
    case 'PAYMENT_FAILED':
      return 'PAYMENT_DECLINED';
    case 'DOCUMENT_UPLOAD_FAILED':
      return 'UPLOAD_ERROR';
    case 'LOGIN_FAILED':
      return 'LOGIN_FAILURE';
    case 'CHECKOUT_ABANDONED':
      return 'CHECKOUT_ABANDONED';
    case 'NETWORK_TIMEOUT':
      return 'NETWORK_TIMEOUT';
    case 'INTERNAL_ERROR':
      return 'INTERNAL_ERROR';
    case 'SIGNUP_ABANDONED':
      return 'SIGNUP_ABANDONED';
    case 'FREIGHT_IGNORED':
      return 'FREIGHTS_IGNORED';
    default:
      return null;
  }
}

/**
 * Classifica a causa provável da perda.
 *
 * @param summary       Resumo determinístico da jornada do usuário.
 * @param inactivityDays Limite de inatividade (dias) — acima dele entra a
 *                       candidata `PROLONGED_INACTIVITY`. Espelha
 *                       `tracking_ai_config.inactivity_days`.
 * @returns Exatamente uma `Abandonment_Cause` do domínio fechado.
 */
export function classifyAbandonmentCause(
  summary: JourneySummary,
  inactivityDays: number
): AbandonmentCause {
  const candidates = new Set<AbandonmentCause>();

  // (1) Causa do evento relevante mais recente (sinal primário).
  const lastCause = causeOfLastEvent(summary);
  if (lastCause !== null) candidates.add(lastCause);

  // (2) Cadastro iniciado e não concluído (estado). A precedência garante que
  //     uma falha posterior (last_relevant_event) vença quando houver (Req 5.4).
  if (summary.signup_started && !summary.signup_completed) {
    candidates.add('SIGNUP_ABANDONED');
  }

  // (3) Recusas de frete acima do limite.
  if (summary.freight_refusals >= FREIGHTS_IGNORED_THRESHOLD) {
    candidates.add('FREIGHTS_IGNORED');
  }

  // (4) Inatividade prolongada (Req 5.7).
  if (Number.isFinite(inactivityDays) && summary.days_since_last_access > inactivityDays) {
    candidates.add('PROLONGED_INACTIVITY');
  }

  // Resolve concorrência por precedência total fixa; `UNKNOWN` fecha a totalidade.
  for (const cause of ABANDONMENT_PRECEDENCE) {
    if (candidates.has(cause)) return cause;
  }
  return 'UNKNOWN';
}
