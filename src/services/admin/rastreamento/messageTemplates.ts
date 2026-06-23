/**
 * rastreamento/messageTemplates.ts — templates padrão por Recovery_Scenario.
 *
 * Mensagens pt-BR usadas como **fallback de degradação controlada** quando a
 * personalização por IA falha, retorna provedor não implementado ou nenhum
 * provedor está configurado (Req 10.5, 12.6). Sem PII bruta nem segredos: usam
 * apenas o placeholder `{nome}`, preenchido na borda de envio (nunca aqui).
 *
 * Espelha os templates fixados na migration 124.
 *
 * Spec: .kiro/specs/admin-rastreamento-inteligente (Task 4.8).
 * _Requirements: 10.5, 12.6_
 */

import { RECOVERY_SCENARIOS, type RecoveryScenario } from './domain';

/** Templates padrão por cenário (pt-BR, sem PII). */
export const DEFAULT_TEMPLATES: Readonly<Record<RecoveryScenario, string>> = {
  NEW_SIGNUP_WELCOME:
    'Olá, {nome}! Boas-vindas ao FreteGO. Posso ajudar a dar os primeiros passos e encontrar seu primeiro frete?',
  SIGNUP_ABANDONED:
    'Olá, {nome}! Vi que você começou seu cadastro no FreteGO. Quer ajuda para concluir? É rápido e gratuito.',
  PAYMENT_FAILED:
    'Olá, {nome}! Não conseguimos confirmar seu pagamento no FreteGO. Posso te ajudar a resolver e ativar seu acesso?',
  USER_INACTIVE:
    'Olá, {nome}! Sentimos sua falta no FreteGO. Há novos fretes na sua região. Quer dar uma olhada?',
  COLD_DRIVER:
    'Olá, {nome}! Separamos fretes que combinam com seu perfil no FreteGO. Posso te enviar as melhores opções?',
};

/** Retorna o template padrão de um cenário (sempre definido — totalidade). */
export function defaultTemplateFor(scenario: RecoveryScenario): string {
  return DEFAULT_TEMPLATES[scenario];
}

/** `true` sse há template padrão para todos os cenários (invariante de cobertura). */
export function hasAllScenarioTemplates(): boolean {
  return RECOVERY_SCENARIOS.every((s) => typeof DEFAULT_TEMPLATES[s] === 'string');
}
