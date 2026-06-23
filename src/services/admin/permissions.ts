/**
 * permissions.ts
 *
 * Permission_Matrix do RBAC admin. Fonte unica de verdade no front.
 * Espelhada na funcao SQL is_admin_with_permission (migration 030).
 *
 * Funcoes puras, sem efeitos colaterais. Deny by default.
 */

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPORTE' | 'FINANCEIRO' | 'MODERADOR';

export const ADMIN_ACTIONS = [
  'USER_VIEW',
  'USER_EDIT',
  'USER_DELETE',
  'USER_TOGGLE_ACTIVE',
  'FRETE_VIEW',
  'FRETE_EDIT',
  'FRETE_DELETE',
  'FRETE_FORCE_CLOSE',
  'FINANCEIRO_VIEW',
  'FINANCEIRO_EDIT',
  'BLACKLIST_VIEW',
  /**
   * @deprecated Substituida por BLACKLIST_MANAGE em admin-blacklist (migration 035).
   * Mantida no enum durante transicao para evitar quebra retroativa.
   * Sera removida em uma migracao futura quando todo codigo consumidor
   * estiver migrado para BLACKLIST_MANAGE.
   */
  'BLACKLIST_EDIT',
  'BLACKLIST_MANAGE',
  'BLACKLIST_BULK',
  'CRM_VIEW',
  'CRM_EDIT',
  'SUPORTE_VIEW',
  'SUPORTE_REPLY',
  'SETTINGS_VIEW',
  'SETTINGS_EDIT',
  'AUDIT_VIEW',
  'ADMIN_ROLE_GRANT',
  'ADMIN_ROLE_REVOKE',
  'DASHBOARD_VIEW',
  'ASSISTANT_VIEW',
  'ASSISTANT_EDIT',
  // Modulo Marketing (admin-marketing, migration 048). Concedidas a
  // SUPER_ADMIN (via wildcard) e ADMIN (via allow-all menos ADMIN_DENY).
  // NAO entram em ADMIN_DENY nem nos *_PERMS de SUPORTE/FINANCEIRO/MODERADOR:
  // negacao por construcao para esses papeis (Req 2.1-2.4).
  'MARKETING_VIEW',
  'MARKETING_EDIT',
  // Central de Suporte Inteligente (suporte-inteligente, migration 115).
  // FAQ_VIEW e concedida tambem ao papel SUPORTE (alem de ADMIN via allow-all
  // e SUPER_ADMIN via wildcard). FAQ_EDIT e SUPORTE_AI_CONFIG ficam so para
  // ADMIN/SUPER_ADMIN (NAO entram em ADMIN_DENY nem nos *_PERMS restritos).
  'FAQ_VIEW',
  'FAQ_EDIT',
  'SUPORTE_AI_CONFIG',
  // Cliente 360 (admin-cliente-360, migration 116): observacoes internas do
  // admin sobre um Cliente. Concedidas SOMENTE a SUPER_ADMIN (via wildcard) e
  // ADMIN (via allow-all menos ADMIN_DENY). NAO entram em ADMIN_DENY nem nos
  // *_PERMS de SUPORTE/FINANCEIRO/MODERADOR: negacao por construcao para esses
  // papeis (Req 13.2, 13.3). Espelha is_admin_with_permission re-asserida na 116.
  'USER_NOTE_VIEW',
  'USER_NOTE_EDIT',
  // Central de Operação (admin-central-operacao, migration 117): alertas e logs
  // operacionais. Concedidas SOMENTE a SUPER_ADMIN (wildcard) e ADMIN (allow-all
  // menos ADMIN_DENY). NAO entram em ADMIN_DENY nem nos *_PERMS de SUPORTE/
  // FINANCEIRO/MODERADOR (negação por construção). DASHBOARD_VIEW é reusada para
  // o Operations_Dashboard, sem redefinir a concessão por papel.
  'ALERT_VIEW',
  'ALERT_ACK',
  'ALERT_RESOLVE',
  'LOG_VIEW',
  // IA Supervisora (admin-ia-supervisora, migration 118): console/chat/diagnóstico/
  // insights (SUPERVISOR_VIEW) e reconhecer/descartar insights (SUPERVISOR_MANAGE).
  // Concedidas SOMENTE a SUPER_ADMIN (wildcard) e ADMIN (allow-all menos ADMIN_DENY).
  // NAO entram em ADMIN_DENY nem nos *_PERMS de SUPORTE/FINANCEIRO/MODERADOR
  // (negação por construção). Espelha is_admin_with_permission re-asserida na 118.
  'SUPERVISOR_VIEW',
  'SUPERVISOR_MANAGE',
  // Rastreamento Inteligente / PatGo (admin-rastreamento-inteligente, migration
  // 124): RASTREAMENTO_VIEW lê o módulo (timeline, funil, lista em risco, config);
  // RASTREAMENTO_MANAGE aciona recuperação, marca contato, edita regras e
  // configura a chave de IA. Concedidas SOMENTE a SUPER_ADMIN (wildcard) e ADMIN
  // (allow-all menos ADMIN_DENY). NAO entram em ADMIN_DENY nem nos *_PERMS de
  // SUPORTE/FINANCEIRO/MODERADOR: negação por construção (deny-by-default,
  // Req 2.1-2.4, 2.8). Espelha is_admin_with_permission re-asserida na 124.
  'RASTREAMENTO_VIEW',
  'RASTREAMENTO_MANAGE',
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const ALL: ReadonlySet<AdminAction> = new Set(ADMIN_ACTIONS);

const FINANCEIRO_PERMS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'USER_VIEW',
  'FRETE_VIEW',
  'FINANCEIRO_VIEW',
  'FINANCEIRO_EDIT',
  'AUDIT_VIEW',
  'DASHBOARD_VIEW',
]);

const SUPORTE_PERMS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'USER_VIEW',
  'USER_TOGGLE_ACTIVE',
  'FRETE_VIEW',
  'SUPORTE_VIEW',
  'SUPORTE_REPLY',
  'CRM_VIEW',
  'BLACKLIST_VIEW',
  'DASHBOARD_VIEW',
  'FAQ_VIEW',
]);

const MODERADOR_PERMS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'USER_VIEW',
  'FRETE_VIEW',
  'FRETE_FORCE_CLOSE',
  'BLACKLIST_VIEW',
  'BLACKLIST_MANAGE',
]);

const ADMIN_DENY: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'USER_DELETE',
  'ADMIN_ROLE_GRANT',
  'ADMIN_ROLE_REVOKE',
  // Modulo Assistente e exclusivo do dono (SUPER_ADMIN). Negar ao ADMIN
  // garante que o ramo allow-all do ADMIN nao conceda essas acoes.
  'ASSISTANT_VIEW',
  'ASSISTANT_EDIT',
]);

export const Permission_Matrix: Readonly<Record<AdminRole, (a: AdminAction) => boolean>> = {
  SUPER_ADMIN: () => true,
  ADMIN: (a) => ALL.has(a) && !ADMIN_DENY.has(a),
  FINANCEIRO: (a) => FINANCEIRO_PERMS.has(a),
  SUPORTE: (a) => SUPORTE_PERMS.has(a),
  MODERADOR: (a) => MODERADOR_PERMS.has(a),
};

/**
 * Pure: deny by default para qualquer string fora do enum.
 */
export function hasPermission(role: AdminRole, action: AdminAction | string): boolean {
  if (!ALL.has(action as AdminAction)) return false;
  return Permission_Matrix[role](action as AdminAction);
}

/**
 * Uniao: true se algum papel ativo permite.
 */
export function hasPermissionForRoles(roles: AdminRole[], action: AdminAction | string): boolean {
  return roles.some((r) => hasPermission(r, action));
}

/** Lista de acoes permitidas para um conjunto de papeis. */
export function listAllowedActions(roles: AdminRole[]): AdminAction[] {
  return ADMIN_ACTIONS.filter((a) => hasPermissionForRoles(roles, a));
}
