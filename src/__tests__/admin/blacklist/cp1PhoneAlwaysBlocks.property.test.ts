/**
 * CP-1: Phone na blacklist ATIVA sempre bloqueia signup E login E email
 *
 * Para todo (type, valor canonico) com entrada ATIVA preexistente:
 *   - cenario (a) login: checkBlacklistGate('phone', value, 'BLACKLIST_LOGIN_BLOCKED')
 *     retorna { blocked: true } E dispara logBlacklistBlock(action, type, value).
 *   - cenario (b) signup: checkBlacklistGate('phone', value, 'BLACKLIST_SIGNUP_BLOCKED')
 *     retorna { blocked: true } E dispara logBlacklistBlock(action, type, value).
 *   - cenario (c) email: checkBlacklistGate('email', value, 'BLACKLIST_EMAIL_BLOCKED')
 *     se isBlacklisted retorna true, retorna { blocked: true } E dispara
 *     logBlacklistBlock(action, type, value).
 *
 * Cenario negativo: quando isBlacklisted retorna false (entrada removida ou
 * expirada), checkBlacklistGate retorna { blocked: false } E NAO dispara
 * logBlacklistBlock — confirma que a property so vale enquanto a entrada
 * esta ATIVA.
 *
 * Validates: Requirements 9.1, 9.2, 9.4, 10.1, 10.2, 10.4, 11.1, 11.4, 14.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// ----- Mocks hoisted -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__cp1RpcSpy = rpcSpy;
  // Estado controlavel pelo teste: quando true, is_blacklisted retorna true.
  (globalThis as Record<string, unknown>).__cp1IsBlocked = false;

  return {
    supabase: {
      rpc: vi.fn(async (name: string) => {
        rpcSpy(name);
        if (name === 'is_blacklisted') {
          const blocked = (globalThis as Record<string, unknown>).__cp1IsBlocked as boolean;
          return { data: blocked, error: null };
        }
        if (name === 'log_blacklist_block') {
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }),
    },
  };
});

import {
  checkBlacklistGate,
  type BlacklistAttempt,
  type BlacklistType,
} from '../../../services/admin/blacklist';

const rpcSpy = (globalThis as Record<string, unknown>).__cp1RpcSpy as ReturnType<typeof vi.fn>;

function setBlocked(v: boolean) {
  (globalThis as Record<string, unknown>).__cp1IsBlocked = v;
}

// ----- Geradores -----

const phoneGen = fc.constantFrom(
  '64999999999',
  '11988887777',
  '21987654321',
  '6499999999',
  '1198887777'
);

const emailGen = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[^A-Za-z0-9]/g, ''))
  .filter((s) => s.length >= 1 && s.length <= 20)
  .map((s) => `${s}@exemplo.com`);

const phoneScenarioGen: fc.Arbitrary<{
  type: BlacklistType;
  valueRaw: string;
  action: BlacklistAttempt['action'];
}> = fc
  .tuple(
    phoneGen,
    fc.constantFrom<BlacklistAttempt['action']>(
      'BLACKLIST_LOGIN_BLOCKED',
      'BLACKLIST_SIGNUP_BLOCKED'
    )
  )
  .map(([valueRaw, action]) => ({ type: 'phone' as const, valueRaw, action }));

const emailScenarioGen: fc.Arbitrary<{
  type: BlacklistType;
  valueRaw: string;
  action: BlacklistAttempt['action'];
}> = emailGen.map((valueRaw) => ({
  type: 'email' as const,
  valueRaw,
  action: 'BLACKLIST_EMAIL_BLOCKED' as const,
}));

const anyScenarioGen = fc.oneof(phoneScenarioGen, emailScenarioGen);

describe('CP-1: phone (e email) na blacklist ATIVA sempre bloqueia', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    setBlocked(false);
  });

  it('cenarios (a) login, (b) signup, (c) email — quando ativo, gate bloqueia E loga', async () => {
    await fc.assert(
      fc.asyncProperty(anyScenarioGen, async ({ type, valueRaw, action }) => {
        rpcSpy.mockClear();
        setBlocked(true);

        const result = await checkBlacklistGate(type, valueRaw, action, {
          timeoutMs: 1000,
        });

        expect(result.blocked).toBe(true);

        // Aguarda eventual flush do logBlacklistBlock disparado em background
        // (void log...). Damos uma microtask para garantir que o RPC foi chamado.
        await new Promise((r) => setTimeout(r, 10));

        // RPC is_blacklisted chamada exatamente 1 vez
        const isBlCalls = rpcSpy.mock.calls.filter((c) => c[0] === 'is_blacklisted');
        expect(isBlCalls).toHaveLength(1);

        // RPC log_blacklist_block chamada exatamente 1 vez
        const logCalls = rpcSpy.mock.calls.filter((c) => c[0] === 'log_blacklist_block');
        expect(logCalls).toHaveLength(1);
      }),
      { numRuns: 30 }
    );
  }, 20000);

  it('cenario negativo (entrada inativa): gate NAO bloqueia E NAO loga', async () => {
    await fc.assert(
      fc.asyncProperty(anyScenarioGen, async ({ type, valueRaw, action }) => {
        rpcSpy.mockClear();
        setBlocked(false);

        const result = await checkBlacklistGate(type, valueRaw, action, {
          timeoutMs: 1000,
        });

        expect(result.blocked).toBe(false);

        await new Promise((r) => setTimeout(r, 10));

        const isBlCalls = rpcSpy.mock.calls.filter((c) => c[0] === 'is_blacklisted');
        expect(isBlCalls).toHaveLength(1);

        const logCalls = rpcSpy.mock.calls.filter((c) => c[0] === 'log_blacklist_block');
        expect(logCalls).toHaveLength(0);
      }),
      { numRuns: 30 }
    );
  }, 20000);
});
