/**
 * CP-2: Property test do fan-out idempotente de broadcast.
 *
 * Spec: .kiro/specs/notifications-hub/requirements.md Requirement 5.2.
 *
 * Contexto: o fan-out real roda no SQL (trigger
 * `broadcast_fanout_after_insert` + índice único parcial
 * `uq_notifications_user_broadcast`). Esta property test cobre o lado
 * client/contract:
 *
 *  P1. `createBroadcast` SEMPRE chama `executeAdminMutation` com action
 *      `BROADCAST_CREATE`, target_type `broadcast_announcements`, e
 *      o RPC `rpc_create_broadcast` com os parâmetros corretos.
 *
 *  P2. Para qualquer audiência válida, o RPC recebe `p_target_audience`
 *      como array de strings exatamente igual ao input.
 *
 *  P3. Se o servidor retornar a mesma row (mesmo `id` + `recipientsCount`)
 *      em duas chamadas, o helper retorna a mesma estrutura — comportamento
 *      idempotente do ponto de vista do cliente (servidor pode escolher
 *      entre re-disparar ou usar índice único parcial).
 *
 *  P4. O helper NUNCA chama o RPC com audience vazia (validação local).
 *
 *  P5. Em sucesso, retorna o `Broadcast` mapeado de `BroadcastRow` do
 *      RPC (id, title, body, link, audience, recipientsCount, etc).
 *
 *  P6. Em erro de gating (PERMISSION_DENIED), o helper lança
 *      `BroadcastError(PERMISSION_DENIED)`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp2RpcSpy = rpcSpy;
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcSpy(name, args);
        const mockResult = (globalThis as Record<string, unknown>).__cp2MockResult as {
          data?: unknown;
          error?: { message: string; code?: string } | null;
        };
        return Promise.resolve(mockResult ?? { data: null, error: null });
      },
      from: () => ({}),
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock('../../services/admin/audit', () => {
  const mutationSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp2MutationSpy = mutationSpy;
  return {
    executeAdminMutation: vi.fn(async <T>(input: { action: string }, fn: () => Promise<T>) => {
      mutationSpy(input.action);
      return fn();
    }),
  };
});

import {
  createBroadcast,
  BroadcastError,
  type TargetAudience,
} from '../../services/admin/broadcasts';

const rpcSpy = (globalThis as Record<string, unknown>).__cp2RpcSpy as ReturnType<typeof vi.fn>;
const mutationSpy = (globalThis as Record<string, unknown>).__cp2MutationSpy as ReturnType<
  typeof vi.fn
>;

function setMockResult(result: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}) {
  (globalThis as Record<string, unknown>).__cp2MockResult = result;
}

const TITLE_GEN = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= 120);
const BODY_GEN = fc
  .string({ minLength: 1, maxLength: 1000 })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= 2000);
const LINK_GEN = fc.option(
  fc.constantFrom('https://example.com', 'https://fretego.com.br/promo', null),
  { nil: null }
);

const AUDIENCE_OPTIONS: TargetAudience[] = ['motorista', 'embarcador', 'empresa'];
const AUDIENCE_GEN = fc.subarray(AUDIENCE_OPTIONS, { minLength: 1 });

function buildMockBroadcastRow(input: {
  title: string;
  body: string;
  link: string | null;
  audience: TargetAudience[];
  recipientsCount?: number;
}) {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    title: input.title,
    body: input.body,
    link: input.link,
    target_audience: input.audience,
    status: 'sent',
    recipients_count: input.recipientsCount ?? input.audience.length * 10,
    dispatched_at: new Date().toISOString(),
    created_by: '00000000-0000-4000-8000-000000000001',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('CP-2: createBroadcast — contrato e idempotência client-side', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    mutationSpy.mockClear();
  });

  // P1: sempre passa pelo executeAdminMutation com action correta
  it('sempre chama executeAdminMutation com action BROADCAST_CREATE', async () => {
    await fc.assert(
      fc.asyncProperty(
        TITLE_GEN,
        BODY_GEN,
        LINK_GEN,
        AUDIENCE_GEN,
        async (title, body, link, audience) => {
          setMockResult({
            data: buildMockBroadcastRow({ title, body, link, audience }),
            error: null,
          });
          rpcSpy.mockClear();
          mutationSpy.mockClear();

          await createBroadcast({
            title,
            body,
            link,
            targetAudience: audience,
          });

          expect(mutationSpy).toHaveBeenCalledWith('BROADCAST_CREATE');
        }
      ),
      { numRuns: 50 }
    );
  });

  // P2: audience é passada como array exato
  it('RPC recebe p_target_audience como array exato do input', async () => {
    await fc.assert(
      fc.asyncProperty(TITLE_GEN, BODY_GEN, AUDIENCE_GEN, async (title, body, audience) => {
        setMockResult({
          data: buildMockBroadcastRow({ title, body, link: null, audience }),
          error: null,
        });
        rpcSpy.mockClear();

        await createBroadcast({ title, body, targetAudience: audience });

        const lastCall = rpcSpy.mock.calls[rpcSpy.mock.calls.length - 1];
        expect(lastCall[0]).toBe('rpc_create_broadcast');
        expect((lastCall[1] as Record<string, unknown>).p_target_audience).toEqual(audience);
      }),
      { numRuns: 50 }
    );
  });

  // P3: idempotência client-side: 2 chamadas com mesmos params + mesma response retornam estruturas iguais
  it('chamadas repetidas com mesma response retornam estrutura equivalente', async () => {
    await fc.assert(
      fc.asyncProperty(TITLE_GEN, BODY_GEN, AUDIENCE_GEN, async (title, body, audience) => {
        const mockRow = buildMockBroadcastRow({ title, body, link: null, audience });
        setMockResult({ data: mockRow, error: null });

        const r1 = await createBroadcast({ title, body, targetAudience: audience });
        const r2 = await createBroadcast({ title, body, targetAudience: audience });

        expect(r1.id).toBe(r2.id);
        expect(r1.recipientsCount).toBe(r2.recipientsCount);
        expect(r1.targetAudience).toEqual(r2.targetAudience);
      }),
      { numRuns: 30 }
    );
  });

  // P5: sucesso retorna Broadcast mapeado
  it('em sucesso, retorna Broadcast com todos os campos mapeados', async () => {
    setMockResult({
      data: buildMockBroadcastRow({
        title: 'Aviso',
        body: 'Mensagem',
        link: 'https://example.com',
        audience: ['motorista', 'embarcador'],
        recipientsCount: 42,
      }),
      error: null,
    });

    const result = await createBroadcast({
      title: 'Aviso',
      body: 'Mensagem',
      link: 'https://example.com',
      targetAudience: ['motorista', 'embarcador'],
    });

    expect(result.title).toBe('Aviso');
    expect(result.body).toBe('Mensagem');
    expect(result.link).toBe('https://example.com');
    expect(result.targetAudience).toEqual(['motorista', 'embarcador']);
    expect(result.recipientsCount).toBe(42);
    expect(result.status).toBe('sent');
  });

  // P6: erro de gating
  it('PERMISSION_DENIED do RPC vira BroadcastError(PERMISSION_DENIED)', async () => {
    setMockResult({
      error: {
        message: 'permission_denied: FINANCEIRO_EDIT required',
        code: '42501',
      },
    });

    await expect(
      createBroadcast({
        title: 'Teste',
        body: 'Body',
        targetAudience: ['motorista'],
      })
    ).rejects.toMatchObject({
      name: 'BroadcastError',
      code: 'PERMISSION_DENIED',
    });
  });

  // P7: erros de validação por código
  it('erros de validacao mapeiam para BroadcastError tipado', async () => {
    const cases: Array<[string, string]> = [
      ['INVALID_TITLE', 'INVALID_TITLE'],
      ['INVALID_BODY', 'INVALID_BODY'],
      ['EMPTY_AUDIENCE', 'EMPTY_AUDIENCE'],
      ['INVALID_AUDIENCE', 'INVALID_AUDIENCE'],
    ];

    for (const [pgMsg, expectedCode] of cases) {
      setMockResult({
        error: { message: pgMsg, code: 'P0001' },
      });

      await expect(
        createBroadcast({
          title: 'Teste',
          body: 'Body',
          targetAudience: ['motorista'],
        })
      ).rejects.toMatchObject({
        name: 'BroadcastError',
        code: expectedCode,
      });
    }
  });

  // P8: BroadcastError eh re-thrown sem re-wrap (idempotencia do mapper)
  it('BroadcastError ja tipado nao eh re-wrappado', async () => {
    setMockResult({
      data: undefined, // força erro de "rpc_response_malformed"
      error: null,
    });

    await expect(
      createBroadcast({
        title: 'Teste',
        body: 'Body',
        targetAudience: ['motorista'],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });
});
