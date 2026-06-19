// Feature: admin-cliente-360, Property 2: Isolamento da busca.
//
// Nenhum Search_Result tem user_type='admin'; e todo caller que nao satisfaz
// USER_VIEW (qualquer papel insuficiente, auth.uid() nulo) resulta em
// permission_denied sem emitir nenhum resultado.
//
// Validates: Requirements 2.7, 4.1, 4.4, 4.6

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import { runSearch, type SearchCandidate, type SearchResult } from '../../../services/admin/cliente360/ranking';
import { hasPermissionForRoles, type AdminRole } from '../../../services/admin/permissions';
import { safeText, validEmail, validPhone, validCpf, uuidLike } from '../../_helpers/generators';
import { expectPermissionDenied } from '../../_helpers/authAssertions';

const candidateArb: fc.Arbitrary<SearchCandidate> = fc.record({
  id: uuidLike(),
  user_type: fc.constantFrom('motorista', 'embarcador', 'admin'),
  name: safeText(1, 30),
  email: fc.option(validEmail(), { nil: null }),
  phone: fc.option(validPhone(), { nil: null }),
  company_name: fc.option(safeText(1, 30), { nil: null }),
  cpf: fc.option(validCpf(), { nil: null }),
});

/**
 * Modela a ordem do servidor: auth.uid() nulo => permission_denied; senao
 * gating USER_VIEW. Lanca Error cuja mensagem comeca por 'permission_denied'
 * (forma aceita por expectPermissionDenied, que le .code/.message).
 */
function simulateGatedSearch(
  opts: { authUidNull: boolean; roles: AdminRole[] },
  query: string,
  candidates: SearchCandidate[]
): SearchResult[] {
  if (opts.authUidNull) {
    throw new Error('permission_denied: missing auth.uid()');
  }
  if (!hasPermissionForRoles(opts.roles, 'USER_VIEW')) {
    throw new Error('permission_denied: USER_VIEW required');
  }
  return runSearch(candidates, query, 50);
}

describe('CP-2 busca: isolamento (sem admin, sem vazamento sem permissao)', () => {
  it('nunca retorna admin e nega quem nao tem USER_VIEW', () => {
    const scenario = fc.array(candidateArb, { minLength: 1, maxLength: 12 }).chain((cands) =>
      fc.record({
        cands: fc.constant(cands),
        query: fc.oneof(fc.constant(cands[0].name), fc.constant(cands[0].id), safeText(1, 8)),
        authUidNull: fc.boolean(),
        roles: fc.subarray(
          ['SUPER_ADMIN', 'ADMIN', 'SUPORTE', 'FINANCEIRO', 'MODERADOR'] as AdminRole[]
        ),
      })
    );

    fc.assert(
      fc.property(scenario, ({ cands, query, authUidNull, roles }) => {
        // (A) a busca pura jamais expoe admin
        for (const r of runSearch(cands, query, 50)) {
          expect(r.user_type).not.toBe('admin');
        }

        // (B) gating: sem auth.uid() OU sem USER_VIEW => permission_denied
        const allowed = !authUidNull && hasPermissionForRoles(roles, 'USER_VIEW');
        if (allowed) {
          const res = simulateGatedSearch({ authUidNull, roles }, query, cands);
          for (const r of res) expect(r.user_type).not.toBe('admin');
        } else {
          let threw = false;
          try {
            simulateGatedSearch({ authUidNull, roles }, query, cands);
          } catch (e) {
            threw = true;
            expectPermissionDenied(e);
          }
          expect(threw).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('exclui um admin mesmo quando ele casaria com o termo', () => {
    const admin: SearchCandidate = {
      id: '22222222-2222-4222-8222-222222222222',
      user_type: 'admin',
      name: 'Bruno Henrique',
      email: 'bruno@fretegobr.com.br',
      phone: '(62) 99999-8888',
      company_name: null,
      cpf: null,
    };
    expect(runSearch([admin], 'Bruno Henrique', 20)).toEqual([]);
    expect(runSearch([admin], admin.id, 20)).toEqual([]);
  });
});
