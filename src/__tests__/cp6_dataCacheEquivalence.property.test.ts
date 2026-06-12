/**
 * Property-Based Tests — Equivalência e idempotência de leitura do Data_Cache.
 *
 * Feature: startup-performance-optimization
 * Property 10: Equivalência e idempotência de leitura.
 *   Para qualquer valor produzido pelo fetcher (a fonte), uma solicitação em
 *   cache miss retorna um valor equivalente ao que a Supabase_Query retornaria
 *   diretamente; e leituras repetidas de um Cache_Entry válido retornam SEMPRE
 *   o mesmo valor.
 *
 * Validates: Requirements 6.5, 13.2
 */

import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { dataCache } from '../services/cache/dataCache';

// ─── Geradores ───────────────────────────────────────────────────────────────
// Valores estruturados (objetos/arrays/primitivos). NÃO usar fc.stringOf.

/** Primitivos JSON-safe. */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ minLength: 0, maxLength: 20 }),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null)
);

/** Valor arbitrário: primitivo, array ou objeto (profundidade limitada). */
const valueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    primitiveArb,
    fc.array(tie('node'), { maxLength: 5 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('node'), { maxKeys: 5 })
  ),
})).node;

/** Chave de cache estável no formato namespace|params. */
const keyArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((suffix) => `equiv:test|${suffix}`);

// ─── Isolamento entre runs ─────────────────────────────────────────────────────

afterEach(() => {
  dataCache.clear();
});

const TTL_MS = 60_000; // suficientemente longo para a entrada permanecer válida

describe('Data_Cache — Property 10: equivalência e idempotência de leitura', () => {
  it('cache miss retorna valor equivalente ao produzido pela fonte (fetcher)', async () => {
    await fc.assert(
      fc.asyncProperty(keyArb, valueArb, async (key, sourceValue) => {
        // Isolamento: garante cache miss para esta chave.
        dataCache.invalidate(key);

        let fetcherCalls = 0;
        const fetcher = async (): Promise<unknown> => {
          fetcherCalls += 1;
          return sourceValue;
        };

        const cached = await dataCache.getOrFetch(key, fetcher, { ttlMs: TTL_MS });

        // Equivalência: o valor servido em cache miss é deep-equal ao da fonte.
        expect(cached).toStrictEqual(sourceValue);
        // Em cache miss, o fetcher (a fonte) é invocado exatamente uma vez.
        expect(fetcherCalls).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it('leituras repetidas de um Cache_Entry válido retornam sempre o mesmo valor', async () => {
    await fc.assert(
      fc.asyncProperty(
        keyArb,
        valueArb,
        fc.integer({ min: 2, max: 8 }),
        async (key, sourceValue, repeats) => {
          dataCache.invalidate(key);

          let fetcherCalls = 0;
          const fetcher = async (): Promise<unknown> => {
            fetcherCalls += 1;
            // Se o fetcher fosse chamado de novo, retornaria valor diferente;
            // isso provaria que a leitura NÃO veio do Cache_Entry.
            return fetcherCalls === 1 ? sourceValue : { __unexpectedRefetch: fetcherCalls };
          };

          // Primeira leitura popula o cache (miss).
          const first = await dataCache.getOrFetch(key, fetcher, { ttlMs: TTL_MS });
          expect(first).toStrictEqual(sourceValue);

          // Idempotência: leituras subsequentes do entry válido retornam o
          // mesmo valor, sem reinvocar o fetcher.
          for (let i = 0; i < repeats; i += 1) {
            const again = await dataCache.getOrFetch(key, fetcher, { ttlMs: TTL_MS });
            expect(again).toStrictEqual(sourceValue);
            expect(again).toStrictEqual(first);
          }

          expect(fetcherCalls).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
