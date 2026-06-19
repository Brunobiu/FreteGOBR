// Unit tests das funcoes puras de cliente-360 (exemplos e edge cases).
// Spec: .kiro/specs/admin-cliente-360 (Task 3.8).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../services/supabase', () => ({ supabase: {} }));

import {
  normalizeQuery,
  escapeIlike,
  sanitizeQuery,
  classifyQueryKind,
  clampSearchLimit,
} from '../../../services/admin/cliente360/search';
import {
  assignMatchRank,
  compareSearchResults,
  runSearch,
  type SearchCandidate,
  type SearchResult,
} from '../../../services/admin/cliente360/ranking';
import {
  normalizePhoneForCorrelation,
  loginAttemptMatchesUser,
} from '../../../services/admin/cliente360/loginCorrelation';

const SAN = (q: string) => sanitizeQuery(q);

const baseCand = (over: Partial<SearchCandidate>): SearchCandidate => ({
  id: '44444444-4444-4444-8444-444444444444',
  user_type: 'motorista',
  name: 'Maria Souza',
  email: 'maria@empresa.com.br',
  phone: '(62) 99999-8888',
  company_name: null,
  cpf: '529.982.247-25',
  ...over,
});

describe('search.normalizeQuery / escapeIlike', () => {
  it('trim + colapso de espacos internos', () => {
    expect(normalizeQuery('  a  b ')).toBe('a b');
    expect(normalizeQuery('x')).toBe('x');
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery('a\t\tb')).toBe('a b');
  });

  it('escapa \\ % _ (backslash primeiro)', () => {
    // '50%_x\\y' (em runtime: 50%_x\y) => 50\%\_x\\y
    expect(escapeIlike('50%_x\\y')).toBe('50\\%\\_x\\\\y');
    expect(escapeIlike('a%b')).toBe('a\\%b');
    expect(escapeIlike('a_b')).toBe('a\\_b');
    expect(escapeIlike('semcuringa')).toBe('semcuringa');
  });

  it('classifyQueryKind', () => {
    expect(classifyQueryKind('')).toBe('empty');
    expect(classifyQueryKind('a')).toBe('empty');
    expect(classifyQueryKind('ab')).toBe('text');
    expect(classifyQueryKind('12345678')).toBe('digits');
    expect(classifyQueryKind('11111111-1111-4111-8111-111111111111')).toBe('uuid');
  });

  it('clampSearchLimit', () => {
    expect(clampSearchLimit(undefined)).toBe(20);
    expect(clampSearchLimit(null)).toBe(20);
    expect(clampSearchLimit(0)).toBe(20);
    expect(clampSearchLimit(-5)).toBe(20);
    expect(clampSearchLimit(1)).toBe(1);
    expect(clampSearchLimit(25)).toBe(25);
    expect(clampSearchLimit(50)).toBe(50);
    expect(clampSearchLimit(51)).toBe(20);
    expect(clampSearchLimit(1000)).toBe(20);
  });
});

describe('ranking.assignMatchRank — exemplos de cada rank', () => {
  it('rank 0: id exato', () => {
    const c = baseCand({});
    expect(assignMatchRank(c, SAN(c.id), 'uuid')).toMatchObject({ matched_field: 'id', match_rank: 0 });
  });
  it('rank 0: email exato (case-insensitive)', () => {
    const c = baseCand({});
    expect(assignMatchRank(c, SAN('MARIA@EMPRESA.COM.BR'), 'text')).toMatchObject({
      matched_field: 'email',
      match_rank: 0,
    });
  });
  it('rank 0: telefone exato (digitos)', () => {
    const c = baseCand({});
    expect(assignMatchRank(c, SAN('62999998888'), 'digits')).toMatchObject({
      matched_field: 'phone',
      match_rank: 0,
    });
  });
  it('rank 1: prefixo de name', () => {
    const c = baseCand({});
    expect(assignMatchRank(c, SAN('Maria'), 'text')).toMatchObject({
      matched_field: 'name',
      match_rank: 1,
    });
  });
  it('rank 1: prefixo de company_name', () => {
    const c = baseCand({ name: 'Z', company_name: 'Transportadora Sul' });
    expect(assignMatchRank(c, SAN('Transp'), 'text')).toMatchObject({
      matched_field: 'company_name',
      match_rank: 1,
    });
  });
  it('rank 2: substring de name', () => {
    const c = baseCand({});
    expect(assignMatchRank(c, SAN('Souza'), 'text')).toMatchObject({
      matched_field: 'name',
      match_rank: 2,
    });
  });
  it('telefone/CPF com menos de 8 digitos nao casa', () => {
    const c = baseCand({});
    expect(assignMatchRank(c, SAN('629'), 'digits')).toBeNull();
  });
  it('nao casa => null; admin => null', () => {
    expect(assignMatchRank(baseCand({}), SAN('zzzzzz'), 'text')).toBeNull();
    expect(assignMatchRank(baseCand({ user_type: 'admin' }), SAN('Maria'), 'text')).toBeNull();
  });
});

describe('ranking.compareSearchResults — empates resolvidos por id', () => {
  it('mesmo rank e name => ordena por id', () => {
    const mk = (id: string): SearchResult => ({
      id,
      user_type: 'motorista',
      name: 'Igual',
      email: null,
      phone: null,
      company_name: null,
      matched_field: 'name',
      match_rank: 2,
    });
    const a = mk('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const b = mk('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(compareSearchResults(a, b)).toBeLessThan(0);
    expect(compareSearchResults(b, a)).toBeGreaterThan(0);
    expect([b, a].sort(compareSearchResults)).toEqual([a, b]);
  });

  it('runSearch ordena exato (rank0) antes de substring (rank2)', () => {
    const exact = baseCand({ id: '55555555-5555-4555-8555-555555555555', name: 'AAA', email: 'alvo@x.com' });
    const sub = baseCand({ id: '66666666-6666-4666-8666-666666666666', name: 'tem alvo no meio', email: null });
    const out = runSearch([sub, exact], 'alvo@x.com', 20);
    expect(out[0].id).toBe(exact.id);
    expect(out[0].match_rank).toBe(0);
  });
});

describe('loginCorrelation — normalizacao de telefone', () => {
  it('(62) 99999-8888 e 62999998888 casam', () => {
    expect(normalizePhoneForCorrelation('(62) 99999-8888')).toBe('62999998888');
    expect(loginAttemptMatchesUser('(62) 99999-8888', '62999998888')).toBe(true);
    expect(loginAttemptMatchesUser('62999998888', '(62) 99999-8888')).toBe(true);
  });
  it('sem telefone do Cliente => nunca casa', () => {
    expect(loginAttemptMatchesUser('62999998888', null)).toBe(false);
    expect(loginAttemptMatchesUser('62999998888', '')).toBe(false);
  });
});
