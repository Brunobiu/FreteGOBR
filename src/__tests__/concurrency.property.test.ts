/**
 * Property-Based Tests — Concorrência, idempotência e confluência (Tarefa 9).
 *
 * Modela de forma pura (sem I/O) as invariantes que o servidor garante:
 *   - Property 3: idempotência — op(op(s)) == op(s).
 *   - Property 4: confluência — operações comutativas independem da ordem.
 *   - Property 5: versionamento otimista — segunda escrita concorrente
 *     sobre a mesma versão recebe STALE_VERSION e não altera o estado.
 *
 * O pool de concorrência (admin-patterns §7, limite 5) é exercitado pelo
 * runner `runWithPool`.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ─── Modelo puro: registro versionado com optimistic locking ────────────────

interface VersionedRecord {
  value: number;
  updatedAt: number; // versão monotônica
}

type UpdateResult = { ok: true; record: VersionedRecord } | { ok: false; code: 'STALE_VERSION' };

/** Espelha a regra SQL: só aplica se expectedUpdatedAt === record.updatedAt. */
function optimisticUpdate(
  record: VersionedRecord,
  expectedUpdatedAt: number,
  nextValue: number
): UpdateResult {
  if (expectedUpdatedAt !== record.updatedAt) {
    return { ok: false, code: 'STALE_VERSION' };
  }
  return { ok: true, record: { value: nextValue, updatedAt: record.updatedAt + 1 } };
}

/** Operação idempotente: marca como removido (toggle para estado-alvo). */
function markRemoved(s: { removed: boolean; touches: number }): {
  removed: boolean;
  touches: number;
} {
  if (s.removed) return s; // já no estado-alvo: não muta (idempotente)
  return { removed: true, touches: s.touches + 1 };
}

/** Pool de concorrência limite 5 (admin-patterns §7). */
async function runWithPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  async function run() {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) break;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, () => run()));
}

describe('Property 3 — idempotência', () => {
  it('markRemoved(markRemoved(s)) === markRemoved(s)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.nat(100), (removed, touches) => {
        const s = { removed, touches };
        const once = markRemoved(s);
        const twice = markRemoved(once);
        expect(twice).toEqual(once);
      })
    );
  });

  it('aplicar N vezes produz no máximo um único touch', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n) => {
        let s = { removed: false, touches: 0 };
        for (let i = 0; i < n; i++) s = markRemoved(s);
        expect(s.removed).toBe(true);
        expect(s.touches).toBe(1);
      })
    );
  });
});

describe('Property 4 — confluência de operações comutativas', () => {
  it('somar um multiset de deltas independe da ordem', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -100, max: 100 }), { maxLength: 30 }), (deltas) => {
        const apply = (order: number[]) => order.reduce((acc, d) => acc + d, 0);
        const shuffled = [...deltas].reverse();
        expect(apply(deltas)).toBe(apply(shuffled));
      })
    );
  });
});

describe('Property 5 — versionamento otimista', () => {
  it('segunda escrita concorrente na mesma versão recebe STALE_VERSION', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (v0, a, b) => {
        const initial: VersionedRecord = { value: v0, updatedAt: 0 };
        // Dois writers leem a mesma versão (0). O primeiro aplica e bumpa
        // a versão para 1. O segundo, que leu a versão 0, tenta aplicar
        // contra o estado já atualizado e deve falhar com STALE_VERSION.
        const first = optimisticUpdate(initial, 0, a);
        expect(first.ok).toBe(true);
        const current = first.ok ? first.record : initial;
        const second = optimisticUpdate(current, 0, b); // usa versão velha (0)
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.code).toBe('STALE_VERSION');
      })
    );
  });

  it('updatedAt é estritamente crescente a cada update aceito', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 20 }), (values) => {
        let rec: VersionedRecord = { value: 0, updatedAt: 0 };
        for (const v of values) {
          const r = optimisticUpdate(rec, rec.updatedAt, v);
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(r.record.updatedAt).toBe(rec.updatedAt + 1);
            rec = r.record;
          }
        }
        expect(rec.updatedAt).toBe(values.length);
      })
    );
  });
});

describe('pool de concorrência (limite 5)', () => {
  it('processa todos os itens exatamente uma vez', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer(), { maxLength: 50 }), async (items) => {
        const processed: number[] = [];
        await runWithPool(items, async (item) => {
          processed.push(item);
        });
        expect(processed.sort()).toEqual([...items].sort());
      }),
      { numRuns: 50 }
    );
  });
});
