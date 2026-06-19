/**
 * Property-Based Test — CP3: Precedência de permission_denied.
 *
 * // Feature: suporte-inteligente, Property 3: ação protegida sem permissão ⇒
 * // permission_denied, COM precedência sobre erros de validação simultâneos,
 * // independentemente do papel do caller.
 *
 * Alvo: camada de service (mapPostgresError + mutação que propaga o erro da RPC).
 *
 * Validates: Requirements 4.8, 9.6, 11.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { expectPermissionDenied } from '../../_helpers/authAssertions';

// vi.mock é hoisted: NÃO referenciar variáveis externas no factory; o spy é
// exposto via globalThis (convenção project-conventions).
vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) =>
      (globalThis as Record<string, unknown>).__suporteRpc &&
      (
        (globalThis as Record<string, unknown>).__suporteRpc as (
          n: string,
          a: unknown
        ) => Promise<unknown>
      )(name, args),
  },
}));

import { mapPostgresError, changeStatus } from '../../../services/admin/suporte';

const validationNoiseArb = (): fc.Arbitrary<string> =>
  fc.constantFrom('INVALID_INPUT', 'STALE_VERSION', 'INVALID_STATUS_TRANSITION', 'NOT_FOUND', 'ruido aleatorio');

describe('CP3 — precedência de permission_denied', () => {
  it('mapPostgresError prioriza permission_denied sobre validação simultânea (ERRCODE 42501)', () => {
    fc.assert(
      fc.property(validationNoiseArb(), (noise) => {
        const raw = { code: '42501', message: `permission_denied: SUPORTE_REPLY required; ${noise}` };
        expect(mapPostgresError(raw).code).toBe('PERMISSION_DENIED');
      }),
      { numRuns: 100 }
    );
  });

  it('mapPostgresError prioriza permission_denied quando só a mensagem o contém', () => {
    fc.assert(
      fc.property(validationNoiseArb(), (noise) => {
        const raw = { message: `${noise}; permission_denied` };
        expectPermissionDenied(raw); // helper canônico no erro cru (code extraível = mensagem)
        expect(mapPostgresError(raw).code).toBe('PERMISSION_DENIED');
      }),
      { numRuns: 100 }
    );
  });
});

describe('CP3 — a mutação do service propaga permission_denied', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__suporteRpc;
  });

  it('changeStatus rejeita com PERMISSION_DENIED mesmo com input inválido simultâneo', async () => {
    (globalThis as Record<string, unknown>).__suporteRpc = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { code: '42501', message: 'permission_denied: SUPORTE_REPLY required; INVALID_INPUT' },
      })
    );
    await expect(changeStatus('ticket-1', 'resolved', null)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});
