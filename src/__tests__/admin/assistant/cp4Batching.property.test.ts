// Feature: admin-assistant, Property 4
/**
 * CP-4: Batching e throttling respeitam os limites
 *
 * Para qualquer sequencia finita de capturas de erro e qualquer configuracao
 * valida (`maxBatchSize`, `maxQueue`):
 *  - nenhum lote enviado excede `maxBatchSize`;
 *  - a fila nunca retem mais que `maxQueue` itens (excedentes descartados em
 *    silencio) — verificado pelo total efetivamente enviado;
 *  - o total enviado e menor ou igual ao total enfileirado.
 *
 * O sink real (`ingestErrorLogs` -> `supabase.rpc(ERROR_INGEST_RPC, ...)`) e
 * mockado para "enviar" para um contador (spy `vi.fn`) exposto via globalThis,
 * conforme as convencoes de PBT do projeto. `vi.useFakeTimers()` dirige o timer
 * de flush (throttle) com `vi.advanceTimersByTimeAsync`.
 *
 * Validates: Requirements 3.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock hoist-safe do client unico: o sink de flush vira um contador.
// Factory sem variaveis externas; spy exposto via globalThis (convencao).
vi.mock('../../../services/supabase', () => {
  const ingestSpy = vi.fn(async () => ({
    data: { inserted: 0, rejected: 0, throttled: false },
    error: null,
  }));
  (globalThis as Record<string, unknown>).__cp4IngestSpy = ingestSpy;
  return { supabase: { rpc: ingestSpy } };
});

import {
  installGlobalErrorCapture,
  captureError,
  buildErrorDraft,
  ERROR_TYPES,
  type ErrorType,
  type ErrorLogDraft,
} from '../../../services/admin/errorCapture';

// Handle do spy exposto pelo mock hoisted.
const ingestSpy = (globalThis as Record<string, unknown>).__cp4IngestSpy as ReturnType<
  typeof vi.fn
>;

// Intervalo de flush fixo; com fake timers, cada avanco de FLUSH_MS dispara um
// unico tick do timer (um flush => no maximo um lote).
const FLUSH_MS = 1000;

// ----- Geradores -----

const errorTypeGen = fc.constantFrom<ErrorType>(...ERROR_TYPES);

// Draft valido derivado de uma entrada bruta (buildErrorDraft e puro/seguro).
const draftGen: fc.Arbitrary<ErrorLogDraft> = fc
  .record({
    errorType: errorTypeGen,
    message: fc.string({ minLength: 0, maxLength: 20 }),
  })
  .map((r) => buildErrorDraft({ errorType: r.errorType, message: r.message }));

// Configuracao valida: maxBatchSize e maxQueue inteiros >= 1.
const configGen = fc.record({
  maxBatchSize: fc.integer({ min: 1, max: 15 }),
  maxQueue: fc.integer({ min: 1, max: 25 }),
});

const capturesGen = fc.array(draftGen, { minLength: 0, maxLength: 40 });

beforeEach(() => {
  vi.useFakeTimers();
  // O wrapper de fetch da instalacao faz `win.fetch.bind(win)`; garante que
  // window.fetch exista no ambiente jsdom para nao lançar na instalacao.
  const w = (globalThis as { window?: { fetch?: unknown } }).window;
  if (w && typeof w.fetch !== 'function') {
    w.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CP-4: batching/throttling respeitam os limites', () => {
  it('nenhum lote excede maxBatchSize; total enviado = min(total, maxQueue) <= total', async () => {
    await fc.assert(
      fc.asyncProperty(capturesGen, configGen, async (drafts, cfg) => {
        ingestSpy.mockClear();

        const teardown = installGlobalErrorCapture({
          maxBatchSize: cfg.maxBatchSize,
          maxQueue: cfg.maxQueue,
          flushIntervalMs: FLUSH_MS,
        });

        try {
          // Enfileira toda a sequencia (sincrono; nenhum flush ocorre ainda
          // porque os timers fake nao foram avancados).
          for (const d of drafts) {
            captureError(d);
          }

          // Excedente alem de maxQueue e descartado em silencio.
          const retained = Math.min(drafts.length, cfg.maxQueue);
          const expectedBatches = Math.ceil(retained / cfg.maxBatchSize);

          // Dirige o timer de flush ate drenar tudo (com folga).
          for (let i = 0; i < expectedBatches + 2; i++) {
            await vi.advanceTimersByTimeAsync(FLUSH_MS);
          }

          const calls = ingestSpy.mock.calls;
          let totalSent = 0;
          for (const call of calls) {
            const args = call[1] as { p_batch: unknown[] };
            const batchLen = args.p_batch.length;
            // Nenhum lote vazio e enviado, e nenhum excede maxBatchSize.
            expect(batchLen).toBeGreaterThan(0);
            expect(batchLen).toBeLessThanOrEqual(cfg.maxBatchSize);
            totalSent += batchLen;
          }

          // Total enviado = itens retidos (cap maxQueue aplicado) e <= total.
          expect(totalSent).toBe(retained);
          expect(totalSent).toBeLessThanOrEqual(drafts.length);
        } finally {
          teardown();
        }
      }),
      { numRuns: 100 }
    );
  });
});
