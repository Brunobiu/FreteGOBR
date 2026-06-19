// Unit — delta da Permission_Matrix para ALERT_VIEW/ALERT_ACK/ALERT_RESOLVE/LOG_VIEW.
// Concedidas SOMENTE a SUPER_ADMIN e ADMIN; negadas a SUPORTE/FINANCEIRO/MODERADOR.
//
// Validates: Requirements 2.2, 2.3, 2.6

import { describe, it, expect } from 'vitest';
import { hasPermission, type AdminRole } from '../../../services/admin/permissions';

const NEW_ACTIONS = ['ALERT_VIEW', 'ALERT_ACK', 'ALERT_RESOLVE', 'LOG_VIEW'] as const;
const GRANTED: AdminRole[] = ['SUPER_ADMIN', 'ADMIN'];
const DENIED: AdminRole[] = ['SUPORTE', 'FINANCEIRO', 'MODERADOR'];

describe('permissions: ALERT_* / LOG_VIEW', () => {
  it('concedidas a SUPER_ADMIN e ADMIN', () => {
    for (const role of GRANTED)
      for (const action of NEW_ACTIONS)
        expect(hasPermission(role, action), `${role}/${action}`).toBe(true);
  });

  it('negadas a SUPORTE, FINANCEIRO e MODERADOR', () => {
    for (const role of DENIED)
      for (const action of NEW_ACTIONS)
        expect(hasPermission(role, action), `${role}/${action}`).toBe(false);
  });

  it('DASHBOARD_VIEW reusada: ADMIN/SUPER_ADMIN têm; deny-by-default fora do enum', () => {
    expect(hasPermission('ADMIN', 'DASHBOARD_VIEW')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'DASHBOARD_VIEW')).toBe(true);
    expect(hasPermission('ADMIN', 'ALERT_NUKE')).toBe(false);
  });
});
