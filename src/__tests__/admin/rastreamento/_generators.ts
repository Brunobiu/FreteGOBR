/**
 * Geradores fast-check locais do Tracking_Module (admin-rastreamento-inteligente).
 *
 * Reusa os helpers canônicos de `src/__tests__/_helpers/generators.ts`
 * (`validPhone`/`validEmail`/`safeText`/`uuidLike`) respeitando as convenções
 * do projeto: NUNCA `fc.stringOf`; PII só via `fc.constantFrom` (telefone
 * mascarado a partir de `validPhone`).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 1.4).
 * _Requirements: 17.4_
 */

import fc from 'fast-check';

import {
  JOURNEY_EVENT_TYPES,
  FUNNEL_ORDER,
  ABANDONMENT_CAUSES,
  RISK_BANDS,
  RISK_CATEGORIES,
  CONTACT_STATUSES,
  type FunnelStage,
} from '../../../services/admin/rastreamento/domain';
import { type JourneyEvent, type JourneySummary } from '../../../services/admin/rastreamento/journeySummary';
import { type RiskFactors } from '../../../services/admin/rastreamento/riskScore';
import { type StageCounts } from '../../../services/admin/rastreamento/funnelMetrics';
import {
  type RecoveryTrigger,
  type RecoveryHistoryItem,
  type AntiSpamConfig,
} from '../../../services/admin/rastreamento/recoveryRuleEngine';
import { type AtRiskRow, type TrackingFilterInput } from '../../../services/admin/rastreamento/atRiskList';
import { safeText, validPhone, uuidLike } from '../../_helpers/generators';

/** Base de tempo fixa (epoch ms) para "agora" determinístico nos testes. */
export const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mascara um telefone válido preservando DDD e os 2 últimos dígitos. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const ddd = digits.slice(0, 2);
  const last2 = digits.slice(-2);
  return `(${ddd}) ****-**${last2}`;
}

/** Arbitrary de telefone JÁ mascarado (sem PII bruta). */
export function maskedPhone(): fc.Arbitrary<string> {
  return validPhone().map(maskPhone);
}

/** Arbitrary de um Journey_Event com `occurred_at` em torno de NOW_MS. */
export function journeyEventArb(): fc.Arbitrary<JourneyEvent> {
  return fc.record({
    event_type: fc.constantFrom(...JOURNEY_EVENT_TYPES),
    occurred_at: fc
      .integer({ min: 0, max: 90 })
      .map((daysAgo) => NOW_MS - daysAgo * DAY_MS + (daysAgo % 3) * 1000),
  });
}

/** Lista de Journey_Event (0..20 eventos). */
export function journeyEventsArb(): fc.Arbitrary<JourneyEvent[]> {
  return fc.array(journeyEventArb(), { minLength: 0, maxLength: 20 });
}

/** Arbitrary de Journey_Summary arbitrário (totalidade do classificador). */
export function journeySummaryArb(): fc.Arbitrary<JourneySummary> {
  return fc.record({
    current_stage: fc.constantFrom(...FUNNEL_ORDER),
    days_since_last_access: fc.integer({ min: 0, max: 365 }),
    recent_failures: fc.nat({ max: 20 }),
    frustrated_attempts: fc.nat({ max: 20 }),
    freight_refusals: fc.nat({ max: 20 }),
    no_conversion: fc.boolean(),
    last_relevant_event: fc.option(fc.constantFrom(...JOURNEY_EVENT_TYPES), { nil: null }),
    signup_started: fc.boolean(),
    signup_completed: fc.boolean(),
  });
}

/** Arbitrary de Risk_Factors (todos finitos ≥ 0). */
export function riskFactorsArb(): fc.Arbitrary<RiskFactors> {
  return fc.record({
    days_since_last_access: fc.nat({ max: 365 }),
    recent_failures: fc.nat({ max: 50 }),
    frustrated_attempts: fc.nat({ max: 50 }),
    freight_refusals: fc.nat({ max: 50 }),
    no_conversion: fc.constantFrom(0 as const, 1 as const),
  });
}

/**
 * Arbitrary de StageCounts NÃO-CRESCENTE ao longo de FUNNEL_ORDER (funil bem
 * formado: cada etapa ≤ anterior). Base do CP6 (monotonicidade do funil).
 */
export function stageCountsArb(): fc.Arbitrary<StageCounts> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: 5000 }),
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
        minLength: FUNNEL_ORDER.length - 1,
        maxLength: FUNNEL_ORDER.length - 1,
      })
    )
    .map(([start, ratios]) => {
      const counts = {} as StageCounts;
      let current = start;
      counts[FUNNEL_ORDER[0]] = current;
      for (let i = 1; i < FUNNEL_ORDER.length; i += 1) {
        current = Math.floor(current * ratios[i - 1]);
        counts[FUNNEL_ORDER[i] as FunnelStage] = current;
      }
      return counts;
    });
}

/** Arbitrary de RecoveryTrigger. */
export function recoveryTriggerArb(): fc.Arbitrary<RecoveryTrigger> {
  return fc.record({
    kind: fc.constantFrom('EVENT' as const, 'RISK' as const),
    event_type: fc.option(fc.constantFrom(...JOURNEY_EVENT_TYPES), { nil: null }),
    user_id: uuidLike(),
    occurred_at: fc.integer({ min: NOW_MS - 90 * DAY_MS, max: NOW_MS }),
    is_critical: fc.boolean(),
    message_hash: fc.constantFrom('h-a', 'h-b', 'h-c', 'h-d'),
  });
}

/** Arbitrary de um item do histórico de recuperação. */
export function recoveryHistoryItemArb(): fc.Arbitrary<RecoveryHistoryItem> {
  return fc.record({
    scenario: fc.constantFrom(
      'NEW_SIGNUP_WELCOME' as const,
      'SIGNUP_ABANDONED' as const,
      'PAYMENT_FAILED' as const,
      'USER_INACTIVE' as const,
      'COLD_DRIVER' as const
    ),
    created_at: fc.integer({ min: NOW_MS - 90 * DAY_MS, max: NOW_MS }),
    contact_status: fc.constantFrom(...CONTACT_STATUSES),
    message_hash: fc.constantFrom('h-a', 'h-b', 'h-c', 'h-d'),
    trigger_event_id: fc.option(uuidLike(), { nil: null }),
    active: fc.boolean(),
  });
}

/** Lista de histórico (0..6 itens). */
export function recoveryHistoryArb(): fc.Arbitrary<RecoveryHistoryItem[]> {
  return fc.array(recoveryHistoryItemArb(), { minLength: 0, maxLength: 6 });
}

/** Arbitrary de AntiSpamConfig com `now` = NOW_MS e janelas coerentes. */
export function antiSpamConfigArb(): fc.Arbitrary<AntiSpamConfig> {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  return fc.record({
    now: fc.constant(NOW_MS),
    min_delay_ms: fc.constantFrom(5 * MIN, 10 * MIN, 15 * MIN),
    cooldown_min_ms: fc.constant(24 * HOUR),
    cooldown_max_ms: fc.constant(72 * HOUR),
    window_ms: fc.constantFrom(24 * HOUR, 48 * HOUR),
    max_per_window: fc.constantFrom(1, 2, 3),
  });
}

/** Arbitrary de uma linha da At_Risk_List (telefone mascarado, sem PII bruta). */
export function atRiskRowArb(): fc.Arbitrary<AtRiskRow> {
  return fc.record({
    user_id: uuidLike(),
    risk_score: fc.integer({ min: 0, max: 100 }),
    risk_band: fc.constantFrom(...RISK_BANDS),
    abandonment_cause: fc.constantFrom(...ABANDONMENT_CAUSES),
    risk_category: fc.constantFrom(...RISK_CATEGORIES),
    contact_status: fc.constantFrom(...CONTACT_STATUSES),
    name: safeText(1, 30),
    phone_masked: maskedPhone(),
    profile: fc.constantFrom('motorista' as const, 'embarcador' as const),
    last_activity_at: fc.integer({ min: NOW_MS - 90 * DAY_MS, max: NOW_MS }),
  });
}

/** Arbitrary de TrackingFilterInput (campos opcionais; faixas possivelmente impossíveis). */
export function trackingFilterArb(): fc.Arbitrary<TrackingFilterInput> {
  return fc.record(
    {
      text: fc.option(safeText(1, 8), { nil: undefined }),
      risk_category: fc.option(fc.constantFrom(...RISK_CATEGORIES), { nil: undefined }),
      min_score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
      max_score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
      problem_type: fc.option(fc.constantFrom(...ABANDONMENT_CAUSES), { nil: undefined }),
      from: fc.option(fc.integer({ min: NOW_MS - 90 * DAY_MS, max: NOW_MS }), { nil: undefined }),
      to: fc.option(fc.integer({ min: NOW_MS - 90 * DAY_MS, max: NOW_MS }), { nil: undefined }),
      profile: fc.option(fc.constantFrom('motorista' as const, 'embarcador' as const), {
        nil: undefined,
      }),
    },
    { requiredKeys: [] }
  );
}
