/**
 * Property-Based Test (opcional) — Idempotência da remoção de segredo.
 *
 * Feature: finalizacao-lancamento, Property 5: Idempotência de clearSecret.
 * Validates: Requirements 4.4, 4.7.
 *
 * 1ª remoção em segredo definido ⇒ { ok, is_set:false }; chamadas subsequentes
 * ⇒ { skipped, reason:'ALREADY_CLEARED' } sem mutar (idempotente).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../services/supabase', () => {
  const state = { isSet: true, updatedAt: '2026-01-01T00:00:00.000Z', clearedCount: 0 };
  (globalThis as Record<string, unknown>).__scState = state;

  const rpc = vi.fn(async (name: string) => {
    if (name !== 'admin_settings_secret_clear') return { data: null, error: null };
    if (!state.isSet) {
      // Idempotente: já-limpo grava SKIPPED e retorna skip neutro.
      return { data: { skipped: true, reason: 'ALREADY_CLEARED' }, error: null };
    }
    state.isSet = false;
    state.clearedCount += 1;
    const next = new Date(Date.parse(state.updatedAt) + 1000).toISOString();
    state.updatedAt = next;
    return { data: { ok: true, is_set: false, updated_at: next }, error: null };
  });

  return { supabase: { rpc } };
});

import { clearSecret } from '../../../services/admin/settings';

const state = (globalThis as Record<string, unknown>).__scState as {
  isSet: boolean;
  updatedAt: string;
  clearedCount: number;
};

beforeEach(() => {
  state.isSet = true;
  state.updatedAt = '2026-01-01T00:00:00.000Z';
  state.clearedCount = 0;
});

describe('Property 5: idempotência de clearSecret (opcional)', () => {
  it('primeira remoção limpa; N chamadas extras retornam skip sem mutar', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (extra) => {
        state.isSet = true;
        state.clearedCount = 0;

        const first = await clearSecret({
          key: 'evolution_api_key',
          expectedUpdatedAt: state.updatedAt,
        });
        expect('ok' in first && first.ok).toBe(true);

        for (let i = 0; i < extra; i++) {
          const again = await clearSecret({
            key: 'evolution_api_key',
            expectedUpdatedAt: state.updatedAt,
          });
          expect('skipped' in again && again.skipped).toBe(true);
          if ('skipped' in again) expect(again.reason).toBe('ALREADY_CLEARED');
        }

        // Mutação real aconteceu exatamente uma vez.
        expect(state.clearedCount).toBe(1);
      }),
      { numRuns: 50 }
    );
  });
});
