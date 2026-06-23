/**
 * rastreamento/domain.ts — domínios fechados do Tracking_Module (PatGo).
 *
 * Fonte única de verdade no front; **espelha** byte a byte os CHECK da
 * migration 124 (`journey_events.event_type`, `surface`, `recovery_scenario`,
 * `contact_status`, `tracking_ai_config.active_provider`, etc.). Valores fora
 * destes conjuntos são rejeitados na ingestão/escrita server-side.
 *
 * Sem I/O e sem efeitos — apenas constantes `as const` + tipos derivados.
 * Reusado por todo o núcleo puro determinístico
 * (`abandonmentClassifier`/`riskScore`/`stageDerivation`/`funnelMetrics`/
 * `recoveryRuleEngine`/`atRiskList`/`recoveryPerformance`/`csvExport`).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 1.1).
 * _Requirements: 3.1, 3.5, 5.1, 6.6, 7.1, 8.1, 9.3, 11.1_
 */

// ─── Journey_Event_Type — domínio fechado e finito (fixado na 124) ──────────

/**
 * Tipos de evento de jornada. Conjunto exato fixado pela migration 124; itens
 * fora do conjunto são rejeitados na ingestão com `INVALID_EVENT_TYPE`.
 */
export const JOURNEY_EVENT_TYPES = [
  'SITE_VISIT',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'SIGNUP_ABANDONED',
  'DOCUMENT_UPLOAD_STARTED',
  'DOCUMENT_UPLOAD_FAILED',
  'DOCUMENT_APPROVED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'CHECKOUT_STARTED',
  'CHECKOUT_ABANDONED',
  'PAYMENT_STARTED',
  'PAYMENT_FAILED',
  'PAYMENT_SUCCEEDED',
  'SUBSCRIPTION_ACTIVATED',
  'APP_OPENED',
  'APP_CRASH',
  'FREIGHT_VIEWED',
  'FREIGHT_IGNORED',
  'FREIGHT_ACCEPTED',
  'FIRST_FREIGHT_COMPLETED',
  'INACTIVITY_DETECTED',
  'INTERNAL_ERROR',
  'NETWORK_TIMEOUT',
] as const;
export type JourneyEventType = (typeof JOURNEY_EVENT_TYPES)[number];

// ─── Journey_Surface — origem do evento ─────────────────────────────────────

/** Superfícies do produto que emitem eventos de jornada. */
export const JOURNEY_SURFACES = ['SITE', 'DASHBOARD', 'APP'] as const;
export type JourneySurface = (typeof JOURNEY_SURFACES)[number];

// ─── Funnel_Stage — domínio ORDENADO (índice = avanço no funil) ─────────────

/**
 * Etapas do funil em ordem significativa: o índice no array é o grau de avanço
 * (VISITOR = 0 … RECURRING_USER = 7). `Stage_Derivation` retorna a etapa de
 * maior índice alcançada.
 */
export const FUNNEL_ORDER = [
  'VISITOR',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'DOCUMENTS_APPROVED',
  'SUBSCRIPTION_PAID',
  'APP_ACTIVE',
  'FIRST_FREIGHT',
  'RECURRING_USER',
] as const;
export type FunnelStage = (typeof FUNNEL_ORDER)[number];

// ─── Abandonment_Cause — domínio fechado (UNKNOWN = totalidade) ─────────────

/** Causas prováveis de perda. `UNKNOWN` é o fallback de totalidade. */
export const ABANDONMENT_CAUSES = [
  'SIGNUP_ABANDONED',
  'UPLOAD_ERROR',
  'LOGIN_FAILURE',
  'PAYMENT_DECLINED',
  'CHECKOUT_ABANDONED',
  'APP_CRASH',
  'PROLONGED_INACTIVITY',
  'FREIGHTS_IGNORED',
  'INTERNAL_ERROR',
  'NETWORK_TIMEOUT',
  'UNKNOWN',
] as const;
export type AbandonmentCause = (typeof ABANDONMENT_CAUSES)[number];

/**
 * Ordem de precedência TOTAL e fixa entre causas concorrentes (tiebreaker
 * determinístico do `Abandonment_Cause_Classifier`). A primeira causa aplicável
 * nesta ordem vence; `UNKNOWN` é sempre o último (totalidade).
 */
export const ABANDONMENT_PRECEDENCE: readonly AbandonmentCause[] = [
  'APP_CRASH',
  'PAYMENT_DECLINED',
  'UPLOAD_ERROR',
  'LOGIN_FAILURE',
  'CHECKOUT_ABANDONED',
  'SIGNUP_ABANDONED',
  'NETWORK_TIMEOUT',
  'INTERNAL_ERROR',
  'FREIGHTS_IGNORED',
  'PROLONGED_INACTIVITY',
  'UNKNOWN',
];

// ─── Risk_Band — faixa derivada do Risk_Score ───────────────────────────────

/** Faixas de risco em ordem crescente de severidade. */
export const RISK_BANDS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

// ─── Risk_Category — categorias da At_Risk_List ─────────────────────────────

/** Categorias da lista de usuários em risco. */
export const RISK_CATEGORIES = [
  'SIGNUP_ABANDONED',
  'PAYMENT_PENDING',
  'INACTIVE',
  'COLD_DRIVER',
  'RECURRING_ERROR',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

// ─── Recovery_Scenario — cenários de recuperação ────────────────────────────

/** Cenários de recuperação ativa. */
export const RECOVERY_SCENARIOS = [
  'NEW_SIGNUP_WELCOME',
  'SIGNUP_ABANDONED',
  'PAYMENT_FAILED',
  'USER_INACTIVE',
  'COLD_DRIVER',
] as const;
export type RecoveryScenario = (typeof RECOVERY_SCENARIOS)[number];

// ─── Suppression_Reason — motivos de supressão do Anti_Spam_Guard ───────────

/** Motivos pelos quais o motor suprime um disparo (`SUPPRESS`). */
export const SUPPRESSION_REASONS = [
  'WITHIN_COOLDOWN',
  'MAX_PER_WINDOW_REACHED',
  'DUPLICATE_MESSAGE',
  'CONCURRENT_RECOVERY_ACTIVE',
  'MIN_DELAY_NOT_ELAPSED',
  'NO_ELIGIBLE_SCENARIO',
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

// ─── Contact_Status — estado de contato em recuperação ──────────────────────

/**
 * Estados de contato em ordem de progressão. `Contact_Status` só avança nesta
 * ordem (nunca retrocede): AT_RISK → CONTACTED → REPLIED → CONVERTED.
 */
export const CONTACT_STATUSES = ['AT_RISK', 'CONTACTED', 'REPLIED', 'CONVERTED'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

// ─── Time_Window — janelas de agregação ─────────────────────────────────────

/** Janelas de tempo fechadas de agregação. */
export const TIME_WINDOWS = ['24h', '7d', '30d', '90d'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

/** Provedores de IA reusados da Provider_Abstraction (admin-assistant). */
export const AI_PROVIDERS = ['claude', 'gemini', 'grok', 'llama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

// ─── Type guards (deny-by-default) ──────────────────────────────────────────

/** `true` sse `value` pertence ao domínio fechado Journey_Event_Type. */
export function isJourneyEventType(value: unknown): value is JourneyEventType {
  return typeof value === 'string' && (JOURNEY_EVENT_TYPES as readonly string[]).includes(value);
}

/** `true` sse `value` pertence ao domínio fechado Journey_Surface. */
export function isJourneySurface(value: unknown): value is JourneySurface {
  return typeof value === 'string' && (JOURNEY_SURFACES as readonly string[]).includes(value);
}

/** `true` sse `value` é um Time_Window válido. */
export function isTimeWindow(value: unknown): value is TimeWindow {
  return typeof value === 'string' && (TIME_WINDOWS as readonly string[]).includes(value);
}

/** Janela default aplicada quando a entrada é ausente ou inválida (Req 8.10). */
export const DEFAULT_TIME_WINDOW: TimeWindow = '7d';

/** Normaliza um Time_Window, caindo no default quando ausente/ inválido. */
export function normalizeTimeWindow(value: unknown): TimeWindow {
  return isTimeWindow(value) ? value : DEFAULT_TIME_WINDOW;
}

/** Tamanhos de página permitidos na At_Risk_List (default 10). */
export const PAGE_SIZES = [10, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** Tamanho de página default. */
export const DEFAULT_PAGE_SIZE: PageSize = 10;

/** Normaliza o page_size para o conjunto fechado {10,50,100} (default 10). */
export function normalizePageSize(value: unknown): PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value as number)
    ? (value as PageSize)
    : DEFAULT_PAGE_SIZE;
}
