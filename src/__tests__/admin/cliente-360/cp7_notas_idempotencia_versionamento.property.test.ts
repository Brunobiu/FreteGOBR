// Feature: admin-cliente-360, Property 7: Idempotencia e versionamento das notas.
//
// Editar com expected_updated_at divergente => STALE_VERSION sem mutar; remover
// nota inexistente => { skipped, reason:'ALREADY_REMOVED' } (a RPC grava
// USER_NOTE_DELETE_SKIPPED), enquanto qualquer OUTRA condicao de erro propaga;
// N remocoes da mesma nota => exatamente 1 USER_NOTE_DELETE + (N-1) skipped.
//
// Validates: Requirements 14.5, 14.7, 14.10

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

type RpcResult = { data: unknown; error: unknown };
type G = {
  __rpc?: (name: string, args?: unknown) => Promise<RpcResult>;
  __log?: (action: string) => void;
};

vi.mock('../../../services/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      const fn = (globalThis as unknown as G).__rpc;
      return fn ? fn(name, args) : Promise.resolve({ data: null, error: null });
    },
  },
}));

vi.mock('../../../services/admin/audit', () => ({
  logAdminAction: (input: { action: string }) => {
    (globalThis as unknown as G).__log?.(input.action);
    return Promise.resolve('log-id');
  },
  executeAdminMutation: async (input: { action: string }, fn: () => Promise<unknown>) => {
    (globalThis as unknown as G).__log?.(input.action);
    return fn();
  },
}));

import { deleteNote, updateNote, Cliente360Error } from '../../../services/admin/cliente360';

function setLog(): string[] {
  const logs: string[] = [];
  (globalThis as unknown as G).__log = (a) => logs.push(a);
  return logs;
}

beforeEach(() => {
  (globalThis as unknown as G).__rpc = undefined;
  (globalThis as unknown as G).__log = undefined;
});

describe('CP-7 notas: idempotencia e versionamento', () => {
  it('N remocoes => exatamente 1 USER_NOTE_DELETE + (N-1) skipped', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (n) => {
        const logs = setLog();
        let deleted = false;
        (globalThis as unknown as G).__rpc = (name) => {
          if (name === 'admin_user_note_delete') {
            if (!deleted) {
              deleted = true;
              return Promise.resolve({ data: { ok: true, deleted: 1 }, error: null });
            }
            return Promise.resolve({ data: { skipped: true, reason: 'ALREADY_REMOVED' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        };

        const results = [];
        for (let i = 0; i < n; i++) results.push(await deleteNote('note-1'));

        expect(results.filter((r) => 'ok' in r).length).toBe(1);
        expect(results.filter((r) => 'skipped' in r).length).toBe(n - 1);
        for (const r of results) {
          if ('skipped' in r) expect(r.reason).toBe('ALREADY_REMOVED');
        }
        // audit positivo gravado exatamente 1x (o _SKIPPED e gravado pela RPC)
        expect(logs.filter((a) => a === 'USER_NOTE_DELETE').length).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it('update com versao divergente => STALE_VERSION sem mutar', async () => {
    setLog();
    (globalThis as unknown as G).__rpc = (name) => {
      if (name === 'admin_user_note_update') {
        return Promise.resolve({ data: null, error: { code: 'P0001', message: 'STALE_VERSION' } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    await expect(updateNote('n1', 'corpo valido', '2020-01-01T00:00:00Z')).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
  });

  it('erro de remocao != inexistencia propaga (nao vira skip)', async () => {
    setLog();
    (globalThis as unknown as G).__rpc = (name) => {
      if (name === 'admin_user_note_delete') {
        return Promise.resolve({ data: null, error: { code: 'XX999', message: 'db connection lost' } });
      }
      return Promise.resolve({ data: null, error: null });
    };
    await expect(deleteNote('n1')).rejects.toBeInstanceOf(Cliente360Error);
  });
});
