// Feature: admin-cliente-360, Property 5: Precedencia de permission_denied.
//
// Quando ocorrem SIMULTANEAMENTE falta de permissao e erro de validacao de
// input, o resultado e permission_denied (a permissao tem precedencia sobre a
// validacao), independentemente do papel e inclusive com auth.uid() nulo.
//
// Validates: Requirements 1.6, 6.7, 9.1, 12.1, 14.8, 15.3, 15.6

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import { mapPostgresError } from '../../../services/admin/cliente360';
import { expectPermissionDenied } from '../../_helpers/authAssertions';

/**
 * Modela a ORDEM do servidor (gating ANTES da validacao): sem permissao =>
 * permission_denied SEMPRE; senao, body invalido => invalid_input; senao ok.
 * Lanca Error cuja mensagem comeca por 'permission_denied'/'invalid_input'
 * (forma aceita por expectPermissionDenied / inspecionavel).
 */
function simulateNoteRpc(hasPerm: boolean, bodyValid: boolean): { ok: true } {
  if (!hasPerm) throw new Error('permission_denied: USER_NOTE_EDIT required');
  if (!bodyValid) throw new Error('invalid_input: body length must be 1..5000');
  return { ok: true };
}

describe('CP-5 visao 360: precedencia de permission_denied', () => {
  it('sem permissao vence input invalido simultaneo (modelo da ordem do servidor)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasPerm, bodyValid) => {
        let caught: unknown;
        let result: { ok: true } | undefined;
        try {
          result = simulateNoteRpc(hasPerm, bodyValid);
        } catch (e) {
          caught = e;
        }

        if (!hasPerm) {
          // mesmo com bodyValid=false, vence permission_denied
          expectPermissionDenied(caught);
        } else if (!bodyValid) {
          expect(String((caught as Error).message)).toContain('invalid_input');
        } else {
          expect(result).toEqual({ ok: true });
        }
      }),
      { numRuns: 200 }
    );
  });

  it('mapPostgresError prioriza permission_denied sobre validacao', () => {
    // erro carregando AMBOS os sinais => PERMISSION_DENIED
    expect(
      mapPostgresError({ code: '42501', message: 'permission_denied: ... invalid_input: ...' }).code
    ).toBe('PERMISSION_DENIED');
    expect(mapPostgresError({ message: 'permission_denied: USER_NOTE_EDIT required' }).code).toBe(
      'PERMISSION_DENIED'
    );
    // sem sinal de permissao => mapeia a validacao
    expect(mapPostgresError({ code: 'P0001', message: 'invalid_input: body...' }).code).toBe(
      'INVALID_INPUT'
    );
  });

  it('mapPostgresError nunca vaza PII/segredos na mensagem', () => {
    const e = mapPostgresError({ code: '42501', message: 'permission_denied' });
    expect(e.message).toBe('Você não tem permissão para esta ação.');
  });
});
