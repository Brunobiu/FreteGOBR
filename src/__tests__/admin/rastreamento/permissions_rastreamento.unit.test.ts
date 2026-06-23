// Feature: admin-rastreamento-inteligente — Permission_Matrix das ações novas.
//
// Valida a concessão por papel de RASTREAMENTO_VIEW / RASTREAMENTO_MANAGE e o
// deny-by-default: concedidas APENAS a SUPER_ADMIN (wildcard) e ADMIN (allow-all
// menos ADMIN_DENY); negadas por construção a SUPORTE/FINANCEIRO/MODERADOR.
// Inclui a negação a qualquer papel (inclusive ADMIN) para uma ação fora do
// enum (deny-by-default sem exceção por papel).
//
// Validates: Requirements 2.1, 2.2, 2.8

import { describe, it, expect } from 'vitest';

import {
  hasPermission,
  hasPermissionForRoles,
  listAllowedActions,
  ADMIN_ACTIONS,
  type AdminRole,
} from '../../../services/admin/permissions';

const NEW_ACTIONS = ['RASTREAMENTO_VIEW', 'RASTREAMENTO_MANAGE'] as const;
const ALLOWED_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN'];
const DENIED_ROLES: AdminRole[] = ['SUPORTE', 'FINANCEIRO', 'MODERADOR'];

describe('Permissões do Rastreamento (RASTREAMENTO_VIEW / RASTREAMENTO_MANAGE)', () => {
  it('registra as duas ações novas no enum ADMIN_ACTIONS', () => {
    for (const action of NEW_ACTIONS) {
      expect(ADMIN_ACTIONS).toContain(action);
    }
  });

  it('concede ambas as ações a SUPER_ADMIN e ADMIN', () => {
    for (const role of ALLOWED_ROLES) {
      for (const action of NEW_ACTIONS) {
        expect(hasPermission(role, action), `${role} deveria ter ${action}`).toBe(true);
      }
    }
  });

  it('nega ambas as ações a SUPORTE, FINANCEIRO e MODERADOR (deny-by-default)', () => {
    for (const role of DENIED_ROLES) {
      for (const action of NEW_ACTIONS) {
        expect(hasPermission(role, action), `${role} NÃO deveria ter ${action}`).toBe(false);
      }
    }
  });

  it('nega ação fora do enum para qualquer papel, inclusive ADMIN (deny-by-default total)', () => {
    const ALL_ROLES: AdminRole[] = [...ALLOWED_ROLES, ...DENIED_ROLES];
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, 'RASTREAMENTO_UNKNOWN')).toBe(false);
    }
  });

  it('a união de papéis concede a quem tem mas não a quem não tem', () => {
    expect(hasPermissionForRoles(['SUPORTE', 'ADMIN'], 'RASTREAMENTO_MANAGE')).toBe(true);
    expect(hasPermissionForRoles(['SUPORTE', 'FINANCEIRO'], 'RASTREAMENTO_MANAGE')).toBe(false);
    expect(hasPermissionForRoles(['MODERADOR'], 'RASTREAMENTO_VIEW')).toBe(false);
  });

  it('listAllowedActions inclui as novas ações só para papéis autorizados', () => {
    expect(listAllowedActions(['ADMIN'])).toEqual(
      expect.arrayContaining(['RASTREAMENTO_VIEW', 'RASTREAMENTO_MANAGE'])
    );
    const suporte = listAllowedActions(['SUPORTE']);
    expect(suporte).not.toContain('RASTREAMENTO_VIEW');
    expect(suporte).not.toContain('RASTREAMENTO_MANAGE');
  });
});
