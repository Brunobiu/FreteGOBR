// Feature: admin-assistant, Property 24: deduplicação idempotente por dedup_key
/**
 * CP-24 — Deduplicação idempotente de Critical_Events (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 24
 *   - requirements.md §Padrões de Sucesso (CP-24) e Requirement 12.7
 *
 * Função sob teste:
 *   dedupNewEvents(already, batch)  (src/services/admin/assistant.ts)
 *
 * Invariantes verificadas para QUALQUER (already, batch) arbitrário:
 *
 *   1. Nunca retorna `dedupKey` já presente em `already` (regra principal —
 *      Req 12.7: dedup contra o conjunto de já notificados).
 *   2. Idempotência: aplicar a função sobre o seu próprio resultado produz o
 *      mesmo array — `dedupNewEvents(already, dedupNewEvents(already, batch))
 *      === dedupNewEvents(already, batch)`.
 *   3. Pureza: não muta `already` nem `batch` (Set/array de entrada inalterados).
 *   4. Cada `dedupKey` aparece NO MÁXIMO uma vez no resultado (colisões
 *      internas ao próprio lote são removidas, mantendo a primeira ocorrência).
 *   5. Ordem: o resultado é uma SUBSEQUÊNCIA do `batch` original (preserva a
 *      ordem relativa das primeiras ocorrências de cada chave nova).
 *
 * Convenções de PBT do projeto:
 *   - Pool pequeno de `dedupKey` (`fc.constantFrom`) para forçar colisões com
 *     `already` e dentro do próprio lote em alta frequência.
 *   - Domínios fechados de `CriticalEventType` e `Severity` via `fc.constantFrom`.
 *
 * Lógica determinística (sem Supabase, sem rede). Ambiente jsdom.
 *
 * Validates: Requirements 12.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  dedupNewEvents,
  type CriticalEventType,
  type DedupCandidate,
  type DetectedEvent,
  type Severity,
} from '../../../services/admin/assistant';

// ----- Geradores (domínios fechados + pool pequeno de dedupKey) -----

const eventTypeArb = fc.constantFrom<CriticalEventType>(
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop'
);

const severityArb = fc.constantFrom<Severity>('info', 'warning', 'critical');

const detectedEventArb: fc.Arbitrary<DetectedEvent> = fc.record({
  type: eventTypeArb,
  severity: severityArb,
  summary: fc.string({ minLength: 0, maxLength: 60 }),
  scope: fc.string({ minLength: 0, maxLength: 30 }),
});

// Pool intencionalmente pequeno: garante MUITAS colisões — entre `already` e
// o lote, e dentro do próprio lote — para exercitar a invariante de dedup.
const KEY_POOL = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'] as const;
const dedupKeyArb = fc.constantFrom<(typeof KEY_POOL)[number]>(...KEY_POOL);

const candidateArb: fc.Arbitrary<DedupCandidate> = fc.record({
  event: detectedEventArb,
  dedupKey: dedupKeyArb,
});

const batchArb = fc.array(candidateArb, { maxLength: 16 });

const alreadyArb = fc.array(dedupKeyArb, { maxLength: 8 }).map((arr) => new Set<string>(arr));

describe('CP-24: dedupNewEvents — idempotência e dedup contra already (Req 12.7)', () => {
  it('nunca emite dedupKey já em `already`', () => {
    fc.assert(
      fc.property(alreadyArb, batchArb, (already, batch) => {
        const out = dedupNewEvents(already, batch);
        for (const item of out) {
          expect(already.has(item.dedupKey)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('dedupKey aparece no máximo uma vez no resultado (dedup interno ao lote)', () => {
    fc.assert(
      fc.property(alreadyArb, batchArb, (already, batch) => {
        const out = dedupNewEvents(already, batch);
        const keys = out.map((c) => c.dedupKey);
        const unique = new Set(keys);
        expect(keys.length).toBe(unique.size);
      }),
      { numRuns: 100 }
    );
  });

  it('idempotência: dedup(already, dedup(already, batch)) === dedup(already, batch)', () => {
    fc.assert(
      fc.property(alreadyArb, batchArb, (already, batch) => {
        const once = dedupNewEvents(already, batch);
        const twice = dedupNewEvents(already, once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 }
    );
  });

  it('pureza: não muta `already` nem `batch`', () => {
    fc.assert(
      fc.property(alreadyArb, batchArb, (already, batch) => {
        const alreadyBefore = Array.from(already).sort();
        const batchSnapshot = batch.map((c) => ({ ...c }));

        dedupNewEvents(already, batch);

        // `already` (Set) preservado.
        expect(Array.from(already).sort()).toEqual(alreadyBefore);
        // `batch` (Array) preservado em comprimento e nos itens (referência por
        // referência: o helper não pode trocar a ordem nem os elementos).
        expect(batch.length).toBe(batchSnapshot.length);
        for (let i = 0; i < batch.length; i++) {
          expect(batch[i].dedupKey).toBe(batchSnapshot[i].dedupKey);
          expect(batch[i].event).toBe(batchSnapshot[i].event);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('preserva ordem: resultado é subsequência das primeiras ocorrências de cada chave nova', () => {
    fc.assert(
      fc.property(alreadyArb, batchArb, (already, batch) => {
        const out = dedupNewEvents(already, batch);

        // Modelo de referência: simula o algoritmo esperado para validar ordem.
        const seen = new Set<string>(already);
        const expected: DedupCandidate[] = [];
        for (const item of batch) {
          if (!seen.has(item.dedupKey)) {
            seen.add(item.dedupKey);
            expected.push(item);
          }
        }
        expect(out).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });
});
