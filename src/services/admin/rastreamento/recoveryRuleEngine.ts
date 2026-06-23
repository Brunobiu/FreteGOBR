/**
 * rastreamento/recoveryRuleEngine.ts — Recovery_Rule_Engine + Anti_Spam_Guard
 * (CP8/CP9).
 *
 * `decideRecovery` é PURA e determinística: dado um gatilho, o histórico de
 * `Recovery_Attempt` e a configuração de anti-spam, produz um `Recovery_Decision`
 * — `DISPATCH` (com `Recovery_Scenario`/`template_key`) ou `SUPPRESS` (com
 * `Suppression_Reason`). A IA só personaliza quando a decisão é `DISPATCH`.
 *
 * Ordem de avaliação (precedência fixa ⇒ determinismo):
 *   1. cenário inelegível          → NO_ELIGIBLE_SCENARIO
 *   2. recuperação ativa em curso  → CONCURRENT_RECOVERY_ACTIVE
 *   3. min-delay (só NEW_SIGNUP_WELCOME) → MIN_DELAY_NOT_ELAPSED
 *   4. mensagem idêntica (dedup)   → DUPLICATE_MESSAGE
 *   5. dentro do cooldown          → WITHIN_COOLDOWN
 *   6. máximo por janela atingido  → MAX_PER_WINDOW_REACHED
 *   7. caso contrário              → DISPATCH
 *
 * Espelha a autoridade SQL da migration 124 (mesma lógica server-side).
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.1).
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.11_
 */

import {
  type ContactStatus,
  type JourneyEventType,
  type RecoveryScenario,
  type SuppressionReason,
} from './domain';

/** Gatilho de recuperação (evento de jornada ou subida de risco). */
export interface RecoveryTrigger {
  kind: 'EVENT' | 'RISK';
  event_type: JourneyEventType | null;
  user_id: string;
  occurred_at: number; // epoch ms do gatilho
  is_critical: boolean;
  message_hash: string; // hash do conteúdo proposto (Dedup)
}

/** Item do histórico de tentativas de recuperação (durável). */
export interface RecoveryHistoryItem {
  scenario: RecoveryScenario;
  created_at: number; // epoch ms
  contact_status: ContactStatus;
  message_hash: string;
  trigger_event_id: string | null;
  active: boolean; // No_Concurrent: <= 1 ativa por usuário
}

/** Configuração de anti-spam (todos os tempos em ms; "agora" injetado). */
export interface AntiSpamConfig {
  now: number;
  min_delay_ms: number; // ~10min para NEW_SIGNUP_WELCOME
  cooldown_min_ms: number; // piso configurável (24h)
  cooldown_max_ms: number; // gap exigido entre disparos (72h)
  window_ms: number; // janela do Max_Per_Window
  max_per_window: number; // máximo de mensagens por janela
}

/** Resultado do motor: disparar (com cenário) ou suprimir (com motivo). */
export type RecoveryDecision =
  | { kind: 'DISPATCH'; scenario: RecoveryScenario; template_key: RecoveryScenario }
  | { kind: 'SUPPRESS'; reason: SuppressionReason };

/** Mapeia o tipo de evento ao cenário de recuperação correspondente. */
const EVENT_SCENARIO: Partial<Record<JourneyEventType, RecoveryScenario>> = {
  SIGNUP_COMPLETED: 'NEW_SIGNUP_WELCOME',
  SIGNUP_ABANDONED: 'SIGNUP_ABANDONED',
  CHECKOUT_ABANDONED: 'SIGNUP_ABANDONED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  INACTIVITY_DETECTED: 'USER_INACTIVE',
  FREIGHT_IGNORED: 'COLD_DRIVER',
};

/**
 * Resolve o `Recovery_Scenario` elegível para o gatilho, ou `null` quando
 * nenhum se aplica (⇒ `NO_ELIGIBLE_SCENARIO`).
 */
export function resolveRecoveryScenario(trigger: RecoveryTrigger): RecoveryScenario | null {
  if (trigger.event_type !== null) {
    const mapped = EVENT_SCENARIO[trigger.event_type];
    if (mapped !== undefined) return mapped;
  }
  // Gatilho por risco sem evento mapeável: recuperação de usuário inativo.
  if (trigger.kind === 'RISK') return 'USER_INACTIVE';
  return null;
}

/** Tempo decorrido (ms) desde o disparo mais recente do histórico, ou null. */
function elapsedSinceLastDispatch(
  history: readonly RecoveryHistoryItem[],
  now: number
): number | null {
  let last = Number.NEGATIVE_INFINITY;
  for (const item of history) {
    if (item.created_at > last) last = item.created_at;
  }
  if (last === Number.NEGATIVE_INFINITY) return null;
  return now - last;
}

/** Conta disparos do histórico dentro da janela `[now - window_ms, now]`. */
function countWithinWindow(
  history: readonly RecoveryHistoryItem[],
  now: number,
  windowMs: number
): number {
  const threshold = now - windowMs;
  let count = 0;
  for (const item of history) {
    if (item.created_at >= threshold && item.created_at <= now) count += 1;
  }
  return count;
}

/**
 * Decide a recuperação aplicando o motor de regras + anti-spam.
 * Determinística: mesma entrada ⇒ mesma decisão (idempotência).
 */
export function decideRecovery(
  trigger: RecoveryTrigger,
  history: readonly RecoveryHistoryItem[],
  cfg: AntiSpamConfig
): RecoveryDecision {
  // 1. Cenário elegível?
  const scenario = resolveRecoveryScenario(trigger);
  if (scenario === null) {
    return { kind: 'SUPPRESS', reason: 'NO_ELIGIBLE_SCENARIO' };
  }

  // 2. Recuperação ativa em curso (No_Concurrent).
  if (history.some((item) => item.active)) {
    return { kind: 'SUPPRESS', reason: 'CONCURRENT_RECOVERY_ACTIVE' };
  }

  // 3. Min_Delay — só para boas-vindas de cadastro (~10min após o evento).
  if (scenario === 'NEW_SIGNUP_WELCOME') {
    const sinceEvent = cfg.now - trigger.occurred_at;
    if (sinceEvent < cfg.min_delay_ms) {
      return { kind: 'SUPPRESS', reason: 'MIN_DELAY_NOT_ELAPSED' };
    }
  }

  // 4. Dedup — mesma mensagem já enviada.
  if (history.some((item) => item.message_hash === trigger.message_hash)) {
    return { kind: 'SUPPRESS', reason: 'DUPLICATE_MESSAGE' };
  }

  // 5. Cooldown — gap mínimo desde o último disparo (24–72h).
  const elapsed = elapsedSinceLastDispatch(history, cfg.now);
  if (elapsed !== null && elapsed >= 0 && elapsed < cfg.cooldown_max_ms) {
    return { kind: 'SUPPRESS', reason: 'WITHIN_COOLDOWN' };
  }

  // 6. Max_Per_Window — limite de mensagens por janela (1 por evento crítico).
  if (countWithinWindow(history, cfg.now, cfg.window_ms) >= cfg.max_per_window) {
    return { kind: 'SUPPRESS', reason: 'MAX_PER_WINDOW_REACHED' };
  }

  // 7. Autorizado.
  return { kind: 'DISPATCH', scenario, template_key: scenario };
}

/** Configuração padrão de anti-spam (10min / 24h / 72h / 1 por 24h). */
export function defaultAntiSpamConfig(now: number): AntiSpamConfig {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  return {
    now,
    min_delay_ms: 10 * MIN,
    cooldown_min_ms: 24 * HOUR,
    cooldown_max_ms: 72 * HOUR,
    window_ms: 24 * HOUR,
    max_per_window: 1,
  };
}
