/**
 * Testes unitários de RBAC gating + anti-enumeração do WhatsApp_Module na
 * fronteira de serviço TypeScript (task 5.3).
 *
 * As RPCs reais são `SECURITY DEFINER` (lado SQL): aqui modelamos o
 * comportamento na camada de serviço, mockando `supabase.rpc` e exercitando os
 * guards de `guards.ts` (`mapInstanceGuardError`/`isInstanceGuardError` + os
 * wrappers de Vault `setInstanceSecret`/`instanceSecretIsSet`).
 *
 * Reusa exclusivamente os helpers canônicos de `src/__tests__/_helpers/`:
 *  - `expectPermissionDenied` (authAssertions): PRECEDÊNCIA — `permission_denied`
 *    vence qualquer erro de validação simultâneo (Req 1.2, 1.6).
 *  - `expectViewDenied` (auditAssertions): caminho negativo grava
 *    `WHATSAPP_VIEW_DENIED` com `before=NULL` (admin-patterns §1/§2).
 *  - `expectIndistinguishable` (antiEnumeration): respostas para instância
 *    inexistente vs. cruzada são idênticas → Canonical_Message
 *    `Não foi possível concluir a operação.` (Req 2.8, 18.5, 30.8). A constante
 *    de PRODUÇÃO vive em `guards.ts` (`WHATSAPP_CANONICAL_OPERATION_FAILED`);
 *    `expectAntiEnumeration` cobre apenas a família auth (AUTH/SIGNUP/CODE), por
 *    isso usamos `expectIndistinguishable` + a constante de produção como fonte
 *    única da verdade — sem duplicar a mensagem nos helpers.
 *  - `expectNoSecrets` (logAssertions): nenhum valor de segredo vaza em
 *    mensagens lançadas ou dados retornados (Req 18.5, 18.7).
 *
 * Validates: Requirements 1.2, 1.6, 2.8, 18.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waGatingRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

import { supabase } from '../../../services/supabase';
import {
  WHATSAPP_CANONICAL_OPERATION_FAILED,
  WHATSAPP_NOT_FOUND_MARKER,
  mapInstanceGuardError,
  setInstanceSecret,
  instanceSecretIsSet,
} from '../../../services/admin/whatsapp/guards';
import { expectPermissionDenied } from '../../_helpers/authAssertions';
import { expectIndistinguishable } from '../../_helpers/antiEnumeration';
import { expectViewDenied, type AuditLogRowLike } from '../../_helpers/auditAssertions';
import { expectNoSecrets } from '../../_helpers/logAssertions';

const rpcSpy = (globalThis as Record<string, unknown>).__waGatingRpcSpy as ReturnType<typeof vi.fn>;

const CALLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INSTANCE = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT = '22222222-2222-2222-2222-222222222222';
const OTHER_INSTANCE = '33333333-3333-3333-3333-333333333333';

/** Audit log in-memory que espelha o `INSERT` server-side da guarda negativa. */
let auditLog: AuditLogRowLike[] = [];

beforeEach(() => {
  rpcSpy.mockReset();
  auditLog = [];
});

/**
 * Modela a fronteira de serviço de uma RPC gated: chama `supabase.rpc` e, em
 * erro, traduz pela mesma rota dos wrappers de produção (`mapInstanceGuardError`),
 * lançando a mensagem mapeada. Espelha o contrato de `setInstanceSecret`.
 */
async function callGatedRpc(fn: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }
  return data;
}

describe('RBAC gating — permission_denied tem precedência', () => {
  it('surfaces permission_denied even when a validation error occurs simultaneously', async () => {
    // Guarda SQL: o check de permissão ocorre ANTES das validações; ao negar,
    // grava o audit negativo e levanta permission_denied — a falha de validação
    // simultânea NÃO deve vencer.
    rpcSpy.mockImplementation(async () => {
      auditLog.push({
        action: 'WHATSAPP_VIEW_DENIED',
        target_type: null,
        target_id: null,
        before_data: null,
        after_data: { user_id: CALLER, reason: 'permission_denied' },
      });
      return {
        data: null,
        error: {
          message: 'permission_denied: SETTINGS_EDIT required',
          code: '42501',
          // erro de validação presente ao mesmo tempo — não pode prevalecer
          details: 'validation: Informe um intervalo válido.',
        },
      };
    });

    let caught: unknown;
    try {
      await callGatedRpc('whatsapp_create_dispatch_job', {
        p_instance_id: INSTANCE,
        p_send_interval_sec: -1, // input inválido (validation error)
        p_execution_quota: 0, // input inválido (validation error)
      });
    } catch (err) {
      caught = err;
    }

    // Precedência: o que vaza é permission_denied, não a mensagem de validação.
    expectPermissionDenied(caught);
    expect((caught as Error).message).not.toContain('intervalo');
    expect((caught as Error).message).not.toContain('quantidade');
  });

  it('records WHATSAPP_VIEW_DENIED (before=NULL) on the denied negative path', async () => {
    rpcSpy.mockImplementation(async () => {
      auditLog.push({
        action: 'WHATSAPP_VIEW_DENIED',
        target_type: null,
        target_id: null,
        before_data: null,
        after_data: { user_id: CALLER, reason: 'permission_denied' },
      });
      return {
        data: null,
        error: { message: 'permission_denied: SETTINGS_VIEW required', code: '42501' },
      };
    });

    await expect(callGatedRpc('whatsapp_list_instances', {})).rejects.toThrow(/permission_denied/);

    // O registro negativo precisa estar "persistido" com before=NULL.
    await expectViewDenied(() => auditLog, 'WHATSAPP_VIEW_DENIED');
  });
});

describe('anti-enumeração — WHATSAPP_NOT_FOUND → Canonical_Message', () => {
  it('maps WHATSAPP_NOT_FOUND (ERRCODE P0001) to the canonical operation-failed message', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' },
    });

    await expect(instanceSecretIsSet(INSTANCE, 'AI')).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
    expect(WHATSAPP_CANONICAL_OPERATION_FAILED).toBe('Não foi possível concluir a operação.');
  });

  it('returns indistinguishable responses for non-existing vs cross-instance access', async () => {
    // Instância inexistente: a guarda levanta WHATSAPP_NOT_FOUND.
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' },
    });
    let nonExistingMsg = '';
    try {
      await instanceSecretIsSet(NON_EXISTENT, 'AI');
    } catch (err) {
      nonExistingMsg = (err as Error).message;
    }

    // Instância existente porém fora de acesso (cross-instance): mesma guarda,
    // resposta idêntica — impossível distinguir "não existe" de "sem acesso".
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' },
    });
    let crossMsg = '';
    try {
      await instanceSecretIsSet(OTHER_INSTANCE, 'AI');
    } catch (err) {
      crossMsg = (err as Error).message;
    }

    expectIndistinguishable({ message: nonExistingMsg }, { message: crossMsg });
    expect(nonExistingMsg).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
  });
});

describe('não-vazamento de segredos (expectNoSecrets)', () => {
  const SECRET = 'sb_secret_supersecretvalue1234567890';

  it('never echoes the secret value in the thrown message on guard error', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' },
    });

    let msg = '';
    try {
      await setInstanceSecret(INSTANCE, 'EVOLUTION', SECRET);
    } catch (err) {
      msg = (err as Error).message;
    }

    expect(msg).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
    expectNoSecrets(msg);

    // O segredo trafega para a RPC (esperado), mas nunca volta na superfície.
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_set_instance_secret', {
      p_instance_id: INSTANCE,
      p_kind: 'EVOLUTION',
      p_secret: SECRET,
    });
  });

  it('returns no secret value on a successful set (returns void)', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });

    const result = await setInstanceSecret(INSTANCE, 'EVOLUTION', SECRET);

    expect(result).toBeUndefined();
    expectNoSecrets(result);
  });

  it('checker returns only a presence boolean, never the secret', async () => {
    rpcSpy.mockResolvedValue({ data: true, error: null });

    const isSet = await instanceSecretIsSet(INSTANCE, 'AI');

    expect(isSet).toBe(true);
    expectNoSecrets(isSet);
  });
});
