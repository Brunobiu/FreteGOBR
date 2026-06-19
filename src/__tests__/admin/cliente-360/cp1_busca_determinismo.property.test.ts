// Feature: admin-cliente-360, Property 1: Determinismo e ordenacao total da busca.
//
// Para toda lista de candidatos e todo Search_Query, runSearch produz uma
// sequencia cuja ordem respeita estritamente match_rank ASC -> name ASC ->
// id ASC, e retorna EXATAMENTE a mesma sequencia quando reexecutada ou quando
// a lista de entrada e permutada (ordem total; id unico => desempate total).
//
// Validates: Requirements 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Isola o modulo puro do client Supabase/env (ranking -> users -> supabase).
vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import {
  runSearch,
  compareSearchResults,
  type SearchCandidate,
} from '../../../services/admin/cliente360/ranking';
import { safeText, validEmail, validPhone, validCpf, uuidLike } from '../../_helpers/generators';

const candidateArb: fc.Arbitrary<SearchCandidate> = fc.record({
  id: uuidLike(),
  user_type: fc.constantFrom('motorista', 'embarcador'),
  name: safeText(1, 30),
  email: fc.option(validEmail(), { nil: null }),
  phone: fc.option(validPhone(), { nil: null }),
  company_name: fc.option(safeText(1, 30), { nil: null }),
  cpf: fc.option(validCpf(), { nil: null }),
});

function dedupeById(cands: SearchCandidate[]): SearchCandidate[] {
  const seen = new Set<string>();
  const out: SearchCandidate[] = [];
  for (const c of cands) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

describe('CP-1 busca: determinismo e ordenacao total', () => {
  it('ordena por (rank, name, id), e e idempotente e invariante a permutacao', () => {
    const scenario = fc.array(candidateArb, { minLength: 1, maxLength: 12 }).chain((raw) => {
      const cands = dedupeById(raw);
      const c0 = cands[0];
      const prefix = c0.name.slice(0, Math.min(3, c0.name.length)) || c0.name;
      return fc.record({
        cands: fc.constant(cands),
        query: fc.oneof(
          fc.constant(c0.id),
          fc.constant(c0.name),
          fc.constant(prefix),
          fc.constant(c0.email ?? c0.name),
          safeText(1, 8)
        ),
        // chaves para uma permutacao genuina da entrada (uma por candidato)
        keys: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: cands.length,
          maxLength: cands.length,
        }),
        limit: fc.integer({ min: 1, max: 50 }),
      });
    });

    fc.assert(
      fc.property(scenario, ({ cands, query, keys, limit }) => {
        const result = runSearch(cands, query, limit);

        // (a) ordenacao total respeitada par a par
        for (let i = 1; i < result.length; i++) {
          expect(compareSearchResults(result[i - 1], result[i])).toBeLessThanOrEqual(0);
        }
        // (b) re-ordenar pelo comparador nao muda nada
        expect([...result].sort(compareSearchResults)).toEqual(result);

        // (c) semantica de rank/field
        for (const r of result) {
          expect([0, 1, 2]).toContain(r.match_rank);
          if (r.matched_field === 'id') expect(r.match_rank).toBe(0);
          expect(r.user_type === 'motorista' || r.user_type === 'embarcador').toBe(true);
        }

        // (d) idempotencia
        expect(runSearch(cands, query, limit)).toEqual(result);

        // (e) invariancia a permutacao da entrada
        const permuted = cands
          .map((c, i) => ({ c, k: keys[i] }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.c);
        expect(runSearch(permuted, query, limit)).toEqual(result);
      }),
      { numRuns: 200 }
    );
  });

  it('atribui rank 0 a id/email/telefone exatos', () => {
    const cand: SearchCandidate = {
      id: '11111111-1111-4111-8111-111111111111',
      user_type: 'motorista',
      name: 'Joao da Silva',
      email: 'joao@fretegobr.com.br',
      phone: '(62) 99999-8888',
      company_name: null,
      cpf: '111.444.777-35',
    };
    expect(runSearch([cand], cand.id, 20)[0].match_rank).toBe(0);
    expect(runSearch([cand], 'joao@fretegobr.com.br', 20)[0]).toMatchObject({
      matched_field: 'email',
      match_rank: 0,
    });
    expect(runSearch([cand], '62999998888', 20)[0]).toMatchObject({
      matched_field: 'phone',
      match_rank: 0,
    });
  });
});
