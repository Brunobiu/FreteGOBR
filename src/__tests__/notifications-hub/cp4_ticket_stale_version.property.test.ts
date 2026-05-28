/**
 * CP-4: Property test do versionamento otimista de ticket.
 *
 * Spec: .kiro/specs/notifications-hub/requirements.md Requirement 8.5.
 *
 * Propriedades testadas:
 *
 *  P1. `replyToTicket(ticketId, body, expectedUpdatedAt_STALE)` SEMPRE
 *      lança `TicketError(STALE_VERSION)` quando o RPC retorna esse erro.
 *
 *  P2. `replyToTicket(ticketId, body, expectedUpdatedAt_FRESH)` retorna
 *      sucesso com `messageId` e `updatedAt` populados.
 *
 *  P3. `resolveTicket(ticketId, expectedUpdatedAt_STALE)` SEMPRE lança
 *      `TicketError(STALE_VERSION)`.
 *
 *  P4. Idempotência _SKIPPED: quando RPC retorna `{ skipped: true,
 *      reason: 'ALREADY_RESOLVED' }`, o helper retorna o mesmo objeto
 *      sem lançar erro (semântica: "já estava resolvido, não é falha").
 *
 *  P5. Em sucesso real, retorna `{ ok: true, ticketId }`.
 *
 *  P6. NOT_FOUND vira TicketError tipado.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp4RpcSpy = rpcSpy;
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcSpy(name, args);
        const mockResult = (globalThis as Record<string, unknown>).__cp4MockResult as {
          data?: unknown;
          error?: { message: string; code?: string } | null;
        };
        return Promise.resolve(mockResult ?? { data: null, error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => ({}),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock('../../services/admin/audit', () => ({
  executeAdminMutation: async <T>(_input: unknown, fn: () => Promise<T>) => fn(),
}));

import { replyToTicket, resolveTicket, TicketError } from '../../services/admin/tickets';

const rpcSpy = (globalThis as Record<string, unknown>).__cp4RpcSpy as ReturnType<typeof vi.fn>;

function setMockResult(result: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}) {
  (globalThis as Record<string, unknown>).__cp4MockResult = result;
}

const UUID_GEN = fc.uuid();
const TIMESTAMP_GEN = fc
  .integer({ min: 1700000000000, max: 1900000000000 })
  .map((ms) => new Date(ms).toISOString());
const BODY_GEN = fc.string({ minLength: 10, maxLength: 200 }).filter((s) => s.trim().length >= 10);

describe('CP-4: replyToTicket / resolveTicket — versionamento otimista', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
  });

  // P1: STALE_VERSION em reply
  it('replyToTicket lança TicketError(STALE_VERSION) quando RPC retorna erro', async () => {
    await fc.assert(
      fc.asyncProperty(UUID_GEN, BODY_GEN, TIMESTAMP_GEN, async (id, body, staleTs) => {
        setMockResult({
          error: { message: 'STALE_VERSION', code: 'P0001' },
        });

        await expect(replyToTicket(id, body, staleTs)).rejects.toMatchObject({
          name: 'TicketError',
          code: 'STALE_VERSION',
        });
      }),
      { numRuns: 50 }
    );
  });

  // P2: sucesso em reply
  it('replyToTicket retorna sucesso quando RPC retorna ok', async () => {
    await fc.assert(
      fc.asyncProperty(
        UUID_GEN,
        BODY_GEN,
        TIMESTAMP_GEN,
        UUID_GEN,
        TIMESTAMP_GEN,
        async (ticketId, body, expectedTs, messageId, newUpdatedAt) => {
          setMockResult({
            data: {
              message_id: messageId,
              ticket_id: ticketId,
              updated_at: newUpdatedAt,
              is_public: false,
              guest_name: null,
              guest_email: null,
              subject: 'Teste',
            },
            error: null,
          });

          const result = await replyToTicket(ticketId, body, expectedTs);

          expect(result.messageId).toBe(messageId);
          expect(result.ticketId).toBe(ticketId);
          expect(result.updatedAt).toBe(newUpdatedAt);
          expect(result.isPublic).toBe(false);
        }
      ),
      { numRuns: 30 }
    );
  });

  // P3: STALE_VERSION em resolve
  it('resolveTicket lança TicketError(STALE_VERSION) quando RPC retorna erro', async () => {
    await fc.assert(
      fc.asyncProperty(UUID_GEN, TIMESTAMP_GEN, async (id, staleTs) => {
        setMockResult({
          error: { message: 'STALE_VERSION', code: 'P0001' },
        });

        await expect(resolveTicket(id, staleTs)).rejects.toMatchObject({
          name: 'TicketError',
          code: 'STALE_VERSION',
        });
      }),
      { numRuns: 30 }
    );
  });

  // P4: idempotência _SKIPPED
  it('resolveTicket retorna { skipped: true, reason: ALREADY_RESOLVED } quando ja resolvido', async () => {
    await fc.assert(
      fc.asyncProperty(UUID_GEN, TIMESTAMP_GEN, async (id, ts) => {
        setMockResult({
          data: {
            skipped: true,
            reason: 'ALREADY_RESOLVED',
            ticket_id: id,
          },
          error: null,
        });

        const result = await resolveTicket(id, ts);

        if ('skipped' in result) {
          expect(result.skipped).toBe(true);
          expect(result.reason).toBe('ALREADY_RESOLVED');
          expect(result.ticketId).toBe(id);
        } else {
          throw new Error('Esperava skipped, recebeu sucesso real');
        }
      }),
      { numRuns: 30 }
    );
  });

  // P5: sucesso real em resolve
  it('resolveTicket retorna { ok: true } em sucesso', async () => {
    await fc.assert(
      fc.asyncProperty(UUID_GEN, TIMESTAMP_GEN, async (id, ts) => {
        setMockResult({
          data: { ok: true, ticket_id: id },
          error: null,
        });

        const result = await resolveTicket(id, ts);

        if (!('skipped' in result)) {
          expect(result.ok).toBe(true);
          expect(result.ticketId).toBe(id);
        } else {
          throw new Error('Esperava sucesso real, recebeu skipped');
        }
      }),
      { numRuns: 30 }
    );
  });

  // P6: NOT_FOUND
  it('reply/resolve com ticket inexistente lança TicketError(NOT_FOUND)', async () => {
    setMockResult({
      error: { message: 'NOT_FOUND', code: 'P0001' },
    });
    await expect(
      replyToTicket(
        '00000000-0000-4000-8000-000000000000',
        'corpo aqui longo',
        new Date().toISOString()
      )
    ).rejects.toBeInstanceOf(TicketError);
    await expect(
      resolveTicket('00000000-0000-4000-8000-000000000000', new Date().toISOString())
    ).rejects.toBeInstanceOf(TicketError);
  });
});
