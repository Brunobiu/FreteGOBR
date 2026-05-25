/**
 * CP-2: addEntry sobre entrada ativa preexistente e idempotente
 *
 * Para todo (type, valor canonico) com entrada ATIVA preexistente,
 * addEntry(payload) falha com BlacklistServiceError(ALREADY_BLACKLISTED)
 * carregando extra.existingId e extra.removed === false (status=active),
 * NAO insere nova linha (a RPC 035 retorna unique_violation que e
 * mapeado para ALREADY_BLACKLISTED), e gera exatamente 1 audit log
 * BLACKLIST_CREATED_SKIPPED por chamada (alem do BLACKLIST_CREATED
 * principal disparado por executeAdminMutation).
 *
 * Repetir n in [1, 5] vezes preserva o comportamento e gera n logs
 * principais e n logs _SKIPPED.
 *
 * Validates: Requirements 4.11, 4.12, 14.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mocks hoisted -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__testBlacklistRpcSpy = rpcSpy;
  // UUID fixo retornado pelo mock como "existingId" da entrada ativa
  const EXISTING_ID = '11111111-2222-4333-8444-555555555555';
  (globalThis as Record<string, unknown>).__testBlacklistExistingId = EXISTING_ID;

  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-id' } } }),
      },
      rpc: vi.fn(async (name: string) => {
        rpcSpy(name);
        if (name === 'admin_blacklist_add') {
          return {
            data: null,
            error: {
              message: `ALREADY_BLACKLISTED: ${EXISTING_ID} (status=active)`,
            },
          };
        }
        return { data: null, error: null };
      }),
    },
  };
});

vi.mock('../../../services/admin/audit', () => {
  const mutationSpy = vi.fn();
  const logSpy = vi.fn();
  (globalThis as Record<string, unknown>).__testBlacklistMutationSpy = mutationSpy;
  (globalThis as Record<string, unknown>).__testBlacklistLogSpy = logSpy;
  return {
    executeAdminMutation: vi.fn(async (input: { action: string }, fn: () => Promise<unknown>) => {
      mutationSpy(input.action);
      return fn();
    }),
    logAdminAction: vi.fn(async (input: { action: string }) => {
      logSpy(input.action);
      return null;
    }),
  };
});

import {
  addEntry,
  BlacklistServiceError,
  type BlacklistType,
} from '../../../services/admin/blacklist';

const rpcSpy = (globalThis as Record<string, unknown>).__testBlacklistRpcSpy as ReturnType<
  typeof vi.fn
>;
const mutationSpy = (globalThis as Record<string, unknown>)
  .__testBlacklistMutationSpy as ReturnType<typeof vi.fn>;
const logSpy = (globalThis as Record<string, unknown>).__testBlacklistLogSpy as ReturnType<
  typeof vi.fn
>;
const EXISTING_ID = (globalThis as Record<string, unknown>).__testBlacklistExistingId as string;

// ----- Geradores -----

// Phone valido (10 ou 11 digitos). Templates fixos para evitar invalido.
const phoneGen = fc.constantFrom(
  '64999999999',
  '11988887777',
  '21987654321',
  '6499999999',
  '1198887777'
);

// CPF/CNPJ validos com DV correto (templates fixos).
const cpfGen = fc.constantFrom('11144477735', '52998224725');
const cnpjGen = fc.constantFrom('11444777000161', '04252011000110');

// E-mail simples: prefixo alfanumerico + dominio fixo.
const emailGen = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[^A-Za-z0-9]/g, ''))
  .filter((s) => s.length >= 1 && s.length <= 20)
  .map((s) => `${s}@exemplo.com`);

const reasonGen = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && s.trim().length <= 200);

const nGen = fc.integer({ min: 1, max: 5 });

function typeValueTupleGen(): fc.Arbitrary<{ type: BlacklistType; valueRaw: string }> {
  return fc.oneof(
    phoneGen.map((valueRaw) => ({ type: 'phone' as const, valueRaw })),
    cpfGen.map((valueRaw) => ({ type: 'cpf' as const, valueRaw })),
    cnpjGen.map((valueRaw) => ({ type: 'cnpj' as const, valueRaw })),
    emailGen.map((valueRaw) => ({ type: 'email' as const, valueRaw }))
  );
}

describe('CP-2: addEntry e idempotente sobre entrada ativa preexistente', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    mutationSpy.mockClear();
    logSpy.mockClear();
  });

  it('cada tentativa retorna ALREADY_BLACKLISTED com extra.existingId e gera 1 _SKIPPED', async () => {
    await fc.assert(
      fc.asyncProperty(
        typeValueTupleGen(),
        reasonGen,
        nGen,
        async ({ type, valueRaw }, reason, n) => {
          rpcSpy.mockClear();
          mutationSpy.mockClear();
          logSpy.mockClear();

          for (let i = 0; i < n; i++) {
            let caught: unknown = null;
            try {
              await addEntry({
                type,
                valueRaw,
                reason,
                expiresAt: null,
                sourceUserId: null,
              });
            } catch (err) {
              caught = err;
            }

            expect(caught).toBeInstanceOf(BlacklistServiceError);
            const e = caught as BlacklistServiceError;
            expect(e.code).toBe('ALREADY_BLACKLISTED');
            expect(e.extra?.existingId).toBe(EXISTING_ID);
            expect(e.extra?.removed).toBe(false);
          }

          // executeAdminMutation chamado n vezes com action principal
          expect(mutationSpy).toHaveBeenCalledTimes(n);
          for (const call of mutationSpy.mock.calls) {
            expect(call[0]).toBe('BLACKLIST_CREATED');
          }

          // logAdminAction chamado n vezes com BLACKLIST_CREATED_SKIPPED
          const skippedCalls = logSpy.mock.calls.filter(
            (c) => c[0] === 'BLACKLIST_CREATED_SKIPPED'
          );
          expect(skippedCalls).toHaveLength(n);

          // RPC chamada n vezes (uma por tentativa)
          expect(rpcSpy).toHaveBeenCalledTimes(n);
          for (const call of rpcSpy.mock.calls) {
            expect(call[0]).toBe('admin_blacklist_add');
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
