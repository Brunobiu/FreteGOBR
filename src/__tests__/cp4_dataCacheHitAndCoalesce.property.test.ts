/**
 * Feature: startup-performance-optimization
 *
 * Property 7: Cache hit não dispara requisição
 *   Para qualquer chave com um Cache_Entry válido (now < expiresAt), uma
 *   solicitação ao Data_Cache retorna o valor cacheado sem invocar o fetcher
 *   (sem nova requisição de rede), inclusive ao reentrar numa tela após
 *   navegação.
 *
 * Property 8: Coalescência de requisições concorrentes
 *   Para qualquer número de solicitações concorrentes com a mesma chave
 *   enquanto não há Cache_Entry válido, o Data_Cache invoca o fetcher
 *   exatamente uma vez e todas as solicitações resolvem com o mesmo valor.
 *
 * Validates: Requirements 6.1, 6.2, 7.1, 7.2, 7.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { dataCache } from '../services/cache/dataCache';

/** TTL longo o suficiente para que a entrada permaneça válida durante o teste. */
const LONG_TTL_MS = 60_000;

/** Gerador de chaves não vazias (sem fc.stringOf, conforme convenção do projeto). */
const keyArb = fc.string({ minLength: 1, maxLength: 24 });

/** Gerador de valores cacheáveis simples. */
const valueArb = fc.oneof(fc.string({ minLength: 0, maxLength: 32 }), fc.integer(), fc.boolean());

/**
 * Cria um fetcher controlável que conta quantas vezes foi invocado e resolve
 * com o valor fornecido. Permite atrasar a resolução para simular concorrência.
 */
function makeCountingFetcher<T>(value: T, delayMs = 0) {
  let calls = 0;
  const fetcher = (): Promise<T> => {
    calls += 1;
    if (delayMs <= 0) {
      return Promise.resolve(value);
    }
    return new Promise<T>((resolve) => setTimeout(() => resolve(value), delayMs));
  };
  return {
    fetcher,
    get calls() {
      return calls;
    },
  };
}

describe('Data_Cache — Property 7: cache hit não dispara requisição', () => {
  beforeEach(() => {
    dataCache.clear();
  });

  it('com Cache_Entry válido, leituras subsequentes retornam o valor sem reinvocar o fetcher', async () => {
    await fc.assert(
      fc.asyncProperty(
        keyArb,
        valueArb,
        fc.integer({ min: 1, max: 5 }),
        async (key, value, extraReads) => {
          // Isolamento entre runs: cada run parte de um cache limpo.
          dataCache.clear();

          const spy = makeCountingFetcher(value);

          // Primeiro fetch (cache miss): popula a entrada.
          const first = await dataCache.getOrFetch(key, spy.fetcher, { ttlMs: LONG_TTL_MS });
          expect(first).toEqual(value);
          expect(spy.calls).toBe(1);

          // Leituras subsequentes enquanto a entrada é válida: cache hit.
          // Simula reentrar na tela após navegação (mesma chave, entry válido).
          for (let i = 0; i < extraReads; i += 1) {
            const hit = await dataCache.getOrFetch(key, spy.fetcher, { ttlMs: LONG_TTL_MS });
            expect(hit).toEqual(value);
          }

          // Nenhuma chamada adicional ao fetcher após o primeiro fetch.
          expect(spy.calls).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Data_Cache — Property 8: coalescência de requisições concorrentes', () => {
  beforeEach(() => {
    dataCache.clear();
  });

  it('N solicitações concorrentes com a mesma chave invocam o fetcher exatamente uma vez', async () => {
    await fc.assert(
      fc.asyncProperty(
        keyArb,
        valueArb,
        fc.integer({ min: 2, max: 12 }),
        async (key, value, concurrency) => {
          // Isolamento entre runs.
          dataCache.clear();

          // delay garante que todas as solicitações disparam enquanto a
          // requisição ainda está em voo (nenhum Cache_Entry válido ainda).
          const spy = makeCountingFetcher(value, 5);

          const results = await Promise.all(
            Array.from({ length: concurrency }, () =>
              dataCache.getOrFetch(key, spy.fetcher, { ttlMs: LONG_TTL_MS })
            )
          );

          // Fetcher invocado exatamente uma vez (coalescência).
          expect(spy.calls).toBe(1);

          // Todas as solicitações resolvem com o mesmo valor.
          for (const r of results) {
            expect(r).toEqual(value);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
