/**
 * rastreamento/recoveryPerformance.ts — Recovery_Rate + progressão de
 * Contact_Status (CP11).
 *
 * Funções PURAS e determinísticas. `computeRecoveryRate = CONVERTED / CONTACTED`
 * em `[0, 1]` (0 quando `CONTACTED = 0`). `canTransitionContactStatus` só admite
 * AVANÇO na ordem `AT_RISK → CONTACTED → REPLIED → CONVERTED` — nunca retrocesso
 * nem permanência no mesmo estado.
 *
 * Espelha a autoridade SQL da migration 124 (contadores + atualização de status).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.6).
 * _Requirements: 11.1, 11.2, 11.3, 11.6_
 */

import { CONTACT_STATUSES, type ContactStatus } from './domain';
import { clamp01 } from './funnelMetrics';

/** Contadores de usuários por Contact_Status (por Time_Window). */
export interface RecoveryCounts {
  AT_RISK: number;
  CONTACTED: number;
  REPLIED: number;
  CONVERTED: number;
}

/**
 * Calcula a `Recovery_Rate = CONVERTED / CONTACTED`, clampada a `[0, 1]`.
 * Retorna 0 quando `CONTACTED` é 0 (ou não-positivo/ não-finito).
 */
export function computeRecoveryRate(c: RecoveryCounts): number {
  const contacted = Number.isFinite(c.CONTACTED) ? c.CONTACTED : 0;
  const converted = Number.isFinite(c.CONVERTED) ? c.CONVERTED : 0;
  if (!(contacted > 0)) return 0;
  return clamp01(converted / contacted);
}

/** Índice ordinal de um Contact_Status (grau de progressão). */
export function contactStatusIndex(status: ContactStatus): number {
  return CONTACT_STATUSES.indexOf(status);
}

/**
 * `true` sse `to` é um AVANÇO estrito sobre `from` na ordem
 * `AT_RISK → CONTACTED → REPLIED → CONVERTED`. Permanecer no mesmo estado ou
 * retroceder ⇒ `false`.
 */
export function canTransitionContactStatus(from: ContactStatus, to: ContactStatus): boolean {
  return contactStatusIndex(to) > contactStatusIndex(from);
}
