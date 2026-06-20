/**
 * supervisor/summaryBuilder.ts — Summary_Builder (alvo de CP5).
 *
 * Monta o texto pt-BR do Periodic_Summary a partir de agregados (sem PII) e a
 * Insight_Dedup_Key idempotente por janela. Determinístico e total. Espelha o
 * texto e o dedup_key da RPC supervisor_generate_summary.
 *
 * Spec: .kiro/specs/admin-ia-supervisora (Task 2.4).
 */

export type SummaryPeriod = 'daily' | 'weekly' | 'monthly';

export interface SummaryInput {
  signups: number;
  subscriptions: number;
  ticketsOpen: number;
  alertsOpen: number;
}

function n(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Texto pt-BR fixo do resumo — só agregados, nunca PII. Determinístico: mesma
 * entrada ⇒ mesmo texto.
 */
export function buildSummaryText(input: SummaryInput): string {
  return (
    `Resumo do dia: ${n(input.signups)} novos cadastros, ` +
    `${n(input.subscriptions)} assinaturas ativas, ` +
    `${n(input.ticketsOpen)} atendimentos abertos, ` +
    `${n(input.alertsOpen)} alertas para sua atenção.`
  );
}

/** Insight_Dedup_Key do resumo (idempotência por janela). Ex.: SUMMARY:daily:2026-06-19. */
export function summaryDedupKey(period: SummaryPeriod, bucket: string): string {
  return `SUMMARY:${period}:${bucket}`;
}
