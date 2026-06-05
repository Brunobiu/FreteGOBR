/**
 * Property-Based Tests — Permission_Matrix completa (Tarefa 6).
 *
 * Cobre `hasPermission` / `hasPermissionForRoles` / `listAllowedActions`
 * (Critical_Module permissions.ts) para TODOS os papéis × TODAS as ações.
 *
 * Invariantes RBAC verificadas:
 *  - SUPER_ADMIN permite toda ação do enum.
 *  - ADMIN permite tudo menos ADMIN_DENY.
 *  - FINANCEIRO/SUPORTE/MODERADOR permitem só seu subconjunto.
 *  - deny-by-default para qualquer string fora do enum.
 *  - união de papéis é monotônica (adicionar papel nunca remove permissão).
 *
 * Validates: Requirements 3.2, 3.5, 16.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  hasPermission,
  hasPermissionForRoles,
  listAllowedActions,
  ADMIN_ACTIONS,
  type AdminRole,
  type AdminAction,
} from '../../services/admin/permissions';

const ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'];
const ADMIN_DENY_SET: AdminAction[] = [
  'USER_DELETE',
  'ADMIN_ROLE_GRANT',
  'ADMIN_ROLE_REVOKE',
  'ASSISTANT_VIEW',
  'ASSISTANT_EDIT',
];

const roleArb = () => fc.constantFrom(...ROLES);
const actionArb = () => fc.constantFrom(...ADMIN_ACTIONS);

describe('Permission_Matrix — invariantes por papel', () => {
  it('SUPER_ADMIN permite toda ação do enum', () => {
    fc.assert(
      fc.property(actionArb(), (action) => {
        expect(hasPermission('SUPER_ADMIN', action)).toBe(true);
      })
    );
  });

  it('ADMIN permite tudo exceto ADMIN_DENY', () => {
    fc.assert(
      fc.property(actionArb(), (action) => {
        const expected = !ADMIN_DENY_SET.includes(action);
        expect(hasPermission('ADMIN', action)).toBe(expected);
      })
    );
  });

  it('papéis restritos nunca concedem ação fora do seu conjunto', () => {
    // Para cada papel restrito, o conjunto permitido é subconjunto próprio do total.
    for (const role of ['FINANCEIRO', 'SUPORTE', 'MODERADOR'] as AdminRole[]) {
      const allowed = ADMIN_ACTIONS.filter((a) => hasPermission(role, a));
      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed.length).toBeLessThan(ADMIN_ACTIONS.length);
    }
  });

  it('FINANCEIRO não tem permissões de escrita de usuário nem de roles', () => {
    expect(hasPermission('FINANCEIRO', 'USER_DELETE')).toBe(false);
    expect(hasPermission('FINANCEIRO', 'USER_EDIT')).toBe(false);
    expect(hasPermission('FINANCEIRO', 'ADMIN_ROLE_GRANT')).toBe(false);
    expect(hasPermission('FINANCEIRO', 'FINANCEIRO_EDIT')).toBe(true);
  });

  it('SUPORTE pode responder ticket mas não editar settings', () => {
    expect(hasPermission('SUPORTE', 'SUPORTE_REPLY')).toBe(true);
    expect(hasPermission('SUPORTE', 'SETTINGS_EDIT')).toBe(false);
  });
});

describe('deny-by-default', () => {
  it('qualquer string fora do enum é negada para todos os papéis', () => {
    const unknownArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => !(ADMIN_ACTIONS as readonly string[]).includes(s));
    fc.assert(
      fc.property(roleArb(), unknownArb, (role, action) => {
        expect(hasPermission(role, action)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});

describe('hasPermissionForRoles — monotonicidade', () => {
  it('adicionar um papel nunca remove uma permissão concedida', () => {
    fc.assert(
      fc.property(
        fc.array(roleArb(), { minLength: 1, maxLength: 3 }),
        roleArb(),
        actionArb(),
        (roles, extra, action) => {
          const before = hasPermissionForRoles(roles, action);
          const after = hasPermissionForRoles([...roles, extra], action);
          // Se já era permitido, continua permitido (união só cresce).
          if (before) expect(after).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('listAllowedActions é a união das ações permitidas pelos papéis', () => {
    fc.assert(
      fc.property(fc.array(roleArb(), { minLength: 1, maxLength: 3 }), (roles) => {
        const list = listAllowedActions(roles);
        for (const a of list) {
          expect(hasPermissionForRoles(roles, a)).toBe(true);
        }
        // Ações fora da lista não são permitidas por nenhum papel.
        for (const a of ADMIN_ACTIONS) {
          if (!list.includes(a)) {
            expect(hasPermissionForRoles(roles, a)).toBe(false);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
