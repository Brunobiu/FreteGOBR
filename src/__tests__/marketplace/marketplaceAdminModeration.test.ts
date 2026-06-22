/**
 * Testes da moderação admin do Marketplace (removeMarketplacePost).
 *
 * Valida: a RPC marketplace_remove_post é chamada com {p_id}; em sucesso o
 * audit MARKETPLACE_POST_REMOVED é gravado (via executeAdminMutation); em
 * falha da RPC, propaga o erro (e o wrapper grava o _ROLLBACK).
 *
 * Convenção: vi.mock hoisted — impl da rpc exposta via globalThis.__modRpc.
 *
 * Validates: Requirements 11.3, 11.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/supabase', () => {
  const g = globalThis as Record<string, unknown>;
  return {
    supabase: {
      rpc: (...a: unknown[]) => (g.__modRpc as (...x: unknown[]) => unknown)?.(...a),
    },
  };
});

import { removeMarketplacePost } from '../../services/admin/marketplace';

const g = globalThis as Record<string, unknown>;

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete g.__modRpc;
});

describe('removeMarketplacePost', () => {
  it('chama marketplace_remove_post com {p_id} e grava o audit', async () => {
    const calls: RpcCall[] = [];
    g.__modRpc = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: name === 'log_admin_action' ? 'log-1' : { ok: true }, error: null };
    };

    await removeMarketplacePost('post-1');

    const remove = calls.find((c) => c.name === 'marketplace_remove_post');
    expect(remove).toBeTruthy();
    expect(remove?.args).toEqual({ p_id: 'post-1' });

    // executeAdminMutation gravou o log inicial (action MARKETPLACE_POST_REMOVED).
    const log = calls.find(
      (c) => c.name === 'log_admin_action' && c.args.p_action === 'MARKETPLACE_POST_REMOVED'
    );
    expect(log).toBeTruthy();
  });

  it('propaga erro da RPC (e dispara o _ROLLBACK)', async () => {
    const actions: string[] = [];
    g.__modRpc = async (name: string, args: Record<string, unknown>) => {
      if (name === 'log_admin_action') {
        actions.push(String(args.p_action));
        return { data: 'log-x', error: null };
      }
      // marketplace_remove_post falha
      return { data: null, error: { message: 'boom' } };
    };

    await expect(removeMarketplacePost('post-2')).rejects.toBeTruthy();
    expect(actions).toContain('MARKETPLACE_POST_REMOVED');
    expect(actions.some((a) => a.endsWith('_ROLLBACK'))).toBe(true);
  });
});
