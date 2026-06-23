// Feature: admin-rastreamento-inteligente, Property 14 (transversal — precedência):
// permission_denied tem precedência sobre validação.
//
// Para toda ação protegida invocada por caller sem a permissão exigida, ainda
// que com input inválido simultâneo, o resultado é sempre permission_denied
// (precedência sobre qualquer erro de validação).
//
// Validates: Requirements 2.7, 2.8, 3.10, 15.2

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { mapRastreamentoError } from '../../../services/admin/rastreamento';
import { expectPermissionDenied } from '../../_helpers/authAssertions';

/**
 * Modela a ORDEM do servidor (gating ANTES da validação): sem permissão ⇒
 * permission_denied SEMPRE; senão, input inválido ⇒ invalid_input; senão ok.
 */
function simulateGatedRpc(hasPerm: boolean, inputValid: boolean): { ok: true } {
  if (!hasPerm) throw new Error('permission_denied: RASTREAMENTO_MANAGE required');
  if (!inputValid) throw new Error('INVALID_PROVIDER');
  return { ok: true };
}

describe('CP14 — precedência de permission_denied', () => {
  it('sem permissão vence input inválido simultâneo (modelo da ordem do servidor)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasPerm, inputValid) => {
        let caught: unknown;
        let result: { ok: true } | undefined;
        try {
          result = simulateGatedRpc(hasPerm, inputValid);
        } catch (e) {
          caught = e;
        }
        if (!hasPerm) {
          // mesmo com inputValid=false, vence permission_denied
          expectPermissionDenied(caught);
          expect(mapRastreamentoError(caught).code).toBe('PERMISSION_DENIED');
        } else if (!inputValid) {
          expect(mapRastreamentoError(caught).code).toBe('INVALID_INPUT');
        } else {
          expect(result).toEqual({ ok: true });
        }
      }),
      { numRuns: 200 }
    );
  });

  it('mapRastreamentoError prioriza permission_denied mesmo com sinais simultâneos', () => {
    // erro carregando AMBOS os sinais ⇒ PERMISSION_DENIED
    expect(
      mapRastreamentoError({ code: '42501', message: 'permission_denied ... INVALID_PROVIDER ...' }).code
    ).toBe('PERMISSION_DENIED');
    expect(
      mapRastreamentoError({ message: 'permission_denied: RASTREAMENTO_MANAGE required' }).code
    ).toBe('PERMISSION_DENIED');
    // sem sinal de permissão ⇒ mapeia a validação
    expect(mapRastreamentoError({ code: 'P0001', message: 'INVALID_INACTIVITY_DAYS' }).code).toBe(
      'INVALID_INPUT'
    );
  });

  it('mensagem do erro nunca vaza detalhe técnico/PII (pt-BR canônica)', () => {
    expect(mapRastreamentoError({ code: '42501', message: 'permission_denied' }).message).toBe(
      'Você não tem permissão para esta ação.'
    );
  });
});
