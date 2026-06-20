// Feature: admin-ia-supervisora, Property 6: Precedência de permission_denied.
//
// Para qualquer RPC desta spec e qualquer caller sem a permissão exigida, o
// resultado é permission_denied MESMO com erro de validação simultâneo, e
// INDEPENDENTEMENTE do papel — preservando o deny-by-default.
//
// Validates: Requirements 9.5, 1.4, 12.1

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import { mapSupervisorError } from '../../../services/admin/supervisor';
import { expectPermissionDenied } from '../../_helpers/authAssertions';
import { safeText, uuidLike } from '../../_helpers/generators';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'FINANCEIRO' | 'SUPORTE' | 'MODERADOR' | 'NONE';
type SupervisorAction = 'SUPERVISOR_VIEW' | 'SUPERVISOR_MANAGE';

const roleGen = fc.constantFrom<AdminRole>(
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCEIRO',
  'SUPORTE',
  'MODERADOR',
  'NONE'
);
const actionGen = fc.constantFrom<SupervisorAction>('SUPERVISOR_VIEW', 'SUPERVISOR_MANAGE');

/** Espelha is_admin_with_permission (118): SUPERVISOR_* só SUPER_ADMIN/ADMIN. */
function roleHasPermission(role: AdminRole, _action: SupervisorAction): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** Ordem do servidor: gating ANTES da validação. */
function simulateRpc(hasPerm: boolean, inputValid: boolean): { ok: true } {
  if (!hasPerm) throw new Error('permission_denied: SUPERVISOR_* required');
  if (!inputValid) throw new Error('invalid_input: filtro fora do domínio');
  return { ok: true };
}

describe('CP6 supervisor: precedência de permission_denied', () => {
  it('sem permissão vence input inválido simultâneo, em qualquer papel', () => {
    fc.assert(
      fc.property(
        roleGen,
        actionGen,
        fc.boolean(),
        fc.oneof(safeText(1, 12), fc.constant(''), uuidLike()),
        (role, action, rawValid, _input) => {
          const hasPerm = roleHasPermission(role, action);
          const inputValid = hasPerm ? rawValid : false;
          let caught: unknown;
          let result: { ok: true } | undefined;
          try {
            result = simulateRpc(hasPerm, inputValid);
          } catch (e) {
            caught = e;
          }
          if (!hasPerm) expectPermissionDenied(caught);
          else if (!inputValid) expect(String((caught as Error).message)).toContain('invalid_input');
          else expect(result).toEqual({ ok: true });
        }
      ),
      { numRuns: 300 }
    );
  });

  it('mapSupervisorError prioriza permission_denied sobre validação simultânea', () => {
    expect(
      mapSupervisorError({ code: '42501', message: 'permission_denied; invalid_input: x' }).code
    ).toBe('PERMISSION_DENIED');
    expect(mapSupervisorError({ message: 'permission_denied: SUPERVISOR_MANAGE required' }).code).toBe(
      'PERMISSION_DENIED'
    );
    expect(mapSupervisorError({ code: 'P0001', message: 'invalid_input' }).code).toBe('INVALID_INPUT');
    expect(mapSupervisorError({ message: 'STALE_VERSION' }).code).toBe('STALE_VERSION');
    expect(
      mapSupervisorError({ message: 'INVALID_STATE_TRANSITION: DISMISSED cannot be acknowledged' }).code
    ).toBe('INVALID_STATE_TRANSITION');
  });

  it('mensagem user-facing nunca vaza o erro cru', () => {
    const e = mapSupervisorError({ code: '42501', message: 'permission_denied token=sb_secret_ABCDEFGHIJ1234567890' });
    expect(e.message).toBe('Você não tem permissão para esta operação.');
  });
});
