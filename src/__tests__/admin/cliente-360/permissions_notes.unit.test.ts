// Unit test do delta da Permission_Matrix para as acoes novas de Internal_Note.
// USER_NOTE_VIEW / USER_NOTE_EDIT concedidas SOMENTE a SUPER_ADMIN e ADMIN;
// negadas a SUPORTE / FINANCEIRO / MODERADOR por construcao.
//
// Validates: Requirements 13.2, 13.3, 17.6 (espelho frontend da 116, CP-8)

import { describe, it, expect } from 'vitest';
import { hasPermission, type AdminRole } from '../../../services/admin/permissions';

const NOTE_ACTIONS = ['USER_NOTE_VIEW', 'USER_NOTE_EDIT'] as const;
const GRANTED: AdminRole[] = ['SUPER_ADMIN', 'ADMIN'];
const DENIED: AdminRole[] = ['SUPORTE', 'FINANCEIRO', 'MODERADOR'];

describe('permissions: USER_NOTE_VIEW / USER_NOTE_EDIT', () => {
  it('concedidas a SUPER_ADMIN e ADMIN', () => {
    for (const role of GRANTED) {
      for (const action of NOTE_ACTIONS) {
        expect(hasPermission(role, action), `${role}/${action}`).toBe(true);
      }
    }
  });

  it('negadas a SUPORTE, FINANCEIRO e MODERADOR', () => {
    for (const role of DENIED) {
      for (const action of NOTE_ACTIONS) {
        expect(hasPermission(role, action), `${role}/${action}`).toBe(false);
      }
    }
  });

  it('deny-by-default para string fora do enum', () => {
    expect(hasPermission('ADMIN', 'USER_NOTE_NUKE')).toBe(false);
  });
});
