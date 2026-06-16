// Feature: whatsapp-automation, Property 3: per-recipient idempotency (no double send)
/**
 * Property-Based Tests — Idempotência por destinatário (Req 10, 23, 27)
 *
 * Property 3: para QUALQUER Dispatch_Job e QUALQUER sequência de ticks do
 * Job_Worker — incluindo ticks repetidos, interrupções (pacing que bloqueia),
 * "reinício" do servidor (re-execução de `tickWorker` sobre o estado durável) e
 * RESUME de um job `PAUSED` — cada Dispatch_Recipient é enviado ao provedor no
 * máximo UMA vez: um destinatário já `SENT` nunca é reivindicado/reenviado.
 *
 * Como o estado de verdade é o store (espelho do banco), reiniciar é apenas
 * voltar a chamar `tickWorker`. A idempotência é verificada por contagem:
 *   total de transições SENT (Σ `sentThisExecution`) == nº de destinatários
 *   distintos em `SENT` == nº de `provider_message_id` distintos.
 * Ou seja: o nº de envios ao provedor é igual ao nº de destinatários únicos
 * enviados — sem duplicatas.
 *
 * Segunda metade: `resendFailed` re-enfileira EXATAMENTE o conjunto `FAILED` do
 * job de origem (como `PENDING`), preservando os `SENT` e nunca incluindo um
 * destinatário `SENT`.
 *
 * Validates: Requirements 10.4, 10.5, 23.3, 23.4, 27.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createInitialState,
  createInstance,
  addDispatchJob,
  tickWorker,
  resumeJob,
  resendFailed,
  listRecipients,
  getJob,
  type ModelState,
  type DispatchRecipient,
} from './_model/store';
import type { DistributionMode } from '../../../services/admin/whatsapp/distribution';

const INSTANCE_ID = 'inst-A';
const JOB_ID = 'job-1';
const RESEND_JOB_ID = 'job-1-resend';

// Telefones via constantFrom (convenção do projeto — nunca fc.stringOf).
const PHONE_POOL = [
  '+5511999990001',
  '+5511999990002',
  '+5521988880003',
  '+5531977770004',
  '+5541966660005',
  '+5551955550006',
] as const;
const phoneArb = fc.constantFrom(...PHONE_POOL);

// Um destinatário do disparo: telefone (pode repetir) + se o envio falha.
const recipientArb = fc.record({
  phone: phoneArb,
  fail: fc.boolean(),
});

const recipientsArb = fc.array(recipientArb, { minLength: 1, maxLength: 20 });

const contentIdsArb = fc
  .integer({ min: 1, max: 4 })
  .map((m) => Array.from({ length: m }, (_unused, i) => `content-${i}`));

const modeArb = fc.constantFrom('BLOCK' as DistributionMode, 'INTERLEAVED' as DistributionMode);

// Comandos que o cenário executa em sequência. RESTART_TICK é simplesmente
// re-executar `tickWorker` (o estado durável sobrevive ao "reinício").
type Command = 'TICK_PACED' | 'TICK_NOPACE' | 'RESUME' | 'RESTART_TICK';
const commandArb = fc.constantFrom<Command>('TICK_PACED', 'TICK_NOPACE', 'RESUME', 'RESTART_TICK');
const commandsArb = fc.array(commandArb, { minLength: 1, maxLength: 18 });

describe('tickWorker / resendFailed — Property 3 (idempotência por destinatário)', () => {
  it('nenhum destinatário SENT é reenviado: Σ envios == destinatários distintos enviados', () => {
    fc.assert(
      fc.property(
        recipientsArb,
        contentIdsArb,
        modeArb,
        fc.integer({ min: 1, max: 5 }), // blockSize
        fc.integer({ min: 1, max: 60 }), // sendIntervalSec
        fc.integer({ min: 1, max: 5 }), // executionQuota (pequena: força PAUSE/multi-tick)
        commandsArb,
        (recipients, contentIds, mode, blockSize, sendIntervalSec, executionQuota, commands) => {
          let state: ModelState = createInstance(createInitialState(), {
            instanceId: INSTANCE_ID,
          });
          state = addDispatchJob(state, INSTANCE_ID, {
            jobId: JOB_ID,
            recipients: recipients.map((r) => ({ phone: r.phone })),
            contentIds,
            mode,
            blockSize,
            sendIntervalSec,
            executionQuota,
          });

          // Falha determinística por `seq` (ordem de criação do recipient).
          const failBySeq = recipients.map((r) => r.fail);
          const shouldFail = (rec: DispatchRecipient) => failBySeq[rec.seq] === true;

          let totalSentTransitions = 0; // Σ provider sends (transições PENDING→SENT).
          // Ids já enviados em algum momento — devem permanecer SENT para sempre.
          const everSent = new Set<string>();
          // Relógio virtual crescente: garante que ticks pacejados possam enviar.
          let clock = 1;

          const checkInvariants = () => {
            const recs = listRecipients(state, INSTANCE_ID, JOB_ID);
            const sentRecs = recs.filter((r) => r.status === 'SENT');

            // (a) Nº de envios ao provedor == nº de destinatários distintos SENT.
            expect(sentRecs.length).toBe(totalSentTransitions);

            // (b) provider_message_id é único por destinatário enviado (sem duplicata).
            const providerIds = new Set(
              sentRecs.map((r) => r.providerMessageId).filter((id): id is string => id !== null)
            );
            expect(providerIds.size).toBe(sentRecs.length);

            // (c) Uma vez SENT, permanece SENT (nunca volta a PENDING/SENDING/etc).
            sentRecs.forEach((r) => everSent.add(r.id));
            everSent.forEach((id) => {
              const cur = recs.find((r) => r.id === id);
              expect(cur?.status).toBe('SENT');
            });
          };

          checkInvariants();

          for (const cmd of commands) {
            if (cmd === 'RESUME') {
              state = resumeJob(state, INSTANCE_ID, JOB_ID);
              checkInvariants();
              continue;
            }

            const opts = cmd === 'TICK_PACED' ? { now: clock, shouldFail } : { shouldFail }; // TICK_NOPACE e RESTART_TICK: sem pacing (drena até a quota).

            const result = tickWorker(state, INSTANCE_ID, JOB_ID, opts);
            state = result.state;
            totalSentTransitions += result.sentThisExecution;
            // Avança o relógio bem além do intervalo p/ o próximo tick pacejado liberar.
            clock += (sendIntervalSec + 1) * 1000 * 1000;

            checkInvariants();
          }

          // Drena o restante (RESUME + ticks sem pacing) para estabilizar o estado.
          for (let i = 0; i < recipients.length + 2; i += 1) {
            state = resumeJob(state, INSTANCE_ID, JOB_ID);
            const result = tickWorker(state, INSTANCE_ID, JOB_ID, { shouldFail });
            state = result.state;
            totalSentTransitions += result.sentThisExecution;
            checkInvariants();
          }

          // Após drenar: todo destinatário está SENT ou FAILED (nada pendente).
          const finalRecs = listRecipients(state, INSTANCE_ID, JOB_ID);
          finalRecs.forEach((r) => {
            expect(['SENT', 'FAILED']).toContain(r.status);
          });

          // O nº de SENT == nº de destinatários que NÃO falharam.
          const expectedSent = failBySeq.filter((f) => f !== true).length;
          const sentCount = finalRecs.filter((r) => r.status === 'SENT').length;
          expect(sentCount).toBe(expectedSent);
          expect(totalSentTransitions).toBe(expectedSent);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resendFailed re-enfileira EXATAMENTE o conjunto FAILED, sem incluir nenhum SENT', () => {
    fc.assert(
      fc.property(
        recipientsArb,
        contentIdsArb,
        modeArb,
        fc.integer({ min: 1, max: 5 }), // blockSize
        fc.integer({ min: 1, max: 60 }), // sendIntervalSec
        (recipients, contentIds, mode, blockSize, sendIntervalSec) => {
          let state: ModelState = createInstance(createInitialState(), {
            instanceId: INSTANCE_ID,
          });
          state = addDispatchJob(state, INSTANCE_ID, {
            jobId: JOB_ID,
            recipients: recipients.map((r) => ({ phone: r.phone })),
            contentIds,
            mode,
            blockSize,
            sendIntervalSec,
            executionQuota: recipients.length, // drena tudo em um tick
          });

          const failBySeq = recipients.map((r) => r.fail);
          const shouldFail = (rec: DispatchRecipient) => failBySeq[rec.seq] === true;

          // Executa até processar todos (quota = total, sem pacing).
          state = tickWorker(state, INSTANCE_ID, JOB_ID, { shouldFail }).state;

          const sourceRecs = listRecipients(state, INSTANCE_ID, JOB_ID);
          const failedSource = sourceRecs.filter((r) => r.status === 'FAILED');
          const sentSource = sourceRecs.filter((r) => r.status === 'SENT');

          const result = resendFailed(state, INSTANCE_ID, JOB_ID, RESEND_JOB_ID);

          if (failedSource.length === 0) {
            // Sem FAILED ⇒ _SKIPPED (NO_FAILED_RECIPIENTS), nenhum job novo criado.
            expect(result.skipped).toBe(true);
            if (result.skipped) {
              expect(result.reason).toBe('NO_FAILED_RECIPIENTS');
            }
            expect(getJob(result.state, INSTANCE_ID, RESEND_JOB_ID)).toBeUndefined();
            return;
          }

          expect(result.skipped).toBe(false);
          if (result.skipped) {
            return; // narrowing — não alcançável
          }
          // Re-enfileira exatamente o conjunto FAILED.
          expect(result.resentCount).toBe(failedSource.length);

          const newRecs = listRecipients(result.state, INSTANCE_ID, RESEND_JOB_ID);
          expect(newRecs).toHaveLength(failedSource.length);

          // Todos os novos destinatários nascem PENDING, limpos (sem envio anterior).
          newRecs.forEach((r) => {
            expect(r.status).toBe('PENDING');
            expect(r.sentAt).toBeNull();
            expect(r.providerMessageId).toBeNull();
          });

          // O novo job contém apenas telefones do conjunto FAILED (nunca SENT).
          const failedPhones = failedSource.map((r) => r.recipientData.telefone).sort();
          const newPhones = newRecs.map((r) => r.recipientData.telefone).sort();
          expect(newPhones).toEqual(failedPhones);

          // Os SENT da origem são preservados (job original intacto).
          const sourceAfter = listRecipients(result.state, INSTANCE_ID, JOB_ID);
          const sentAfter = sourceAfter.filter((r) => r.status === 'SENT');
          expect(sentAfter.map((r) => r.id).sort()).toEqual(sentSource.map((r) => r.id).sort());
        }
      ),
      { numRuns: 100 }
    );
  });
});
