/**
 * Teste de regressão — getEmbarcadorPublicCard mapeia o CNPJ.
 *
 * Garante que o campo `cnpj` retornado pela RPC `get_embarcador_public_card`
 * é mapeado para o objeto do cartão público (usado no cabeçalho do modal do
 * frete, exibido como "<Empresa> — <CNPJ>"). Evita regressão caso alguém
 * mexa no shape da RPC ou no mapeamento.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/supabase', () => {
  const rpcSpy = vi.fn();
  (globalThis as Record<string, unknown>).__pcRpcSpy = rpcSpy;
  return { supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) } };
});

import { getEmbarcadorPublicCard } from '../../services/embarcador';

const rpc = () => (globalThis as Record<string, unknown>).__pcRpcSpy as ReturnType<typeof vi.fn>;

describe('getEmbarcadorPublicCard — CNPJ', () => {
  beforeEach(() => rpc().mockReset());

  it('mapeia o cnpj retornado pela RPC', async () => {
    rpc().mockResolvedValue({
      data: {
        id: 'emb-1',
        company_name: 'Safra Log',
        company_logo_url: null,
        cnpj: '12345678000190',
        branch_state: 'GO',
        branch_city: 'Goiânia',
        user_name: 'Kalleb',
        profile_photo_url: null,
      },
      error: null,
    });

    const card = await getEmbarcadorPublicCard('emb-1');
    expect(card?.companyName).toBe('Safra Log');
    expect(card?.cnpj).toBe('12345678000190');
  });

  it('cnpj null quando o embarcador não tem CNPJ cadastrado', async () => {
    rpc().mockResolvedValue({
      data: {
        id: 'emb-2',
        company_name: 'Empresa Sem CNPJ',
        company_logo_url: null,
        cnpj: null,
        branch_state: null,
        branch_city: null,
        user_name: 'Fulano',
        profile_photo_url: null,
      },
      error: null,
    });

    const card = await getEmbarcadorPublicCard('emb-2');
    expect(card?.cnpj).toBeNull();
  });
});
