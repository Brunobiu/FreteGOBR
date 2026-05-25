/**
 * CP-1: forceCloseFrete e idempotente em frete encerrado
 *
 * Para todo frete f com f.status = 'encerrado', forceCloseFrete(f.id)
 * retorna { skipped: true, reason: 'ALREADY_IN_TARGET_STATE' },
 * NAO executa UPDATE no banco, e gera exatamente 1 audit log
 * 'FRETE_FORCE_CLOSE_SKIPPED'.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => {
  const updateSpy = vi.fn();
  (globalThis as Record<string, unknown>).__testFretesUpdateSpy = updateSpy;
  (globalThis as Record<string, unknown>).__testFretesStatus = 'encerrado';

  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-id' } } }),
      },
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn().mockReturnValue(builder);
        builder.eq = vi.fn().mockReturnValue(builder);
        builder.in = vi.fn().mockResolvedValue({ data: [], error: null });
        builder.maybeSingle = vi.fn().mockImplementation(async () => {
          const status = (globalThis as Record<string, unknown>).__testFretesStatus as string;
          return {
            data: {
              id: 'frete-id',
              embarcador_id: 'emb-id',
              origin: 'SP',
              destination: 'RJ',
              cargo_type: 'Soja',
              vehicle_type: 'Truck',
              weight: 1000,
              value: 5000,
              deadline: '2030-01-01',
              loading_time: 60,
              unloading_time: 60,
              specifications: null,
              status,
              cancel_reason: null,
              flagged_for_review: false,
              flagged_reason: null,
              flagged_at: null,
              flagged_by: null,
              views_count: 10,
              clicks_count: 2,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
              users: { name: 'Embarcador' },
              embarcadores: { cnpj: '12345' },
            },
          };
        });
        builder.update = vi.fn(() => {
          updateSpy('update');
          return builder;
        });
        return builder;
      }),
    },
  };
});

vi.mock('../../../services/admin/audit', () => {
  const logSpy = vi.fn();
  (globalThis as Record<string, unknown>).__testFretesLogSpy = logSpy;
  return {
    executeAdminMutation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
    logAdminAction: vi.fn(async (input: { action: string }) => {
      logSpy(input.action);
      return null;
    }),
  };
});

import { forceCloseFrete } from '../../../services/admin/fretes';

const updateSpy = (globalThis as Record<string, unknown>).__testFretesUpdateSpy as ReturnType<
  typeof vi.fn
>;
const logSpy = (globalThis as Record<string, unknown>).__testFretesLogSpy as ReturnType<
  typeof vi.fn
>;

describe('CP-1: forceCloseFrete e idempotente em frete encerrado', () => {
  beforeEach(() => {
    updateSpy.mockClear();
    logSpy.mockClear();
    (globalThis as Record<string, unknown>).__testFretesStatus = 'encerrado';
  });

  it('retorna skipped + nao toca banco + gera 1 log _SKIPPED', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.integer({ min: 1, max: 5 }), async (freteId, n) => {
        updateSpy.mockClear();
        logSpy.mockClear();

        for (let i = 0; i < n; i++) {
          const r = await forceCloseFrete(freteId);
          expect(r).toEqual({
            skipped: true,
            reason: 'ALREADY_IN_TARGET_STATE',
          });
        }

        expect(updateSpy).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledTimes(n);
        for (const call of logSpy.mock.calls) {
          expect(call[0]).toBe('FRETE_FORCE_CLOSE_SKIPPED');
        }
      }),
      { numRuns: 50 }
    );
  });
});
