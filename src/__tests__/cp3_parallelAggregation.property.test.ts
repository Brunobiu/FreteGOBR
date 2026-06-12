/**
 * Property-Based Tests — startup-performance-optimization
 *
 * Feature: startup-performance-optimization
 *
 * Property 5: Falhas parciais não bloqueiam sucessos
 *   Para qualquer conjunto de Supabase_Query independentes executadas em
 *   paralelo com um subconjunto arbitrário de falhas, todo resultado
 *   bem-sucedido deve ser processado e exposto, e nenhuma falha de um
 *   subconjunto deve impedir a entrega dos demais resultados.
 *   Validates: Requirements 4.3, 3.6
 *
 * Property 6: Independência de ordem do estado agregado
 *   Para qualquer conjunto de resultados de Supabase_Query independentes,
 *   o estado final agregado é o mesmo independentemente da ordem em que as
 *   requisições são resolvidas (equivalente ao Behavior_Baseline).
 *   Validates: Requirements 4.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { aggregateSettled, type SettledBlocks } from '../utils/aggregateSettled';

/**
 * Descrição de um bloco a ser executado em paralelo:
 * - `shouldFail`: se a promise deve rejeitar (falha) ou resolver (sucesso).
 * - `value`: valor de resolução (quando sucesso).
 * - `delay`: atraso (ms) antes de resolver/rejeitar — usado para variar a
 *   ordem temporal de resolução das promises.
 */
interface BlockSpec {
  shouldFail: boolean;
  value: unknown;
  delay: number;
}

// Pool fixo de chaves (garante unicidade ao usar fc.dictionary e evita
// geração de strings arbitrárias / fc.stringOf, proibido no projeto).
const KEY_POOL = [
  'fretes',
  'likes',
  'calcContext',
  'publicProfile',
  'notifications',
  'counters',
  'stats',
  'images',
] as const;

// Valor serializável arbitrário (sem fc.stringOf).
const valueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.string({ minLength: 0, maxLength: 12 }).filter((s) => !s.includes('\u0000')),
  fc.constant(null),
  fc.record({ id: fc.integer(), tag: fc.constantFrom('a', 'b', 'c') })
);

const blockSpecArb: fc.Arbitrary<BlockSpec> = fc.record({
  shouldFail: fc.boolean(),
  value: valueArb,
  delay: fc.integer({ min: 0, max: 25 }),
});

// Mapa de chave → spec. fc.dictionary com chaves de um pool fixo garante
// chaves únicas automaticamente.
const blocksSpecArb: fc.Arbitrary<Record<string, BlockSpec>> = fc.dictionary(
  fc.constantFrom(...KEY_POOL),
  blockSpecArb,
  { minKeys: 1, maxKeys: KEY_POOL.length }
);

/** Erro determinístico por chave, para comparar reasons de forma estável. */
function failureReasonFor(key: string): Error {
  return new Error(`BLOCK_FAILED:${key}`);
}

/** Constrói o mapa de blocos (funções) a partir das specs. */
function buildBlocks(spec: Record<string, BlockSpec>): SettledBlocks {
  const blocks: SettledBlocks = {};
  for (const key of Object.keys(spec)) {
    const { shouldFail, value, delay } = spec[key];
    blocks[key] = () =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          if (shouldFail) reject(failureReasonFor(key));
          else resolve(value);
        }, delay);
      });
  }
  return blocks;
}

describe('cp3 parallel aggregation — Property 5 e 6', () => {
  it('Property 5: falhas parciais não bloqueiam sucessos; a função nunca rejeita', async () => {
    await fc.assert(
      fc.asyncProperty(blocksSpecArb, async (spec) => {
        const keys = Object.keys(spec);

        // aggregateSettled NUNCA deve rejeitar, mesmo com falhas parciais.
        const result = await aggregateSettled(buildBlocks(spec));

        for (const key of keys) {
          if (spec[key].shouldFail) {
            // Falha vai para errors e NÃO para values.
            expect(key in result.errors).toBe(true);
            expect(key in result.values).toBe(false);
            expect(result.errors[key]).toEqual(failureReasonFor(key));
          } else {
            // Sucesso é entregue em values, independente de outras falhas.
            expect(key in result.values).toBe(true);
            expect(key in result.errors).toBe(false);
            expect(result.values[key]).toEqual(spec[key].value);
          }
        }

        // Toda chave aparece em exatamente um dos mapas.
        const valueKeys = Object.keys(result.values);
        const errorKeys = Object.keys(result.errors);
        expect(new Set([...valueKeys, ...errorKeys])).toEqual(new Set(keys));
        expect(valueKeys.some((k) => errorKeys.includes(k))).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 6: o estado agregado é o mesmo independentemente da ordem de resolução', async () => {
    await fc.assert(
      fc.asyncProperty(blocksSpecArb, async (spec) => {
        const keys = Object.keys(spec);

        // Resultado esperado: derivado puramente do mapeamento sucesso/falha,
        // sem qualquer dependência dos delays (ordem temporal).
        const expectedValues: Record<string, unknown> = {};
        const expectedErrors: Record<string, unknown> = {};
        for (const key of keys) {
          if (spec[key].shouldFail) expectedErrors[key] = failureReasonFor(key);
          else expectedValues[key] = spec[key].value;
        }

        // Execução real com delays arbitrários (ordem de resolução variável).
        const result = await aggregateSettled(buildBlocks(spec));

        // O agregado por chave deve ser idêntico ao esperado, independente
        // dos delays atribuídos a cada bloco.
        expect(result.values).toEqual(expectedValues);
        expect(result.errors).toEqual(expectedErrors);
      }),
      { numRuns: 100 }
    );
  });
});
