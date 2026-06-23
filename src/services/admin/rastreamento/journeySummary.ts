/**
 * rastreamento/journeySummary.ts — `Journey_Summary` builder (PURO).
 *
 * Derivação determinística e total do resumo de jornada de um usuário a partir
 * dos seus `Journey_Event`. O "agora" (`nowMs`) é SEMPRE injetado — nunca usa
 * `Date.now()` interno — para garantir determinismo e testabilidade. É a
 * entrada do `Abandonment_Cause_Classifier` (CP1) e do `Risk_Score_Calculator`
 * (CP2/CP3). Sem I/O.
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 2.1).
 * _Requirements: 5.1, 6.5_
 */

import { type FunnelStage, type JourneyEventType } from './domain';
import { deriveFunnelStage } from './stageDerivation';

/** Um evento de jornada (epoch ms em `occurred_at`). */
export interface JourneyEvent {
  event_type: JourneyEventType;
  occurred_at: number; // epoch ms
}

/** Resumo determinístico de jornada — entrada do classificador e do score. */
export interface JourneySummary {
  /** Etapa mais avançada alcançada (onde o usuário "parou"). */
  current_stage: FunnelStage;
  /** Dias inteiros desde o evento mais recente (0 quando não há eventos). */
  days_since_last_access: number;
  /** Falhas (upload/login/payment/network/internal/crash) na janela recente. */
  recent_failures: number;
  /** Tentativas frustradas repetidas (login/upload) na janela recente. */
  frustrated_attempts: number;
  /** Quantidade de fretes ignorados (`FREIGHT_IGNORED`), em todo o histórico. */
  freight_refusals: number;
  /** `true` quando o usuário nunca pagou nem assinou. */
  no_conversion: boolean;
  /** Evento relevante (problemático) mais recente, ou `null` se não houver. */
  last_relevant_event: JourneyEventType | null;
  /** `true` se há `SIGNUP_STARTED` (ou `SIGNUP_COMPLETED`). */
  signup_started: boolean;
  /** `true` se há `SIGNUP_COMPLETED`. */
  signup_completed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela "recente" para contagem de falhas/tentativas frustradas (7 dias). */
export const RECENT_WINDOW_MS = 7 * DAY_MS;

/** Eventos que contam como falha recente. */
const FAILURE_EVENTS: ReadonlySet<JourneyEventType> = new Set<JourneyEventType>([
  'DOCUMENT_UPLOAD_FAILED',
  'LOGIN_FAILED',
  'PAYMENT_FAILED',
  'NETWORK_TIMEOUT',
  'INTERNAL_ERROR',
  'APP_CRASH',
]);

/** Eventos que contam como tentativa frustrada (login/upload). */
const FRUSTRATED_EVENTS: ReadonlySet<JourneyEventType> = new Set<JourneyEventType>([
  'LOGIN_FAILED',
  'DOCUMENT_UPLOAD_FAILED',
]);

/** Eventos que comprovam conversão (pagou/assinou). */
const CONVERSION_EVENTS: ReadonlySet<JourneyEventType> = new Set<JourneyEventType>([
  'PAYMENT_SUCCEEDED',
  'SUBSCRIPTION_ACTIVATED',
]);

/**
 * Eventos "relevantes" (problemáticos) candidatos a `last_relevant_event`, com
 * prioridade de desempate quando dois ocorrem no mesmo `occurred_at`. A maior
 * prioridade reflete a gravidade (alinhada à `ABANDONMENT_PRECEDENCE`), o que
 * mantém o classificador determinístico mesmo com timestamps empatados.
 */
const RELEVANT_PRIORITY: Partial<Record<JourneyEventType, number>> = {
  APP_CRASH: 10,
  PAYMENT_FAILED: 9,
  DOCUMENT_UPLOAD_FAILED: 8,
  LOGIN_FAILED: 7,
  CHECKOUT_ABANDONED: 6,
  SIGNUP_ABANDONED: 5,
  NETWORK_TIMEOUT: 4,
  INTERNAL_ERROR: 3,
  FREIGHT_IGNORED: 2,
};

/**
 * Constrói o `Journey_Summary` a partir dos eventos e do instante `nowMs`.
 *
 * Determinística e independente da ordem de entrada: agregações por contagem e
 * a escolha de `last_relevant_event` (maior `occurred_at`, desempate por
 * prioridade fixa) não dependem da ordem do array.
 */
export function buildJourneySummary(
  events: readonly JourneyEvent[],
  nowMs: number
): JourneySummary {
  const current_stage: FunnelStage = deriveFunnelStage(events);

  let lastAccessMs = Number.NEGATIVE_INFINITY;
  let recent_failures = 0;
  let frustrated_attempts = 0;
  let freight_refusals = 0;
  let hasConversion = false;
  let signup_started = false;
  let signup_completed = false;

  let best: { type: JourneyEventType; occurred_at: number; prio: number } | null = null;
  const recentThreshold = nowMs - RECENT_WINDOW_MS;

  for (const ev of events) {
    if (ev.occurred_at > lastAccessMs) lastAccessMs = ev.occurred_at;

    if (ev.event_type === 'SIGNUP_STARTED' || ev.event_type === 'SIGNUP_COMPLETED') {
      signup_started = true;
    }
    if (ev.event_type === 'SIGNUP_COMPLETED') signup_completed = true;
    if (CONVERSION_EVENTS.has(ev.event_type)) hasConversion = true;
    if (ev.event_type === 'FREIGHT_IGNORED') freight_refusals += 1;

    if (ev.occurred_at >= recentThreshold) {
      if (FAILURE_EVENTS.has(ev.event_type)) recent_failures += 1;
      if (FRUSTRATED_EVENTS.has(ev.event_type)) frustrated_attempts += 1;
    }

    const prio = RELEVANT_PRIORITY[ev.event_type];
    if (prio !== undefined) {
      const isMoreRecent = best === null || ev.occurred_at > best.occurred_at;
      const isTieHigherPrio =
        best !== null && ev.occurred_at === best.occurred_at && prio > best.prio;
      if (isMoreRecent || isTieHigherPrio) {
        best = { type: ev.event_type, occurred_at: ev.occurred_at, prio };
      }
    }
  }

  const days_since_last_access =
    lastAccessMs === Number.NEGATIVE_INFINITY
      ? 0
      : Math.max(0, Math.floor((nowMs - lastAccessMs) / DAY_MS));

  return {
    current_stage,
    days_since_last_access,
    recent_failures,
    frustrated_attempts,
    freight_refusals,
    no_conversion: !hasConversion,
    last_relevant_event: best === null ? null : best.type,
    signup_started,
    signup_completed,
  };
}
