/**
 * Integração/smoke do serviço admin de trial — `src/services/admin/trial.ts`.
 *
 * Diferente dos property tests (que exercitam apenas os helpers PUROS), este
 * arquivo valida o WIRING de I/O das funções `listTrialMotoristas` e
 * `extendTrial`:
 *   - chamada da RPC correta com os parâmetros corretos;
 *   - mapeamento do payload `{ rows, total, limit, offset }` -> `TrialListResult`
 *     (com `page` derivada de `offset/pageSize`);
 *   - audit-by-construction (`executeAdminMutation` com action `TRIAL_EXTEND`,
 *     `targetType: 'users'`, `targetId`) + audit negativo best-effort em
 *     `STALE_VERSION`;
 *   - tradução dos erros das RPCs SQL para `TrialServiceError` tipado
 *     (STALE_VERSION, PERMISSION_DENIED, MASTER_PROTECTED).
 *
 * Mocking espelha o padrão de `admin/blacklist/cp2DuplicateIdempotent`: `vi.mock`
 * é hoisted, então os spies são expostos via `globalThis` (convenção do projeto).
 *
 * Validates: Requirements 1.2, 1.3, 10.4, 11.1, 11.6
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mocks hoisted (não referenciar variáveis externas no factory) -----

vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__trialRpcSpy = rpcSpy;
  // Respostas controláveis por nome de RPC (preenchidas em cada teste).
  (globalThis as Record<string, unknown>).__trialRpcResponses = {} as Record<
    string,
    { data: unknown; error: unknown }
  >;

  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-id' } } }),
      },
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        rpcSpy(name, args);
        const responses = (globalThis as Record<string, unknown>).__trialRpcResponses as Record<
          string,
          { data: unknown; error: unknown }
        >;
        return responses[name] ?? { data: null, error: null };
      }),
      // Usado por fetchCurrentTrialEndsAt (snapshot `before` do audit).
      from: vi.fn(() => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => ({ data: { trial_ends_at: null }, error: null })),
        };
        return chain;
      }),
    },
  };
});

vi.mock('../../../services/admin/audit', () => {
  const mutationSpy = vi.fn();
  const logSpy = vi.fn();
  (globalThis as Record<string, unknown>).__trialMutationSpy = mutationSpy;
  (globalThis as Record<string, unknown>).__trialLogSpy = logSpy;
  return {
    executeAdminMutation: vi.fn(
      async (
        input: { action: string; targetType?: string | null; targetId?: string | null },
        fn: () => Promise<unknown>
      ) => {
        mutationSpy(input);
        return fn();
      }
    ),
    logAdminAction: vi.fn(async (input: { action: string }) => {
      logSpy(input);
      return null;
    }),
  };
});

import {
  listTrialMotoristas,
  extendTrial,
  TrialServiceError,
  DEFAULT_TRIAL_FILTERS,
  type TrialFilters,
} from '../../../services/admin/trial';

// ----- Handles dos spies expostos via globalThis -----

const rpcSpy = (globalThis as Record<string, unknown>).__trialRpcSpy as ReturnType<typeof vi.fn>;
const mutationSpy = (globalThis as Record<string, unknown>).__trialMutationSpy as ReturnType<
  typeof vi.fn
>;
const logSpy = (globalThis as Record<string, unknown>).__trialLogSpy as ReturnType<typeof vi.fn>;

function setRpcResponse(name: string, response: { data: unknown; error: unknown }): void {
  const responses = (globalThis as Record<string, unknown>).__trialRpcResponses as Record<
    string,
    { data: unknown; error: unknown }
  >;
  responses[name] = response;
}

function clearRpcResponses(): void {
  (globalThis as Record<string, unknown>).__trialRpcResponses = {} as Record<
    string,
    { data: unknown; error: unknown }
  >;
}

/** Último par [name, args] passado à RPC pelo código sob teste. */
function lastRpcCall(): [string, Record<string, unknown>] {
  const calls = rpcSpy.mock.calls;
  return calls[calls.length - 1] as [string, Record<string, unknown>];
}

function makeFilters(overrides: Partial<TrialFilters> = {}): TrialFilters {
  return { ...DEFAULT_TRIAL_FILTERS, ...overrides };
}

beforeEach(() => {
  rpcSpy.mockClear();
  mutationSpy.mockClear();
  logSpy.mockClear();
  clearRpcResponses();
});

// ============================================================================
// (a) listTrialMotoristas — mapeamento de payload + parâmetros da RPC
// ============================================================================
describe('listTrialMotoristas — wiring da RPC admin_list_trial_motoristas', () => {
  it('mapeia o payload { rows, total, limit, offset } para TrialListResult (page derivada de offset/pageSize)', async () => {
    setRpcResponse('admin_list_trial_motoristas', {
      data: {
        rows: [
          {
            id: 'm1',
            name: 'Motorista 1',
            phone: '11999998888',
            trial_ends_at: '2025-06-10T00:00:00.000Z',
            subscription_status: 'trial',
            is_subscribed: false,
            days_left: 3,
            trial_state: 'em_trial',
            updated_at: '2025-05-01T00:00:00.000Z',
            admin_username: null,
          },
        ],
        total: 42,
        limit: 10,
        offset: 20,
      },
      error: null,
    });

    const result = await listTrialMotoristas(makeFilters({ page: 3, pageSize: 10 }));

    // Linha mapeada fielmente.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 'm1',
      name: 'Motorista 1',
      phone: '11999998888',
      trial_ends_at: '2025-06-10T00:00:00.000Z',
      subscription_status: 'trial',
      is_subscribed: false,
      days_left: 3,
      trial_state: 'em_trial',
      updated_at: '2025-05-01T00:00:00.000Z',
      admin_username: null,
    });

    // total propagado; page = floor(offset / limit) + 1 = floor(20/10)+1 = 3.
    expect(result.total).toBe(42);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it("passa os parâmetros corretos: p_status null em 'todos', q trimado, sort e paginação (offset = (page-1)*pageSize)", async () => {
    setRpcResponse('admin_list_trial_motoristas', {
      data: { rows: [], total: 0, limit: 50, offset: 50 },
      error: null,
    });

    await listTrialMotoristas(
      makeFilters({
        status: 'todos',
        aboutToExpire: true,
        q: '  busca  ',
        sort: 'days_left_desc',
        page: 2,
        pageSize: 50,
      })
    );

    const [name, args] = lastRpcCall();
    expect(name).toBe('admin_list_trial_motoristas');
    expect(args).toEqual({
      p_status: null, // 'todos' => null
      p_about_to_expire: true,
      p_q: 'busca', // trimado
      p_sort: 'days_left_desc',
      p_limit: 50,
      p_offset: 50, // (2 - 1) * 50
    });
  });

  it('envia p_status com o valor selecionado e p_q null quando a busca é só espaços', async () => {
    setRpcResponse('admin_list_trial_motoristas', {
      data: { rows: [], total: 0, limit: 10, offset: 0 },
      error: null,
    });

    await listTrialMotoristas(
      makeFilters({ status: 'em_trial', q: '    ', page: 1, pageSize: 10 })
    );

    const [, args] = lastRpcCall();
    expect(args.p_status).toBe('em_trial');
    expect(args.p_q).toBeNull();
    expect(args.p_about_to_expire).toBe(false);
    expect(args.p_offset).toBe(0);
    expect(args.p_limit).toBe(10);
  });
});

// ============================================================================
// (b) extendTrial — audit-by-construction + wiring da RPC admin_extend_trial
// ============================================================================
describe('extendTrial — wiring da RPC admin_extend_trial via executeAdminMutation', () => {
  it('envolve em executeAdminMutation (TRIAL_EXTEND/users/targetId), chama a RPC com os params e retorna { ok, updated_at }', async () => {
    setRpcResponse('admin_extend_trial', {
      data: { ok: true, updated_at: '2025-07-01T12:00:00.000Z' },
      error: null,
    });

    const result = await extendTrial(
      'user-1',
      '2025-12-31T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z'
    );

    expect(result).toEqual({ ok: true, updated_at: '2025-07-01T12:00:00.000Z' });

    // Audit-by-construction: action/targetType/targetId corretos.
    expect(mutationSpy).toHaveBeenCalledTimes(1);
    const mutationInput = mutationSpy.mock.calls[0][0] as {
      action: string;
      targetType?: string;
      targetId?: string;
    };
    expect(mutationInput.action).toBe('TRIAL_EXTEND');
    expect(mutationInput.targetType).toBe('users');
    expect(mutationInput.targetId).toBe('user-1');

    // RPC chamada com os parâmetros de versionamento otimista.
    const [name, args] = lastRpcCall();
    expect(name).toBe('admin_extend_trial');
    expect(args).toEqual({
      p_user_id: 'user-1',
      p_new_trial_ends_at: '2025-12-31T00:00:00.000Z',
      p_expected_updated_at: '2025-01-01T00:00:00.000Z',
    });
  });
});

// ============================================================================
// (c) Mapeamento de erros das RPCs SQL -> TrialServiceError tipado
// ============================================================================
describe('extendTrial — mapeamento de erros de RPC para TrialServiceError', () => {
  it("erro com mensagem contendo 'STALE_VERSION' => code STALE_VERSION (+ audit negativo best-effort)", async () => {
    setRpcResponse('admin_extend_trial', {
      data: null,
      error: {
        message: 'STALE_VERSION: expected 2025-01-01 got 2025-02-02',
        code: 'P0001',
      },
    });

    await expect(
      extendTrial('user-1', '2025-12-31T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
    ).rejects.toMatchObject({
      name: 'TrialServiceError',
      code: 'STALE_VERSION',
    });

    // Audit negativo secundário (TRIAL_EXTEND_STALE_VERSION) é gravado best-effort.
    const staleLogs = logSpy.mock.calls.filter(
      (c) => (c[0] as { action: string }).action === 'TRIAL_EXTEND_STALE_VERSION'
    );
    expect(staleLogs).toHaveLength(1);
  });

  it("erro com mensagem 'permission_denied' => code PERMISSION_DENIED", async () => {
    setRpcResponse('admin_extend_trial', {
      data: null,
      error: { message: 'permission_denied: USER_EDIT required', code: '42501' },
    });

    await expect(
      extendTrial('user-1', '2025-12-31T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
    ).rejects.toMatchObject({ name: 'TrialServiceError', code: 'PERMISSION_DENIED' });
  });

  it('erro com SQLSTATE 42501 (sem texto explícito) também => code PERMISSION_DENIED', async () => {
    setRpcResponse('admin_extend_trial', {
      data: null,
      error: { message: 'insufficient privilege', code: '42501' },
    });

    await expect(
      extendTrial('user-1', '2025-12-31T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
    ).rejects.toMatchObject({ name: 'TrialServiceError', code: 'PERMISSION_DENIED' });
  });

  it("erro com mensagem 'MASTER_PROTECTED' => code MASTER_PROTECTED", async () => {
    setRpcResponse('admin_extend_trial', {
      data: null,
      error: { message: 'MASTER_PROTECTED', code: 'P0001' },
    });

    await expect(
      extendTrial('master-id', '2025-12-31T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
    ).rejects.toMatchObject({ name: 'TrialServiceError', code: 'MASTER_PROTECTED' });
  });

  it('o erro lançado é instância de TrialServiceError (tipo verificável pelo caller)', async () => {
    setRpcResponse('admin_extend_trial', {
      data: null,
      error: { message: 'MASTER_PROTECTED', code: 'P0001' },
    });

    let caught: unknown = null;
    try {
      await extendTrial('master-id', '2025-12-31T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TrialServiceError);
  });
});
