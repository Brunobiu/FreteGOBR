// Feature: whatsapp-automation, Property 6: A quota nunca é excedida por execução
/**
 * Property-Based Tests — Quota por execução do Job_Worker durável (Req 8.5, 8.7)
 *
 * Property 6: para todo Dispatch_Job com `Execution_Quota = q` e para toda
 * execução do worker (`tickWorker`), o número de mensagens efetivamente ENVIADAS
 * (`SENT`) naquela execução é ≤ q. Se restam destinatários `PENDING` ao atingir q,
 * a execução termina com o job em `PAUSED`; caso contrário, o job termina em
 * `COMPLETED`. Falhas de envio (`shouldFail`) NÃO contam para a quota — apenas os
 * `SENT` contam.
 *
 * O modelo em memória (`_model/store.ts`) é exercitado com o pacing desativado
 * (sem `opts.now`), isolando a propriedade da quota: a única razão para a execução
 * parar deixando `PENDING` é a quota ter sido atingida.
 *
 * Validates: Requirements 8.5, 8.7
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createInitialState,
  createInstance,
  addDispatchJob,
  tickWorker,
  resumeJob,
  getJob,
  type DispatchRecipient,
} from './_model/store';

const INSTANCE_ID = 'inst-quota';
const JOB_ID = 'job-quota';

const modeArb = fc.constantFrom('BLOCK' as const, 'INTERLEAVED' as const);

/**
 * Cenário: total de destinatários, quota por execução e uma máscara
 * determinística de falhas (uma posição por `seq`). A máscara tem exatamente
 * `total` posições para casar com os recipients gerados.
 */
const scenarioArb = fc.integer({ min: 1, max: 40 }).chain((total) =>
  fc.record({
    total: fc.constant(total),
    quota: fc.integer({ min: 1, max: 40 }),
    failMask: fc.array(fc.boolean(), { minLength: total, maxLength: total }),
  })
);

/** Monta o estado com a instância e um job `QUEUED` com `total` recipients. */
function setupJob(total: number, quota: number, mode: 'BLOCK' | 'INTERLEAVED') {
  let state = createInstance(createInitialState(), { instanceId: INSTANCE_ID });
  const recipients = Array.from({ length: total }, (_unused, i) => ({
    phone: `+551199000${String(i).padStart(4, '0')}`,
  }));
  state = addDispatchJob(state, INSTANCE_ID, {
    jobId: JOB_ID,
    recipients,
    contentIds: ['c0', 'c1'],
    mode,
    blockSize: 1,
    sendIntervalSec: 1,
    executionQuota: quota,
  });
  return state;
}

describe('tickWorker — Property 6 (quota por execução)', () => {
  it('uma execução nunca envia mais que a quota e termina PAUSED/COMPLETED corretamente', () => {
    fc.assert(
      fc.property(scenarioArb, modeArb, ({ total, quota, failMask }, mode) => {
        const state = setupJob(total, quota, mode);
        const shouldFail = (r: DispatchRecipient) => failMask[r.seq] ?? false;

        const tick = tickWorker(state, INSTANCE_ID, JOB_ID, { shouldFail });
        const job = getJob(tick.state, INSTANCE_ID, JOB_ID);

        // O job sempre existe após o tick.
        expect(job).toBeDefined();
        if (!job) {
          return;
        }

        // (Req 8.5) Nunca enviar mais que a quota nesta execução.
        expect(tick.sentThisExecution).toBeLessThanOrEqual(quota);
        // O contador da execução deve casar com os envios efetivos do job.
        expect(tick.sentThisExecution).toBe(job.sentCount);

        // Pendentes restantes = total - enviados - falhados (sem skipped aqui).
        const remaining = job.totalCount - job.sentCount - job.failedCount;
        expect(remaining).toBeGreaterThanOrEqual(0);

        if (remaining > 0) {
          // (Req 8.7) Restam PENDING ⇒ parou por quota ⇒ PAUSED e enviou exatamente q.
          expect(job.status).toBe('PAUSED');
          expect(tick.sentThisExecution).toBe(quota);
        } else {
          // Tudo processado (SENT ou FAILED) ⇒ COMPLETED.
          expect(job.status).toBe('COMPLETED');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('continuar (resume) drena os PENDING restantes respeitando a quota a cada execução até COMPLETED', () => {
    fc.assert(
      fc.property(scenarioArb, modeArb, ({ total, quota, failMask }, mode) => {
        const shouldFail = (r: DispatchRecipient) => failMask[r.seq] ?? false;
        let working = setupJob(total, quota, mode);

        let executions = 0;
        for (;;) {
          const tick = tickWorker(working, INSTANCE_ID, JOB_ID, { shouldFail });
          working = tick.state;
          executions += 1;

          // Invariante por execução: nunca excede a quota.
          expect(tick.sentThisExecution).toBeLessThanOrEqual(quota);

          const job = getJob(working, INSTANCE_ID, JOB_ID);
          expect(job).toBeDefined();
          if (!job) {
            return;
          }

          if (job.status === 'COMPLETED') {
            break;
          }

          // Enquanto não concluído, o único estado terminal de execução é PAUSED.
          expect(job.status).toBe('PAUSED');
          working = resumeJob(working, INSTANCE_ID, JOB_ID);

          // Salvaguarda de convergência (cada execução PAUSED envia ≥1 SENT).
          expect(executions).toBeLessThanOrEqual(total + 5);
        }

        const finalJob = getJob(working, INSTANCE_ID, JOB_ID);
        expect(finalJob).toBeDefined();
        if (!finalJob) {
          return;
        }

        // Ao final: todos processados, contadores batem com a máscara de falhas.
        expect(finalJob.status).toBe('COMPLETED');
        const expectedFailed = failMask.filter((f) => f).length;
        const expectedSent = total - expectedFailed;
        expect(finalJob.sentCount).toBe(expectedSent);
        expect(finalJob.failedCount).toBe(expectedFailed);
      }),
      { numRuns: 100 }
    );
  });
});
