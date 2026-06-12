/**
 * Feature: startup-performance-optimization
 * Property 9: Invalidação e expiração forçam nova busca
 *
 * Para qualquer chave, após a entrada expirar (`now >= expiresAt`) ou ser
 * invalidada (por escrita via `invalidate(key)`, por `invalidateNamespace`,
 * ou por evento de Realtime_Channel), a próxima solicitação ao Data_Cache
 * invoca o fetcher novamente e NÃO retorna o valor obsoleto.
 *
 * Validates: Requirements 6.3, 6.4, 6.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { dataCache } from '../services/cache/dataCache';

/**
 * Cria um fetcher com contador: cada invocação retorna um valor distinto
 * (`${label}#<n>`), permitindo confirmar que um refetch entregou o valor
 * fresco e não o obsoleto.
 */
function makeCountingFetcher(label: string): {
  fetcher: () => Promise<string>;
  calls: () => number;
} {
  let n = 0;
  return {
    fetcher: async () => {
      n += 1;
      return `${label}#${n}`;
    },
    calls: () => n,
  };
}

describe('Data_Cache — Property 9: invalidação e expiração forçam nova busca', () => {
  beforeEach(() => {
    dataCache.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    dataCache.clear();
  });

  it('expiração (now >= expiresAt) força refetch e retorna valor fresco, não o obsoleto', async () => {
    await fc.assert(
      fc.asyncProperty(
        // chave única por run para isolamento
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('|')),
        fc.integer({ min: 1, max: 100_000 }), // ttlMs
        fc.integer({ min: 0, max: 1_000_000 }), // avanço de tempo extra além do ttl
        async (suffix, ttlMs, extra) => {
          dataCache.clear();
          const key = `ns:exp|${suffix}`;
          const { fetcher, calls } = makeCountingFetcher('exp');

          // Base relativa: a propriedade roda múltiplas vezes dentro do mesmo
          // `it`, então o tempo acumula. Ancoramos cada run no relógio atual
          // para sempre AVANÇAR (nunca voltar) o tempo.
          const base = Date.now();
          const first = await dataCache.getOrFetch(key, fetcher, { ttlMs });
          expect(calls()).toBe(1);
          expect(first).toBe('exp#1');

          // Avança o tempo até/depois de expiresAt (now >= expiresAt).
          // storedAt ≈ base (o tempo não avança durante o await do fetcher),
          // logo expiresAt ≈ base + ttlMs.
          vi.setSystemTime(base + ttlMs + extra);

          const second = await dataCache.getOrFetch(key, fetcher, { ttlMs });
          // Refetch ocorreu: fetcher chamado de novo.
          expect(calls()).toBe(2);
          // Valor fresco, nunca o obsoleto.
          expect(second).toBe('exp#2');
          expect(second).not.toBe(first);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('invalidate(key) força refetch e retorna valor fresco, não o obsoleto', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('|')),
        fc.integer({ min: 1, max: 1_000_000 }), // ttlMs (grande: entrada ainda válida)
        async (suffix, ttlMs) => {
          dataCache.clear();
          const key = `ns:inv|${suffix}`;
          const { fetcher, calls } = makeCountingFetcher('inv');

          const first = await dataCache.getOrFetch(key, fetcher, { ttlMs });
          expect(calls()).toBe(1);

          // Sem invalidação, a entrada ainda é válida (cache hit).
          const cached = await dataCache.getOrFetch(key, fetcher, { ttlMs });
          expect(calls()).toBe(1);
          expect(cached).toBe(first);

          // Invalidação por escrita.
          dataCache.invalidate(key);

          const fresh = await dataCache.getOrFetch(key, fetcher, { ttlMs });
          expect(calls()).toBe(2);
          expect(fresh).toBe('inv#2');
          expect(fresh).not.toBe(first);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('invalidateNamespace(namespace) força refetch das chaves do namespace, retornando valor fresco', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes('|')),
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes('|')),
        fc.integer({ min: 1, max: 1_000_000 }), // ttlMs grande
        async (suffixA, suffixB, ttlMs) => {
          dataCache.clear();
          const namespace = 'ns:bulk';
          // Garante duas chaves distintas dentro do mesmo namespace.
          const keyA = `${namespace}|${suffixA}|a`;
          const keyB = `${namespace}|${suffixB}|b`;
          const fa = makeCountingFetcher('a');
          const fb = makeCountingFetcher('b');

          const a1 = await dataCache.getOrFetch(keyA, fa.fetcher, { ttlMs });
          const b1 = await dataCache.getOrFetch(keyB, fb.fetcher, { ttlMs });
          expect(fa.calls()).toBe(1);
          expect(fb.calls()).toBe(1);

          // Invalidação por namespace (ex.: evento de Realtime_Channel).
          dataCache.invalidateNamespace(namespace);

          const a2 = await dataCache.getOrFetch(keyA, fa.fetcher, { ttlMs });
          const b2 = await dataCache.getOrFetch(keyB, fb.fetcher, { ttlMs });

          // Ambas as chaves do namespace foram invalidadas → refetch em ambas.
          expect(fa.calls()).toBe(2);
          expect(fb.calls()).toBe(2);
          expect(a2).toBe('a#2');
          expect(b2).toBe('b#2');
          expect(a2).not.toBe(a1);
          expect(b2).not.toBe(b1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
