/**
 * Delta da Permission_Matrix — IA Supervisora (admin-ia-supervisora, migration 118).
 *
 * SUPERVISOR_VIEW e SUPERVISOR_MANAGE são concedidas SOMENTE a SUPER_ADMIN
 * (wildcard) e ADMIN (allow-all menos deny-list); negadas a SUPORTE/FINANCEIRO/
 * MODERADOR. Espelha is_admin_with_permission re-asserida na 118.
 */

import { describe, it, expect } from 'vitest';
import { hasPermission, type AdminRole } from '../../../services/admin/permissions';

const ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];
const NEW_ACTIONS = ['SUPERVISOR_VIEW', 'SUPERVISOR_MANAGE'] as const;

describe('permissions — SUPERVISOR_* só para SUPER_ADMIN e ADMIN', () => {
  it('verdadeiro só para SUPER_ADMIN/ADMIN; falso para os demais', () => {
    for (const role of ROLES) {
      const expected = role === 'SUPER_ADMIN' || role === 'ADMIN';
      for (const action of NEW_ACTIONS) {
        expect(hasPermission(role, action), `${role}/${action}`).toBe(expected);
      }
    }
  });

  it('deny by default para string fora do enum', () => {
    expect(hasPermission('ADMIN', 'SUPERVISOR_NOPE')).toBe(false);
  });
});
