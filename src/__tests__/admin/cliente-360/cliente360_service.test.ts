// Unit / cenarios de falha do Cliente_360_Service.
// Spec: .kiro/specs/admin-cliente-360 (Task 6.10).

import { describe, it, expect, vi, beforeEach } from 'vitest';

type RpcResult = { data: unknown; error: unknown };
type G = {
  __rpc?: (name: string, args?: unknown) => Promise<RpcResult>;
  __log?: (action: string) => void;
};

vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      const fn = (globalThis as unknown as G).__rpc;
      return fn ? fn(name, args) : Promise.resolve({ data: null, error: null });
    },
  },
}));

vi.mock('../../../services/admin/audit', () => ({
  logAdminAction: (input: { action: string }) => {
    (globalThis as unknown as G).__log?.(input.action);
    return Promise.resolve('log-id');
  },
  executeAdminMutation: async (input: { action: string }, fn: () => Promise<unknown>) => {
    (globalThis as unknown as G).__log?.(input.action);
    return fn();
  },
}));

// Mock parcial de users: preserva isValidUuid/normalizeDigits/UsersServiceError
// (usados por ranking.ts e pelo mapeamento) e troca apenas getUserDetail.
vi.mock('../../../services/admin/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/admin/users')>();
  return { ...actual, getUserDetail: vi.fn() };
});

import {
  mapPostgresError,
  validateNoteBody,
  globalSearch,
  createNote,
  deleteNote,
  assembleCliente360Bundle,
  type SearchResult,
  type Settled,
  type PlanoLabel,
  type FinancialHistory,
  type LoginHistory,
  type ConversationMeta,
  getCliente360Detail,
} from '../../../services/admin/cliente360';
import { getUserDetail, UsersServiceError, type UserDetailBundle } from '../../../services/admin/users';
import { expectNoSecrets } from '../../_helpers/logAssertions';

beforeEach(() => {
  (globalThis as unknown as G).__rpc = undefined;
  (globalThis as unknown as G).__log = undefined;
  vi.mocked(getUserDetail).mockReset();
});

function makeBase(): UserDetailBundle {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      user_type: 'motorista',
      name: 'Cliente',
      phone: '62999998888',
      email: null,
      cpf: null,
      cnpj: null,
      company_name: null,
      is_active: true,
      ban_reason: null,
      banned_at: null,
      banned_by: null,
      profile_photo_url: null,
      admin_username: null,
      created_at: '2024-01-01T00:00:00Z',
      last_activity_at: null,
      updated_at: '2024-01-01T00:00:00Z',
    },
    bannedByName: null,
    location: null,
    documents: [],
    fretes: [],
    fretesTotal: 0,
    ratings: [],
    chat: [],
    errors: {},
  };
}

describe('mapPostgresError', () => {
  it('precedencia permission_denied e codigos mapeados', () => {
    expect(mapPostgresError({ code: '42501' }).code).toBe('PERMISSION_DENIED');
    expect(mapPostgresError({ message: 'permission_denied: x' }).code).toBe('PERMISSION_DENIED');
    expect(mapPostgresError({ message: 'STALE_VERSION' }).code).toBe('STALE_VERSION');
    expect(mapPostgresError({ message: 'master_admin_immutable' }).code).toBe('MASTER_ADMIN_IMMUTABLE');
    expect(mapPostgresError({ message: 'ALREADY_REMOVED' }).code).toBe('ALREADY_REMOVED');
    expect(mapPostgresError({ message: 'invalid_input: body' }).code).toBe('INVALID_INPUT');
    expect(mapPostgresError({ message: 'qualquer outra coisa' }).code).toBe('UNKNOWN');
  });

  it('mapeia UsersServiceError do Source_Block', () => {
    expect(mapPostgresError(new UsersServiceError('NOT_FOUND')).code).toBe('NOT_FOUND');
    expect(mapPostgresError(new UsersServiceError('MASTER_ADMIN_IMMUTABLE')).code).toBe(
      'MASTER_ADMIN_IMMUTABLE'
    );
  });

  it('nao vaza PII/segredos na mensagem user-facing', () => {
    const e = mapPostgresError({
      code: '42501',
      message: 'permission_denied token=sb_secret_ABCDEFGHIJ1234567890',
    });
    expectNoSecrets(e.message);
    expect(e.message).toBe('Você não tem permissão para esta ação.');
  });
});

describe('validateNoteBody', () => {
  it('rejeita vazio/so-espacos e acima de 5000; aceita valido', () => {
    expect(validateNoteBody('')).not.toBeNull();
    expect(validateNoteBody('   ')).not.toBeNull();
    expect(validateNoteBody('a'.repeat(5001))).not.toBeNull();
    expect(validateNoteBody('observacao valida')).toBeNull();
  });
});

describe('globalSearch', () => {
  it('mapeia permission_denied', async () => {
    (globalThis as unknown as G).__rpc = () =>
      Promise.resolve({ data: null, error: { code: '42501', message: 'permission_denied' } });
    await expect(globalSearch('joao')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('reordena resultados pelo comparador (rank ASC)', async () => {
    const rows: SearchResult[] = [
      { id: 'b', user_type: 'motorista', name: 'B', email: null, phone: null, company_name: null, matched_field: 'name', match_rank: 2 },
      { id: 'a', user_type: 'motorista', name: 'A', email: null, phone: null, company_name: null, matched_field: 'email', match_rank: 0 },
    ];
    (globalThis as unknown as G).__rpc = () => Promise.resolve({ data: rows, error: null });
    const out = await globalSearch('x');
    expect(out.map((r) => r.match_rank)).toEqual([0, 2]);
  });
});

describe('CRUD de notas', () => {
  it('createNote: alvo Master_Admin => MASTER_ADMIN_IMMUTABLE', async () => {
    (globalThis as unknown as G).__rpc = (name) =>
      name === 'admin_user_note_create'
        ? Promise.resolve({ data: null, error: { code: 'P0001', message: 'master_admin_immutable' } })
        : Promise.resolve({ data: null, error: null });
    await expect(createNote('uid', 'nota')).rejects.toMatchObject({ code: 'MASTER_ADMIN_IMMUTABLE' });
  });

  it('createNote ok grava audit USER_NOTE_CREATE', async () => {
    const logs: string[] = [];
    (globalThis as unknown as G).__log = (a) => logs.push(a);
    (globalThis as unknown as G).__rpc = () =>
      Promise.resolve({ data: { id: 'note-1', updated_at: '2024-02-02T00:00:00Z' }, error: null });
    const r = await createNote('uid', 'nota valida');
    expect(r).toEqual({ id: 'note-1', updated_at: '2024-02-02T00:00:00Z' });
    expect(logs).toContain('USER_NOTE_CREATE');
  });

  it('deleteNote: skip na inexistencia (sem audit positivo)', async () => {
    const logs: string[] = [];
    (globalThis as unknown as G).__log = (a) => logs.push(a);
    (globalThis as unknown as G).__rpc = () =>
      Promise.resolve({ data: { skipped: true, reason: 'ALREADY_REMOVED' }, error: null });
    const r = await deleteNote('note-x');
    expect(r).toEqual({ skipped: true, reason: 'ALREADY_REMOVED' });
    expect(logs).not.toContain('USER_NOTE_DELETE');
  });
});

describe('getCliente360Detail — Source_Block', () => {
  it('propaga NOT_FOUND do getUserDetail (vira Stealth_404 na UI)', async () => {
    vi.mocked(getUserDetail).mockRejectedValueOnce(new UsersServiceError('NOT_FOUND'));
    await expect(
      getCliente360Detail('bad-id', { financeiro: false, suporte: false, notas: false, suporteReply: false })
    ).rejects.toBeInstanceOf(UsersServiceError);
  });
});

describe('assembleCliente360Bundle — omitido vs vazio vs erro', () => {
  const ok = <T>(value: T): Settled<T> => ({ status: 'fulfilled', value });
  const fail = <T>(): Settled<T> => ({ status: 'rejected', reason: new Error('x') });
  const PLANO: PlanoLabel = { subscription_status: 'trial', is_subscribed: false, trial_ends_at: null };
  const LOGIN: LoginHistory = { attempts: [], retentionDays: 30, hasPhone: false };
  const FRETE: ConversationMeta[] = [];
  const EMPTY_FIN: FinancialHistory = { plan: null, charges: [], repasses: [] };

  it('financeiro: omitido (caps false) vs vazio (fulfilled) vs erro (rejected)', () => {
    const base = makeBase();
    const parts = {
      plano: ok(PLANO),
      suporte: ok<undefined>(undefined),
      mensagensFrete: ok(FRETE),
      login: ok(LOGIN),
      notas: ok<undefined>(undefined),
    };

    // omitido
    const omit = assembleCliente360Bundle(base, { financeiro: false, suporte: false, notas: false, suporteReply: false }, {
      ...parts,
      financeiro: ok<undefined>(undefined),
    });
    expect(omit.financeiro).toBeUndefined();
    expect(omit.errors.financeiro).toBeUndefined();

    // vazio (presente, lista vazia)
    const empty = assembleCliente360Bundle(base, { financeiro: true, suporte: false, notas: false, suporteReply: false }, {
      ...parts,
      financeiro: ok<FinancialHistory | undefined>(EMPTY_FIN),
    });
    expect(empty.financeiro).toEqual(EMPTY_FIN);
    expect(empty.errors.financeiro).toBeUndefined();

    // erro
    const err = assembleCliente360Bundle(base, { financeiro: true, suporte: false, notas: false, suporteReply: false }, {
      ...parts,
      financeiro: fail<FinancialHistory | undefined>(),
    });
    expect(err.financeiro).toBeUndefined();
    expect(err.errors.financeiro).toBeDefined();
  });
});
