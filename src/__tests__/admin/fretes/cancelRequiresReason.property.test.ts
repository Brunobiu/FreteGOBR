/**
 * CP-2: cancelFrete falha com INVALID_INPUT para motivos vazios/whitespace
 *
 * Para toda string r ∈ {undefined, null, '', whitespace}, cancelFrete(id, r)
 * falha com FretesServiceError(INVALID_INPUT) ANTES de qualquer chamada
 * ao banco e ANTES de qualquer audit log de mutacao principal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => {
  const dbCallSpy = vi.fn();
  (globalThis as Record<string, unknown>).__testCancelDbSpy = dbCallSpy;
  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-id' } } }),
      },
      from: vi.fn(() => {
        dbCallSpy('from');
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn().mockReturnValue(builder);
        builder.eq = vi.fn().mockReturnValue(builder);
        builder.in = vi.fn().mockResolvedValue({ data: [], error: null });
        builder.maybeSingle = vi.fn().mockResolvedValue({ data: null });
        builder.update = vi.fn().mockReturnValue(builder);
        return builder;
      }),
    },
  };
});

vi.mock('../../../services/admin/audit', () => {
  const mutationSpy = vi.fn();
  (globalThis as Record<string, unknown>).__testCancelMutationSpy = mutationSpy;
  return {
    executeAdminMutation: vi.fn(async (input: unknown, fn: () => Promise<unknown>) => {
      mutationSpy(input);
      return fn();
    }),
    logAdminAction: vi.fn().mockResolvedValue(null),
  };
});

import { cancelFrete, FretesServiceError } from '../../../services/admin/fretes';

const dbCallSpy = (globalThis as Record<string, unknown>).__testCancelDbSpy as ReturnType<
  typeof vi.fn
>;
const mutationSpy = (globalThis as Record<string, unknown>).__testCancelMutationSpy as ReturnType<
  typeof vi.fn
>;

describe('CP-2: cancelFrete sem motivo falha com INVALID_INPUT', () => {
  beforeEach(() => {
    dbCallSpy.mockClear();
    mutationSpy.mockClear();
  });

  it('rejeita string vazia, whitespace, null e undefined ANTES de tocar banco', async () => {
    const emptyOrWhitespace = fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.constant('\t\n'),
      fc.constant('  \r\n\t  '),
      fc.constant(undefined as unknown as string),
      fc.constant(null as unknown as string),
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length === 0)
    );

    await fc.assert(
      fc.asyncProperty(fc.uuid(), emptyOrWhitespace, async (freteId, reason) => {
        dbCallSpy.mockClear();
        mutationSpy.mockClear();

        let caught: unknown = null;
        try {
          await cancelFrete(freteId, reason);
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(FretesServiceError);
        expect((caught as FretesServiceError).code).toBe('INVALID_INPUT');

        // Banco nao foi tocado e mutacao principal nao foi disparada
        expect(dbCallSpy).not.toHaveBeenCalled();
        expect(mutationSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });
});
