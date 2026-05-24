/**
 * CP-2: Toggle ativo->ativo e idempotente
 *
 * Para todo userId nao-Master e nao-self, e todo targetState ∈ {true,false},
 * `bulkToggleActive([userId], targetState)` quando o registro ja esta no targetState
 * resulta em skip com motivo `ALREADY_IN_TARGET_STATE` e nao gera UPDATE no banco.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// vi.mock e hoisted: todas as variaveis sao definidas dentro do factory
vi.mock('../../../services/supabase', () => {
  const CALLER_ID = '00000000-0000-0000-0000-000000000000';
  const dbState = new Map<
    string,
    { admin_username: string | null; is_active: boolean; updated_at: string }
  >();
  const updateSpy = vi.fn();

  // Expoe controles para o teste via globalThis
  (globalThis as Record<string, unknown>).__testCallerId = CALLER_ID;
  (globalThis as Record<string, unknown>).__testDbState = dbState;
  (globalThis as Record<string, unknown>).__testUpdateSpy = updateSpy;

  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: CALLER_ID } } }),
      },
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn().mockReturnValue(builder);
        builder.eq = vi.fn().mockReturnValue(builder);
        builder.in = vi.fn(async (_col: string, ids: string[]) => {
          const data = ids
            .filter((id) => dbState.has(id))
            .map((id) => ({ id, ...dbState.get(id)! }));
          return { data };
        });
        builder.order = vi.fn().mockReturnValue(builder);
        builder.maybeSingle = vi.fn().mockResolvedValue({ data: null });
        builder.update = vi.fn(() => {
          updateSpy('update');
          return builder;
        });
        return builder;
      }),
    },
  };
});

vi.mock('../../../services/admin/audit', () => ({
  executeAdminMutation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
  logAdminAction: vi.fn().mockResolvedValue(null),
}));

import { bulkToggleActive } from '../../../services/admin/users';

const callerId = (globalThis as Record<string, unknown>).__testCallerId as string;
const dbState = (globalThis as Record<string, unknown>).__testDbState as Map<
  string,
  { admin_username: string | null; is_active: boolean; updated_at: string }
>;
const updateSpy = (globalThis as Record<string, unknown>).__testUpdateSpy as ReturnType<
  typeof vi.fn
>;

describe('CP-2: Toggle e idempotente quando ja no estado-alvo', () => {
  beforeEach(() => {
    updateSpy.mockClear();
    dbState.clear();
  });

  it('chamar duas vezes com mesmo targetState resulta em skip nas duas se ja estava no estado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid().filter((id) => id !== callerId),
        fc.boolean(),
        async (userId, targetState) => {
          updateSpy.mockClear();
          dbState.set(userId, {
            admin_username: null,
            is_active: targetState,
            updated_at: '2025-01-01T00:00:00Z',
          });

          const result1 = await bulkToggleActive([userId], targetState);
          expect(result1.success).toHaveLength(0);
          expect(result1.skipped).toHaveLength(1);
          expect(result1.skipped[0].reason).toBe('ALREADY_IN_TARGET_STATE');
          expect(updateSpy).not.toHaveBeenCalled();

          const result2 = await bulkToggleActive([userId], targetState);
          expect(result2.skipped[0].reason).toBe('ALREADY_IN_TARGET_STATE');
          expect(updateSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Master_Admin sempre e pulado mesmo se ja no estado-alvo', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (targetState) => {
        updateSpy.mockClear();
        const masterId = '11111111-1111-1111-1111-111111111111';
        dbState.set(masterId, {
          admin_username: 'Nexus_Vortex99',
          is_active: targetState,
          updated_at: '2025-01-01T00:00:00Z',
        });

        const result = await bulkToggleActive([masterId], targetState);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].reason).toBe('MASTER_ADMIN_IMMUTABLE');
        expect(updateSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 20 }
    );
  });
});
