/**
 * operacao/logEventMap.ts — Log_Event_Map total + rótulos pt-BR (alvo de CP10).
 *
 * Cada Log_Event_Type resolve para o conjunto de action codes que o originam em
 * admin_audit_logs. Tipos SEM emissor presente (LOGOUT, CLIENT_CREATED) resolvem
 * para [] — sem fabricar registros (dependência futura). Espelha o mapeamento
 * forward/reverse da RPC admin_logs_list.
 *
 * Spec: .kiro/specs/admin-central-operacao (Task 2.13).
 */

export type LogEventType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'DISPATCH_STARTED'
  | 'DISPATCH_COMPLETED'
  | 'ERROR_OCCURRED'
  | 'CLIENT_CREATED'
  | 'PLAN_CHANGED'
  | 'AI_REPLIED'
  | 'HUMAN_TAKEOVER';

export const LOG_EVENT_TYPES: readonly LogEventType[] = [
  'LOGIN',
  'LOGOUT',
  'DISPATCH_STARTED',
  'DISPATCH_COMPLETED',
  'ERROR_OCCURRED',
  'CLIENT_CREATED',
  'PLAN_CHANGED',
  'AI_REPLIED',
  'HUMAN_TAKEOVER',
];

/**
 * Log_Event_Map: total e determinístico. Tipos sem emissor presente resolvem
 * para [] (Req 11.3). Códigos ainda não emitidos simplesmente não casam nenhuma
 * linha (fallback seguro).
 */
export const LOG_EVENT_MAP: Readonly<Record<LogEventType, readonly string[]>> = {
  LOGIN: ['ADMIN_LOGIN_SUCCESS'], // admin-foundation 030 (confirmado)
  LOGOUT: [], // sem emissor de logout de cliente hoje (dep. futura)
  DISPATCH_STARTED: ['WHATSAPP_DISPATCH_STARTED'], // whatsapp-automation 092+
  DISPATCH_COMPLETED: ['WHATSAPP_DISPATCH_COMPLETED'], // whatsapp-automation 092+
  ERROR_OCCURRED: ['JOB_FAILED', 'WHATSAPP_DISPATCH_FAILED'],
  CLIENT_CREATED: [], // sem emissor de criação de conta de cliente hoje (dep. futura)
  PLAN_CHANGED: ['SUBSCRIPTION_PLAN_CHANGED'], // assinaturas-pagamento 055/057/060
  AI_REPLIED: ['SUPORTE_AI_REPLY', 'WHATSAPP_AI_REPLY'], // suporte-inteligente 115 + whatsapp
  HUMAN_TAKEOVER: ['SUPORTE_HANDOFF', 'WHATSAPP_HUMAN_TAKEOVER'], // suporte 115 + whatsapp
};

/** Rótulos pt-BR fixos por tipo (Req 11.5). */
export const LOG_EVENT_LABEL: Readonly<Record<LogEventType, string>> = {
  LOGIN: 'Login realizado',
  LOGOUT: 'Logout',
  DISPATCH_STARTED: 'Disparo iniciado',
  DISPATCH_COMPLETED: 'Disparo concluído',
  ERROR_OCCURRED: 'Erro ocorrido',
  CLIENT_CREATED: 'Cliente criado',
  PLAN_CHANGED: 'Plano alterado',
  AI_REPLIED: 'IA respondeu',
  HUMAN_TAKEOVER: 'Atendimento humano assumiu',
};

/** Total: definida para todo LogEventType; [] quando sem emissor (Req 11.2, 11.3). */
export function resolveActionCodes(t: LogEventType): readonly string[] {
  return LOG_EVENT_MAP[t];
}
