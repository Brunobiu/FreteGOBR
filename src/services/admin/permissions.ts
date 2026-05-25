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
