// Feature: admin-cliente-360, Property 3: Sanitizacao e fronteiras da query.
//
// A Sanitized_Query aplica trim, colapsa espacos e escapa os curingas de ILIKE
// (% _ \) de modo que nenhum curinga do usuario atue como curinga; query
// normalizada < 2 chars e nao-UUID => vazio sem erro; p_limit efetivo pertence
// a [1,50] (default 20).
//
// Validates: Requirements 2.2, 2.3, 2.8

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import {
  normalizeQuery,
  escapeIlike,
  classifyQueryKind,
  clampSearchLimit,
} from '../../../services/admin/cliente360/search';
import { runSearch, type SearchCandidate } from '../../../services/admin/cliente360/ranking';

/** Reverte escapeIlike (consome '\' + proximo char como literal). */
function unescapeIlike(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

/** True se restar algum % ou _ NAO escapado (curinga ativo). */
function hasActiveWildcard(escaped: string): boolean {
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === '\\') {
      i++; // pula o char escapado
      continue;
    }
    if (escaped[i] === '%' || escaped[i] === '_') return true;
  }
  return false;
}

// Strings com curingas/backslash/espacos frequentes.
const weirdString = fc
  .array(fc.constantFrom('a', 'B', '%', '_', '\\', ' ', '9', 'Z', 'x'), { maxLength: 24 })
  .map((cs) => cs.join(''));

const sampleCands: SearchCandidate[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    user_type: 'motorista',
    name: 'Ana',
    email: 'ana@x.com',
    phone: '(11) 98765-4321',
    company_name: null,
    cpf: null,
  },
];

describe('CP-3 busca: sanitizacao e fronteiras', () => {
  it('escapa curingas de forma lossless e sem curinga ativo', () => {
    fc.assert(
      fc.property(weirdString, (s) => {
        const escaped = escapeIlike(s);
        // round-trip: o escape e reversivel sem ambiguidade
        expect(unescapeIlike(escaped)).toBe(s);
        // nenhum % ou _ ativo permanece
        expect(hasActiveWildcard(escaped)).toBe(false);
        // determinismo
        expect(escapeIlike(s)).toBe(escaped);
      }),
      { numRuns: 200 }
    );
  });

  it('query normalizada < 2 chars e nao-UUID => vazio sem erro', () => {
    const shortRaw = fc.constantFrom('', ' ', '   ', 'a', ' a ', '\t', '\n ', 'Z', '  x  ');
    fc.assert(
      fc.property(shortRaw, (raw) => {
        const norm = normalizeQuery(raw);
        fc.pre(classifyQueryKind(norm) === 'empty');
        expect(runSearch(sampleCands, raw, 20)).toEqual([]);
      }),
      { numRuns: 200 }
    );
  });

  it('clampa p_limit em [1,50] com default 20', () => {
    const limitArb = fc.oneof(
      fc.integer(),
      fc.constantFrom<number | null | undefined>(undefined, null, NaN, 0, -1, 1, 20, 50, 51, 1000)
    );
    fc.assert(
      fc.property(limitArb, (lim) => {
        const c = clampSearchLimit(lim as number);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(50);
        if (typeof lim === 'number' && Number.isInteger(lim) && lim >= 1 && lim <= 50) {
          expect(c).toBe(lim);
        } else {
          expect(c).toBe(20);
        }
      }),
      { numRuns: 200 }
    );
  });
});
