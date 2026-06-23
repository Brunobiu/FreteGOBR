/**
 * rastreamento/stageDerivation.ts — Stage_Derivation (CP5).
 *
 * Função PURA, total e determinística que mapeia o conjunto de `Journey_Event`
 * de um usuário ao `Funnel_Stage` MAIS AVANÇADO alcançado (maior índice em
 * `FUNNEL_ORDER`). É invariante à ordem de entrada e idempotente: o mesmo
 * conjunto sempre produz a mesma etapa. Sem I/O.
 *
 * Espelha a autoridade SQL da migration 124 (derivação de etapa do funil).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 3.1).
 * _Requirements: 8.2, 4.3_
 */

import { FUNNEL_ORDER, type FunnelStage, type JourneyEventType } from './domain';

/**
 * Evento "prova" de uma etapa: a presença do evento garante que o usuário
 * alcançou aquela etapa do funil. Eventos sem prova de etapa (falhas,
 * abandonos, crashes) não aparecem aqui — não avançam o funil.
 */
const EVENT_STAGE_PROOF: Partial<Record<JourneyEventType, FunnelStage>> = {
  SITE_VISIT: 'VISITOR',
  SIGNUP_STARTED: 'SIGNUP_STARTED',
  SIGNUP_COMPLETED: 'SIGNUP_COMPLETED',
  DOCUMENT_APPROVED: 'DOCUMENTS_APPROVED',
  PAYMENT_SUCCEEDED: 'SUBSCRIPTION_PAID',
  SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_PAID',
  APP_OPENED: 'APP_ACTIVE',
  FREIGHT_VIEWED: 'APP_ACTIVE',
  FREIGHT_ACCEPTED: 'APP_ACTIVE',
  FIRST_FREIGHT_COMPLETED: 'FIRST_FREIGHT',
};

/** Índice de uma etapa em `FUNNEL_ORDER` (grau de avanço). */
export function stageIndex(stage: FunnelStage): number {
  return FUNNEL_ORDER.indexOf(stage);
}

/** Forma mínima exigida pela derivação (apenas o tipo do evento importa). */
interface StageEventLike {
  event_type: JourneyEventType;
}

/**
 * Deriva o `Funnel_Stage` mais avançado alcançado pelo conjunto de eventos.
 *
 * - Conjunto vazio ⇒ `VISITOR` (piso do funil; função total).
 * - 2+ fretes concluídos (`FIRST_FREIGHT_COMPLETED`) ⇒ `RECURRING_USER`
 *   (recorrência: completou mais de um frete).
 * - Caso contrário, a etapa de maior índice provada por algum evento.
 *
 * Determinística e invariante à ordem (depende apenas do CONJUNTO de tipos).
 */
export function deriveFunnelStage(events: readonly StageEventLike[]): FunnelStage {
  let maxIndex = 0; // VISITOR é o piso (índice 0).
  let freightCompletions = 0;

  for (const ev of events) {
    if (ev.event_type === 'FIRST_FREIGHT_COMPLETED') freightCompletions += 1;
    const proven = EVENT_STAGE_PROOF[ev.event_type];
    if (proven !== undefined) {
      const idx = FUNNEL_ORDER.indexOf(proven);
      if (idx > maxIndex) maxIndex = idx;
    }
  }

  // Recorrência: dois ou mais fretes concluídos promove a RECURRING_USER.
  if (freightCompletions >= 2) {
    return 'RECURRING_USER';
  }

  return FUNNEL_ORDER[maxIndex];
}
