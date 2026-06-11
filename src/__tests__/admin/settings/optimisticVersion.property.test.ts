/**
 * Property-Based Test (opcional) — Versionamento otimista + chave inexistente.
 *
 * Feature: finalizacao-lancamento, Property 4: Versionamento otimista.
 * Validates: Requirements 3.4, 3.6, 10.4.
 *
 * A RPC `admin_settings_update` é modelada por um store in-memory:
 *   - expected_updated_at igual ⇒ aplica e avança updated_at;
 *   - expected_updated_at divergente ⇒ STALE_VERSION sem mutar;
 *   - key ausente ⇒ SETTING_NOT_FOUND sem criar registro.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock hoisted do supabase: a RPC update vira um modelo de store.
vi.mock('../../../services/supabase', () => {
  const store = new Map<string, { value: unknown; updated_at: string }>();
  (globalThis as Record<string, unknown>).__svStore = store;

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'admin_settings_update') return { data: null, error: null };
    const key = args.p_key as string;
    const row = store.get(key);
    if (!row) {
      return { data: null, error: { message: 'SETTING_NOT_FOUND', code: 'P0001' } };
    }
    if (row.updated_at !== (args.p_expected_updated_at as string)) {
      return { data: null, error: { message: 'STALE_VERSION', code: 'P0001' } };
    }
    const next = new Date(Date.parse(row.updated_at) + 1000).toISOString();
    store.set(key, { value: args.p_value, updated_at: next });
    return { data: { ok: true, updated_at: next }, error: null };
  });

  return { supabase: { rpc } };
});

// Audit não-relevante aqui: passa direto pela fn.
vi.mock('../../../services/admin/audit', () => ({
  executeAdminMutation: vi.fn(async <T>(_i: unknown, fn: () => Promise<T>) => fn()),
}));

import { updateSetting, SettingsServiceError } from '../../../services/admin/settings';

const store = (globalThis as Record<string, unknown>).__svStore as Map<
  string,
  { value: unknown; updated_at: string }
>;

beforeEach(() => {
  store.clear();
});

describe('Property 4: versionamento otimista (opcional)', () => {
  it('expected_updated_at correto aplica e avança updated_at', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 8 }), async (newVal) => {
        store.clear();
        const uat = '2026-01-01T00:00:00.000Z';
        store.set('k', { value: 'old', updated_at: uat });

        const r = await updateSetting({ key: 'k', value: newVal, expectedUpdatedAt: uat });
        expect(r.updatedAt).not.toBe(uat);
        expect(store.get('k')!.value).toBe(newVal);
      }),
      { numRuns: 50 }
    );
  });

  it('expected_updated_at divergente ⇒ STALE_VERSION sem mutar', async () => {
    store.set('k', { value: 'keep', updated_at: '2026-01-01T00:00:00.000Z' });
    await expect(
      updateSetting({ key: 'k', value: 'x', expectedUpdatedAt: '1999-01-01T00:00:00.000Z' })
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(store.get('k')!.value).toBe('keep');
  });

  it('key ausente ⇒ SETTING_NOT_FOUND sem criar registro', async () => {
    await expect(
      updateSetting({ key: 'inexistente', value: 'x', expectedUpdatedAt: 'whatever' })
    ).rejects.toBeInstanceOf(SettingsServiceError);
    expect(store.has('inexistente')).toBe(false);
  });
});
