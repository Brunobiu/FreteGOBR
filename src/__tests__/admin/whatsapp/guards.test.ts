/**
 * Testes unitários da guarda de acesso/anti-enumeração + wrappers de Vault do
 * WhatsApp_Module (task 5.2).
 *
 * Cobre:
 *  - Mapeamento do marker SQL `WHATSAPP_NOT_FOUND` (e ERRCODE P0001) para a
 *    Canonical_Message anti-enumeração (Req 2.8, 30.8).
 *  - Wrappers `setInstanceSecret`/`instanceSecretIsSet`: nunca expõem segredo,
 *    propagam a mensagem mapeada em erro de guarda.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ----- Mock hoisted do supabase: rpc spy exposto via globalThis -----
vi.mock('../../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__waGuardRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

import {
  WHATSAPP_CANONICAL_OPERATION_FAILED,
  WHATSAPP_NOT_FOUND_MARKER,
  isInstanceGuardError,
  mapInstanceGuardError,
  setInstanceSecret,
  instanceSecretIsSet,
} from '../../../services/admin/whatsapp/guards';
import { CANONICAL_MESSAGES } from '../../_helpers/antiEnumeration';

const rpcSpy = (globalThis as Record<string, unknown>).__waGuardRpcSpy as ReturnType<typeof vi.fn>;

const INSTANCE = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  rpcSpy.mockReset();
});

describe('canonical message', () => {
  it('é exatamente a mensagem canônica pt-BR esperada', () => {
    expect(WHATSAPP_CANONICAL_OPERATION_FAILED).toBe('Não foi possível concluir a operação.');
  });

  it('reusa conceitualmente o mesmo texto base das CANONICAL_MESSAGES (prefixo "Não foi possível")', () => {
    // A constante de produção vive no módulo de serviço; os helpers de teste
    // apenas confirmam que seguimos o mesmo padrão de redação.
    expect(WHATSAPP_CANONICAL_OPERATION_FAILED.startsWith('Não foi possível')).toBe(true);
    expect(CANONICAL_MESSAGES.AUTH.startsWith('Não foi possível')).toBe(true);
  });
});

describe('isInstanceGuardError', () => {
  it('reconhece o marker WHATSAPP_NOT_FOUND na mensagem', () => {
    expect(isInstanceGuardError({ message: WHATSAPP_NOT_FOUND_MARKER })).toBe(true);
    expect(isInstanceGuardError({ message: `erro: ${WHATSAPP_NOT_FOUND_MARKER} (P0001)` })).toBe(
      true
    );
  });

  it('reconhece o marker presente em details/hint', () => {
    expect(isInstanceGuardError({ details: WHATSAPP_NOT_FOUND_MARKER })).toBe(true);
    expect(isInstanceGuardError({ hint: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' })).toBe(true);
  });

  it('não confunde outros erros (permission_denied, stale, etc.)', () => {
    expect(
      isInstanceGuardError({ message: 'permission_denied: SETTINGS_EDIT', code: '42501' })
    ).toBe(false);
    expect(isInstanceGuardError({ message: 'STALE_VERSION', code: 'P0001' })).toBe(false);
    expect(isInstanceGuardError(null)).toBe(false);
    expect(isInstanceGuardError('boom')).toBe(false);
  });
});

describe('mapInstanceGuardError', () => {
  it('mapeia erro de guarda para a Canonical_Message (não revela existência)', () => {
    const msg = mapInstanceGuardError({ message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' });
    expect(msg).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
  });

  it('propaga a mensagem original de erros não-guarda', () => {
    expect(mapInstanceGuardError({ message: 'permission_denied: SETTINGS_EDIT' })).toBe(
      'permission_denied: SETTINGS_EDIT'
    );
  });

  it('usa a Canonical_Message como fallback quando não há mensagem utilizável', () => {
    expect(mapInstanceGuardError({})).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
    expect(mapInstanceGuardError(undefined)).toBe(WHATSAPP_CANONICAL_OPERATION_FAILED);
  });
});

describe('setInstanceSecret', () => {
  it('chama a RPC com os parâmetros corretos e não retorna o segredo', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });

    const result = await setInstanceSecret(INSTANCE, 'EVOLUTION', 'super-secret-key');

    expect(result).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_set_instance_secret', {
      p_instance_id: INSTANCE,
      p_kind: 'EVOLUTION',
      p_secret: 'super-secret-key',
    });
  });

  it('mapeia erro de guarda para a Canonical_Message', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' },
    });

    await expect(setInstanceSecret(INSTANCE, 'AI', 'k')).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
  });
});

describe('instanceSecretIsSet', () => {
  it('retorna apenas o booleano de presença (true)', async () => {
    rpcSpy.mockResolvedValue({ data: true, error: null });
    await expect(instanceSecretIsSet(INSTANCE, 'AI')).resolves.toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('whatsapp_instance_secret_is_set', {
      p_instance_id: INSTANCE,
      p_kind: 'AI',
    });
  });

  it('normaliza ausência/valor não-booleano para false', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    await expect(instanceSecretIsSet(INSTANCE, 'EVOLUTION')).resolves.toBe(false);
  });

  it('mapeia erro de guarda para a Canonical_Message', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: WHATSAPP_NOT_FOUND_MARKER, code: 'P0001' },
    });
    await expect(instanceSecretIsSet(INSTANCE, 'EVOLUTION')).rejects.toThrow(
      WHATSAPP_CANONICAL_OPERATION_FAILED
    );
  });
});
