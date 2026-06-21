/**
 * Testes do service getPublicStats (números públicos da landing).
 *
 * Cobre: parsing do payload da RPC, normalização de valores ausentes/inválidos
 * para 0 e fallback para `null` em caso de erro (RPC ausente, erro de rede).
 *
 * Convenção do projeto: `vi.mock` é hoisted — não referenciar variáveis
 * externas no factory; o impl mutável da RPC é exposto via
 * `(globalThis as Record<string, unknown>).__rpcImpl`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) =>
      (globalThis as Record<string, unknown>).__rpcImpl &&
      ((globalThis as Record<string, unknown>).__rpcImpl as (...a: unknown[]) => unknown)(...args),
  },
}));

import { getPublicStats } from '../services/publicStats';

function setRpc(impl: () => Promise<{ data: unknown; error: unknown }>) {
  (globalThis as Record<string, unknown>).__rpcImpl = impl;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPublicStats', () => {
  it('retorna as contagens quando a RPC responde com sucesso', async () => {
    setRpc(() =>
      Promise.resolve({ data: { fretes: 128, motoristas: 57, embarcadores: 12 }, error: null })
    );
    const s = await getPublicStats();
    expect(s).toEqual({ fretes: 128, motoristas: 57, embarcadores: 12 });
  });

  it('retorna null quando a RPC devolve erro (ex.: função ausente)', async () => {
    setRpc(() => Promise.resolve({ data: null, error: { message: 'function not found' } }));
    expect(await getPublicStats()).toBeNull();
  });

  it('normaliza chaves ausentes ou inválidas para 0', async () => {
    setRpc(() => Promise.resolve({ data: { fretes: 5, motoristas: 'x' }, error: null }));
    expect(await getPublicStats()).toEqual({ fretes: 5, motoristas: 0, embarcadores: 0 });
  });

  it('retorna null quando o payload não é um objeto', async () => {
    setRpc(() => Promise.resolve({ data: null, error: null }));
    expect(await getPublicStats()).toBeNull();
  });

  it('retorna null quando a chamada lança (rede)', async () => {
    setRpc(() => Promise.reject(new Error('network down')));
    expect(await getPublicStats()).toBeNull();
  });
});
