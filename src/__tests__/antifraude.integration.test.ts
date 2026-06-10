/**
 * Integração/smoke — Anti-fraude no cadastro (`auth.register`).
 * Feature: trial-e-bloqueio (Task 4.6)
 *
 * **Validates: Requirements 8.1, 8.5**
 *
 * Cobre a paridade SQL↔TS e o rollback compensatório do `register`, conforme o
 * design (Section "9. Anti-fraude no cadastro" e "Error Handling" → "Cadastro
 * (anti-fraude)"):
 *
 *   (a) Pré-check `is_identifier_available` retornando `false` ⇒ `register`
 *       lança `AuthError` com a mensagem canônica e NÃO prossegue para criar a
 *       conta (signUp/insert não são chamados). (Req 8.1)
 *   (b) `users.insert` falhando com o erro do trigger `duplicate_identifier:*`
 *       ⇒ `register` mapeia para a mensagem canônica e executa o rollback
 *       compensatório (delete em `users` + `signOut`) — sem conta órfã. (Req 8.5)
 *   (c) Fail-open: a RPC `is_identifier_available` retornando erro de infra ⇒ o
 *       pré-check NÃO bloqueia; o `register` prossegue além do pré-check (o
 *       trigger é a autoridade final). (Req 8.5 — fail-open documentado)
 *
 * Mocking: `vi.mock` é hoisted; spies expostos via `globalThis` (steering
 * project-conventions → "Property-based testing (fast-check)"), espelhando o
 * estilo dos testes de serviço existentes em `src/__tests__` (ex:
 * `admin/dashboard/cp1KpiDeterministic.property.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock hoisted de `../services/supabase` (spies via globalThis) -----
vi.mock('../services/supabase', () => {
  const rpcSpy = vi.fn();
  const signUpSpy = vi.fn();
  const signOutSpy = vi.fn();
  const insertSpy = vi.fn();
  const deleteEqSpy = vi.fn();

  (globalThis as Record<string, unknown>).__afRpcSpy = rpcSpy;
  (globalThis as Record<string, unknown>).__afSignUpSpy = signUpSpy;
  (globalThis as Record<string, unknown>).__afSignOutSpy = signOutSpy;
  (globalThis as Record<string, unknown>).__afInsertSpy = insertSpy;
  (globalThis as Record<string, unknown>).__afDeleteEqSpy = deleteEqSpy;

  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcSpy(name, args);
        // RPCs do fluxo de e-mail pré-cadastro (066) têm resultado fixo "feliz",
        // para não interferir nas asserções de anti-fraude (que controlam o
        // resultado de is_identifier_available via __afRpcResult).
        if (name === 'consume_signup_email_token') {
          return Promise.resolve({ data: true, error: null });
        }
        if (name === 'is_identifier_blocked') {
          return Promise.resolve({ data: false, error: null });
        }
        // Resultado controlável pelo teste (data/error) — is_identifier_available.
        return (globalThis as Record<string, unknown>).__afRpcResult as Promise<unknown>;
      },
      auth: {
        signUp: (args: unknown) => {
          signUpSpy(args);
          return (globalThis as Record<string, unknown>).__afSignUpResult as Promise<unknown>;
        },
        signOut: () => {
          signOutSpy();
          return Promise.resolve({ error: null });
        },
      },
      from: (table: string) => ({
        insert: (payload: unknown) => {
          insertSpy(table, payload);
          if (table === 'users') {
            return (globalThis as Record<string, unknown>).__afUsersInsertResult;
          }
          // motoristas/embarcadores: sucesso por padrão.
          return { error: null };
        },
        delete: () => ({
          eq: (col: string, val: unknown) => {
            deleteEqSpy(table, col, val);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    },
  };
});

// Import APÓS o vi.mock (que é hoisted de qualquer forma).
import { register, AuthError, DUPLICATE_IDENTIFIER_MESSAGE } from '../services/auth';
import type { RegisterData } from '../types';

// ----- Handles dos spies expostos via globalThis -----
const rpcSpy = (globalThis as Record<string, unknown>).__afRpcSpy as ReturnType<typeof vi.fn>;
const signUpSpy = (globalThis as Record<string, unknown>).__afSignUpSpy as ReturnType<typeof vi.fn>;
const signOutSpy = (globalThis as Record<string, unknown>).__afSignOutSpy as ReturnType<
  typeof vi.fn
>;
const insertSpy = (globalThis as Record<string, unknown>).__afInsertSpy as ReturnType<typeof vi.fn>;
const deleteEqSpy = (globalThis as Record<string, unknown>).__afDeleteEqSpy as ReturnType<
  typeof vi.fn
>;

// ----- Helpers de estado controlável do mock -----
const TEST_USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW_ISO = new Date('2025-01-15T12:00:00.000Z').toISOString();

function setRpcResult(result: { data?: unknown; error?: { message: string } | null }) {
  (globalThis as Record<string, unknown>).__afRpcResult = Promise.resolve(result);
}

function setSignUpSuccess() {
  (globalThis as Record<string, unknown>).__afSignUpResult = Promise.resolve({
    data: {
      user: {
        id: TEST_USER_ID,
        email: '11987654321@example.com',
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
      session: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      },
    },
    error: null,
  });
}

function setUsersInsertResult(result: { error: { message: string } | null }) {
  (globalThis as Record<string, unknown>).__afUsersInsertResult = result;
}

const validMotoristaData: RegisterData = {
  phone: '11987654321',
  password: 'Senha123!',
  name: 'João Motorista',
  userType: 'motorista',
  acceptedVersion: 'terms@2026-06-05|privacy@2026-06-05',
  email: 'joao.motorista@exemplo.com',
  emailVerificationToken: '44444444-4444-4444-4444-444444444444',
};

describe('Anti-fraude integration — auth.register (Feature: trial-e-bloqueio, Task 4.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults seguros: identificador disponível, signUp OK, insert OK.
    setRpcResult({ data: true, error: null });
    setSignUpSuccess();
    setUsersInsertResult({ error: null });
  });

  // (a) Pré-check indisponível ⇒ rejeita com mensagem canônica, sem criar conta.
  it('rejeita com a mensagem canônica quando is_identifier_available retorna false e não cria a conta', async () => {
    setRpcResult({ data: false, error: null });

    const err = await register(validMotoristaData).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toBe(DUPLICATE_IDENTIFIER_MESSAGE);
    expect((err as AuthError).code).toBe('DUPLICATE_IDENTIFIER');

    // Pré-check ocorreu para o telefone informado.
    expect(rpcSpy).toHaveBeenCalledWith('is_identifier_available', {
      p_type: 'phone',
      p_value: validMotoristaData.phone,
    });
    // Não prosseguiu para criar a conta: signUp e insert NÃO foram chamados.
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // (b) Trigger duplicate_identifier:* ⇒ mensagem canônica + rollback compensatório.
  it('mapeia o erro do trigger duplicate_identifier para a mensagem canônica e executa o rollback (delete users + signOut)', async () => {
    // Pré-check passa (disponível), mas o trigger BEFORE INSERT aborta o insert.
    setRpcResult({ data: true, error: null });
    setUsersInsertResult({ error: { message: 'duplicate_identifier:phone' } });

    const err = await register(validMotoristaData).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toBe(DUPLICATE_IDENTIFIER_MESSAGE);
    expect((err as AuthError).code).toBe('DUPLICATE_IDENTIFIER');

    // O fluxo chegou até o insert em `users`.
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith('users', expect.objectContaining({ id: TEST_USER_ID }));

    // Rollback compensatório: delete em `users` pelo id + signOut — sem órfão.
    expect(deleteEqSpy).toHaveBeenCalledWith('users', 'id', TEST_USER_ID);
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  // (c) Fail-open: erro de infra na RPC NÃO bloqueia; register prossegue.
  it('fail-open: quando a RPC is_identifier_available retorna erro de infra, o pré-check não bloqueia e o cadastro prossegue', async () => {
    setRpcResult({ data: null, error: { message: 'infra failure / timeout' } });
    setSignUpSuccess();
    setUsersInsertResult({ error: null });

    const result = await register(validMotoristaData);

    // O pré-check foi tentado...
    expect(rpcSpy).toHaveBeenCalledWith('is_identifier_available', {
      p_type: 'phone',
      p_value: validMotoristaData.phone,
    });
    // ...mas NÃO bloqueou: o fluxo prosseguiu além do pré-check (signUp chamado).
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith('users', expect.objectContaining({ id: TEST_USER_ID }));

    // Cadastro concluído com sucesso (sem rollback).
    expect(result.user.phone).toBe(validMotoristaData.phone);
    expect(result.user.userType).toBe('motorista');
    expect(result.accessToken).toBe('access-token');
    expect(deleteEqSpy).not.toHaveBeenCalled();
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});
