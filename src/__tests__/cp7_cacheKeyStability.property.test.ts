/**
 * Property-Based Tests — Estabilidade da chave de cache (Tarefa 1.2).
 *
 * Feature: startup-performance-optimization, Property 11: Chave de cache estável
 * e independente da ordem dos parâmetros.
 *
 * Para qualquer par de conjuntos de parâmetros semanticamente equivalentes
 * (mesmas propriedades e valores, em qualquer ordem), `deriveKey` produz a mesma
 * chave; e parâmetros que diferem em qualquer valor produzem chaves diferentes.
 *
 * Validates: Requirements 6.1, 6.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveKey } from '../services/cache/cacheKey';

// Namespaces fixos do projeto (convenção: fc.constantFrom para dados estruturados).
const namespaceArb = () =>
  fc.constantFrom(
    'fretes:active',
    'motorista:calcContext',
    'likes:idsByUser',
    'community:publicProfile'
  );

// Chaves de objeto que NÃO se parecem com índices inteiros, para que a ordem de
// inserção (e portanto a reordenação no teste) seja realmente significativa em
// JS (chaves "0", "1"... seriam reordenadas numericamente pelo engine).
// Não usar fc.stringOf — usar fc.string({...}) com prefixo não numérico.
const keyArb = () => fc.string({ minLength: 0, maxLength: 6 }).map((s) => `k_${s}`);

// Valor de parâmetro recursivo: strings, números, booleanos, null, arrays e
// objetos aninhados. Cobre o espaço de entradas realista de params de cache.
const valueArb = () =>
  fc.letrec((tie) => ({
    value: fc.oneof(
      { maxDepth: 3, depthSize: 'small' },
      fc.string({ maxLength: 8 }),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
      fc.constant(null),
      fc.array(tie('value'), { maxLength: 3 }),
      fc.dictionary(keyArb(), tie('value'), { maxKeys: 4 })
    ),
  })).value;

// Objeto de parâmetros (sempre um objeto plano no topo).
const paramObjectArb = (opts?: { minKeys?: number }) =>
  fc.dictionary(keyArb(), valueArb(), { minKeys: opts?.minKeys ?? 0, maxKeys: 5 });

/**
 * Recria um valor reordenando recursivamente as chaves de todos os objetos
 * (ordem invertida). Mantém a semântica (mesmas propriedades/valores), mudando
 * apenas a ordem de inserção — exatamente o que `deriveKey` deve ignorar.
 */
function reorderKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reorderKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const reversedKeys = Object.keys(record).reverse();
    const out: Record<string, unknown> = {};
    for (const k of reversedKeys) {
      out[k] = reorderKeysDeep(record[k]);
    }
    return out;
  }
  return value;
}

describe('Property 11 — chave de cache estável e independente da ordem', () => {
  it('(a) params semanticamente equivalentes (chaves em qualquer ordem) ⇒ MESMA chave', () => {
    fc.assert(
      fc.property(namespaceArb(), paramObjectArb(), (namespace, params) => {
        const reordered = reorderKeysDeep(params);
        expect(deriveKey(namespace, reordered)).toBe(deriveKey(namespace, params));
      }),
      { numRuns: 200 }
    );
  });

  it('(b) params que diferem em qualquer valor ⇒ chaves DIFERENTES', () => {
    fc.assert(
      fc.property(
        namespaceArb(),
        paramObjectArb({ minKeys: 1 }),
        fc.nat(),
        (namespace, params, pick) => {
          const keys = Object.keys(params);
          const targetKey = keys[pick % keys.length];
          const original = params[targetKey];

          // Mutação garantidamente distinta em forma canônica: para qualquer
          // valor `v`, canonicalize([v, v]) = `[c,c]` nunca é igual a
          // canonicalize(v) = `c` (comprimento estritamente maior). Logo o
          // objeto resultante difere semanticamente e a chave deve mudar.
          const mutated: Record<string, unknown> = {
            ...params,
            [targetKey]: [original, original],
          };

          expect(deriveKey(namespace, mutated)).not.toBe(deriveKey(namespace, params));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('(b) distinção por tipo: valores de tipos diferentes ⇒ chaves diferentes', () => {
    fc.assert(
      fc.property(
        namespaceArb(),
        // Pares de valores type-distinct que NÃO podem colidir em chave.
        fc.constantFrom(
          [1, '1'],
          [null, 'null'],
          [true, 'true'],
          [false, 'false'],
          [0, false],
          [0, null],
          [1, true],
          ['', null]
        ),
        (namespace, [a, b]) => {
          expect(deriveKey(namespace, a)).not.toBe(deriveKey(namespace, b));
        }
      ),
      { numRuns: 100 }
    );
  });
});
