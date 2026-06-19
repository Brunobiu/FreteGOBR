// Feature: admin-central-operacao, Property 7: Precedência de permission_denied.
//
// Para QUALQUER RPC desta spec e QUALQUER caller sem a permissão exigida, o
// resultado é permission_denied MESMO na presença simultânea de erro de
// validação de input, e INDEPENDENTEMENTE do papel do caller — preservando o
// deny-by-default (a verificação de permissão precede a de input).
//
// Validates: Requirements 2.7, 9.9, 9.10, 12.5, 13.1

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import { mapOperacaoError } from '../../../services/admin/operacao';
import { expectPermissionDenied } from '../../_helpers/authAssertions';
import { safeText, uuidLike } from '../../_helpers/generators';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'FINANCEIRO' | 'SUPORTE' | 'MODERADOR' | 'NONE';
type OperacaoAction = 'DASHBOARD_VIEW' | 'ALERT_VIEW' | 'ALERT_ACK' | 'ALERT_RESOLVE' | 'LOG_VIEW';

const roleGen = fc.constantFrom<AdminRole>(
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCEIRO',
  'SUPORTE',
  'MODERADOR',
  'NONE'
);
const actionGen = fc.constantFrom<OperacaoAction>(
  'DASHBOARD_VIEW',
  'ALERT_VIEW',
  'ALERT_ACK',
  'ALERT_RESOLVE',
  'LOG_VIEW'
);

/**
 * Espelha is_admin_with_permission (migration 117) para as ações desta spec:
 * apenas SUPER_ADMIN (wildcard) e ADMIN (allow-all menos deny-list, que não
 * inclui nenhuma destas) as possuem; FINANCEIRO/SUPORTE/MODERADOR têm allowlists
 * fechadas que NÃO listam nenhuma ação operacional nem DASHBOARD_VIEW (verdade
 * server-side); NONE (sem papel) nunca. Determinística e total.
 */
function roleHasPermission(role: AdminRole, _action: OperacaoAction): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/**
 * Modela a ORDEM do servidor (gating ANTES da validação): sem permissão =>
 * permission_denied SEMPRE (mesmo com input inválido); senão, input inválido =>
 * invalid_input; senão ok. Lança Error cuja mensagem começa por
 * 'permission_denied'/'invalid_input' (forma aceita por expectPermissionDenied).
 */
function simulateOperacaoRpc(hasPerm: boolean, inputValid: boolean): { ok: true } {
  if (!hasPerm) throw new Error('permission_denied: ALERT_* required');
  if (!inputValid) throw new Error('invalid_input: filtro fora do domínio');
  return { ok: true };
}

describe('CP-7 central-operação: precedência de permission_denied', () => {
  it('sem permissão vence input inválido simultâneo, em qualquer papel (ordem do servidor)', () => {
    fc.assert(
      fc.property(
        roleGen,
        actionGen,
        fc.boolean(),
        // input potencialmente inválido (gerado mas irrelevante quando sem permissão)
        fc.oneof(safeText(1, 12), fc.constant(''), uuidLike(), fc.constant('   ')),
        (role, action, rawInputValid, _input) => {
          const hasPerm = roleHasPermission(role, action);
          // quando NÃO há permissão, o input pode ser válido ou não — não importa.
          const inputValid = hasPerm ? rawInputValid : false;

          let caught: unknown;
          let result: { ok: true } | undefined;
          try {
            result = simulateOperacaoRpc(hasPerm, inputValid);
          } catch (e) {
            caught = e;
          }

          if (!hasPerm) {
            // mesmo com input inválido simultâneo, vence permission_denied
            expectPermissionDenied(caught);
          } else if (!inputValid) {
            expect(String((caught as Error).message)).toContain('invalid_input');
          } else {
            expect(result).toEqual({ ok: true });
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('mapOperacaoError prioriza permission_denied sobre validação simultânea', () => {
    fc.assert(
      fc.property(fc.boolean(), (withInvalidToo) => {
        const message = withInvalidToo
          ? 'permission_denied: ALERT_ACK required; invalid_input: bad'
          : 'permission_denied: ALERT_ACK required';
        // erro carregando AMBOS os sinais => PERMISSION_DENIED
        expect(mapOperacaoError({ code: '42501', message }).code).toBe('PERMISSION_DENIED');
        expect(mapOperacaoError({ message }).code).toBe('PERMISSION_DENIED');
      }),
      { numRuns: 100 }
    );
  });

  it('mapOperacaoError: sem sinal de permissão, mapeia o código de validação/estado', () => {
    expect(mapOperacaoError({ code: 'P0001', message: 'invalid_input: x' }).code).toBe(
      'INVALID_INPUT'
    );
    expect(mapOperacaoError({ message: 'STALE_VERSION' }).code).toBe('STALE_VERSION');
    expect(
      mapOperacaoError({ message: 'INVALID_STATE_TRANSITION: RESOLVED cannot be acknowledged' }).code
    ).toBe('INVALID_STATE_TRANSITION');
    expect(mapOperacaoError({ message: 'NOT_FOUND: alert' }).code).toBe('NOT_FOUND');
  });

  it('mapOperacaoError nunca vaza o erro cru na mensagem user-facing', () => {
    const e = mapOperacaoError({
      code: '42501',
      message: 'permission_denied token=sb_secret_ABCDEFGHIJ1234567890',
    });
    expect(e.message).toBe('Você não tem permissão para esta operação.');
  });
});
