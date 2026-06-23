/**
 * rastreamento/recoveryContext.ts — contexto mínimo de IA + logs estruturados
 * de supressão (PUROS, sem PII).
 *
 * O contexto enviado à `Provider_Abstraction` (admin-assistant) é MÍNIMO: apenas
 * o `Recovery_Scenario` e os campos determinísticos autorizados (etapa, banda,
 * causa) + o template padrão. NUNCA inclui PII bruta (nome, CPF, e-mail,
 * telefone), `user_id`, segredos ou chave de IA. Cada supressão automática vira
 * um log estruturado (`level`/`ts`/`event`/`reason`) sem conteúdo de mensagem.
 *
 * Reusado pela camada de serviço (Task 8) na personalização e na observabilidade.
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.10 / 8.3).
 * _Requirements: 9.11, 10.4, 12.3, 15.6_
 */

import {
  type AbandonmentCause,
  type FunnelStage,
  type RecoveryScenario,
  type RiskBand,
  type SuppressionReason,
} from './domain';
import { DEFAULT_TEMPLATES } from './messageTemplates';

/** Contexto mínimo e SEM PII enviado ao provedor de IA para personalização. */
export interface MinimalAiContext {
  scenario: RecoveryScenario;
  current_stage: FunnelStage;
  risk_band: RiskBand;
  abandonment_cause: AbandonmentCause;
  /** Template padrão do cenário (fallback e base da personalização). */
  template: string;
}

/** Entrada (determinística) para o contexto mínimo de IA. */
export interface MinimalAiContextInput {
  scenario: RecoveryScenario;
  current_stage: FunnelStage;
  risk_band: RiskBand;
  abandonment_cause: AbandonmentCause;
}

/**
 * Constrói o contexto mínimo de IA. Por construção não carrega PII nem `user_id`:
 * apenas enums determinísticos e o template padrão.
 */
export function buildMinimalAiContext(input: MinimalAiContextInput): MinimalAiContext {
  return {
    scenario: input.scenario,
    current_stage: input.current_stage,
    risk_band: input.risk_band,
    abandonment_cause: input.abandonment_cause,
    template: DEFAULT_TEMPLATES[input.scenario],
  };
}

/** Linha de log estruturado contínuo (sem PII/segredo/stack). */
export interface StructuredLogLine {
  level: 'info' | 'warn' | 'error';
  ts: number;
  event: string;
  [key: string]: unknown;
}

/** Log estruturado de uma supressão automática (apenas o motivo, sem mensagem). */
export function buildSuppressionLog(reason: SuppressionReason, nowMs: number): StructuredLogLine {
  return { level: 'info', ts: nowMs, event: 'recovery_suppressed', reason };
}

/** Log estruturado de falha na delegação de envio (sem PII nem stack ao cliente). */
export function buildDispatchFailureLog(scenario: RecoveryScenario, nowMs: number): StructuredLogLine {
  return { level: 'error', ts: nowMs, event: 'recovery_dispatch_failed', scenario };
}
