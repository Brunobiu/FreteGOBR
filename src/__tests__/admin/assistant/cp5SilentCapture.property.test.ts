// Feature: admin-assistant, Property 5
/**
 * CP-5: Captura e silenciosa, nao lança e nao reentra
 *
 * Para qualquer entrada de captura e qualquer sink que LANÇA excecao:
 *  - `captureError` nunca propaga excecao a aplicacao;
 *  - `flush` nunca propaga excecao a aplicacao (engole tudo — Req 3.8);
 *  - o sink nunca e invocado de forma reentrante: o guard global de
 *    reentrancia neutraliza qualquer tentativa de re-captura disparada
 *    durante o envio que falha, impedindo o laço de recursao.
 *
 * O sink (`ingestErrorLogs` -> `supabase.rpc(...)`) e mockado para SEMPRE
 * lançar. Exposto via `(globalThis as Record<string, unknown>).__ingestSpy`,
 * conforme as convencoes de PBT do projeto. Durante a execucao do sink, ele
 * tenta re-capturar (simulando um `console.error` emitido pela propria falha de
 * envio); o guard deve transformar essa re-captura em no-op.
 *
 * Validates: Requirements 3.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock hoist-safe do client unico: o sink SEMPRE lança. A profundidade de
// execucao e rastreada para detectar invocacao reentrante (depth > 1). Durante
// o envio, o sink chama um callback (lido de globalThis em tempo de execucao,
// sem referenciar variaveis externas no factory) que tenta re-capturar.
vi.mock('../../../services/supabase', () => {
  const g = globalThis as Record<string, unknown>;
  let depth = 0;
  const ingestSpy = vi.fn(async () => {
    depth += 1;
    if (depth > 1) {
      // Invocacao reentrante do sink: violacao do guard.
      g.__cp5Reentrant = true;
    }
    try {
      const reenter = g.__cp5Reenter as undefined | (() => void);
      if (typeof reenter === 'function') reenter();
      throw new Error('sink boom: ingest sempre falha');
    } finally {
      depth -= 1;
    }
  });
  g.__ingestSpy = ingestSpy;
  return { supabase: { rpc: ingestSpy } };
});

import {
  captureError,
  flush,
  buildErrorDraft,
  ERROR_TYPES,
  type ErrorType,
  type ErrorLogDraft,
} from '../../../services/admin/errorCapture';

// Handle do spy exposto pelo mock hoisted.
const ingestSpy = (globalThis as Record<string, unknown>).__ingestSpy as ReturnType<typeof vi.fn>;

// ----- Geradores -----

const errorTypeGen = fc.constantFrom<ErrorType>(...ERROR_TYPES);

const draftGen: fc.Arbitrary<ErrorLogDraft> = fc
  .record({
    errorType: errorTypeGen,
    message: fc.string({ minLength: 0, maxLength: 20 }),
  })
  .map((r) => buildErrorDraft({ errorType: r.errorType, message: r.message }));

// Sequencias pequenas: com maxBatchSize default (20), poucos flushes drenam.
const capturesGen = fc.array(draftGen, { minLength: 0, maxLength: 30 });

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  g.__cp5Reentrant = false;
  // Durante o envio que falha, o sink tenta re-capturar (simula console.error
  // disparado pela propria falha). O guard de reentrancia deve neutralizar.
  g.__cp5Reenter = () => {
    captureError(buildErrorDraft({ errorType: 'console_error', message: 'falha de envio' }));
  };
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__cp5Reenter;
  delete g.__cp5Reentrant;
});

describe('CP-5: captura silenciosa, sem throw, sem reentrancia', () => {
  it('captureError/flush nunca propagam excecao e o sink nunca e reentrante', async () => {
    await fc.assert(
      fc.asyncProperty(capturesGen, async (drafts) => {
        ingestSpy.mockClear();
        (globalThis as Record<string, unknown>).__cp5Reentrant = false;

        // captureError nunca lança, mesmo em sequencia (Req 3.8).
        for (const d of drafts) {
          expect(() => captureError(d)).not.toThrow();
        }

        // flush nunca propaga, mesmo com o sink sempre lançando. Drena em
        // multiplas chamadas ate a fila esvaziar (lotes de maxBatchSize).
        for (let i = 0; i < 5; i++) {
          await expect(flush()).resolves.toBeUndefined();
        }

        // Apos drenar, chamadas extras de flush nao geram novos envios: a fila
        // esta vazia e o guard impediu que o sink reabastecesse a fila durante
        // o envio (sem laço de recursao).
        const callsAfterDrain = ingestSpy.mock.calls.length;
        await expect(flush()).resolves.toBeUndefined();
        await expect(flush()).resolves.toBeUndefined();
        expect(ingestSpy.mock.calls.length).toBe(callsAfterDrain);

        // O sink nunca foi invocado de forma reentrante.
        expect((globalThis as Record<string, unknown>).__cp5Reentrant).not.toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
