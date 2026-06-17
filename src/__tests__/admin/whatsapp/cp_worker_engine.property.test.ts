/**
 * Property-Based Test + casos unitários — Motor de disparo durável (tasks
 * 12.2, 12.3, 12.4, 12.5): pacing/quota, finalização, varredura de agendados e
 * recuperação. Exercita os helpers PUROS de `worker.ts`, que espelham as RPCs
 * da migration 111 e o laço da Edge Function `whatsapp-job-worker`.
 *
 * Feature: whatsapp-automation, Motor de disparo durável (seção 12)
 * Validates: Requirements 8.5, 8.6, 8.7, 10.7, 13.3, 13.6, 27.2, 27.4, 27.6
 *
 * Invariantes verificadas (≥60 runs):
 *  - **Quota nunca é ignorada** (Req 8.5/8.7): `planRecipientAction` NUNCA
 *    retorna `SEND` quando a quota da execução foi atingida; `QUOTA_REACHED`
 *    tem precedência sobre o pacing.
 *  - **Pacing respeitado** (Req 8.6): com quota livre, só retorna `SEND` quando
 *    `shouldSendNow` permite; caso contrário `WAIT_PACING`.
 *  - **Finalização** (Req 10.7/8.7): `COMPLETED` sse não há `PENDING` nem
 *    `SENDING` (precedência); `PAUSED` exige quota atingida com `PENDING`
 *    restante; senão `RUNNING`.
 *  - **Varredura de agendados** (Req 13.3/13.6/27.4): seleciona exatamente os
 *    vencidos e pendentes (`scheduled_at <= now` e `executed_at` nulo).
 *  - **Recuperação** (Req 27.2/27.6): só recipients `SENDING` órfãos (mais
 *    antigos que a janela) são selecionados; job acionável sem recipients é
 *    inconsistente (`JOB_FAILED`).
 *
 * Convenções (project-conventions / testing-governance): tempos via `fc.integer`
 * (epoch ms), status via `fc.constantFrom`; funções PURAS — sem mocks; NUNCA
 * `fc.stringOf`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { shouldSendNow } from '../../../services/admin/whatsapp/dispatch';
import {
  quotaReached,
  planRecipientAction,
  decideJobFinalState,
  selectDueScheduled,
  selectOrphanedRecipients,
  isJobInconsistent,
  type RecipientAction,
  type JobFinalState,
} from '../../../services/admin/whatsapp/worker';

// Epoch ms em faixa segura para aritmética (sem overflow ao somar interval*1000).
const EPOCH_MS = fc.integer({ min: 0, max: 4_000_000_000_000 });
const INTERVAL_SEC = fc.integer({ min: 1, max: 31_536_000 });
const COUNT = fc.integer({ min: 0, max: 100_000 });
// Quota: positiva (CHECK >= 1) ou null (sem limite).
const QUOTA = fc.oneof(fc.integer({ min: 1, max: 100_000 }), fc.constant(null));
const RECIPIENT_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
const JOB_STATUSES = [
  'DRAFT',
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

const RUNS = { numRuns: 80 };

describe('WhatsApp Worker — quota por execução (Req 8.5)', () => {
  it('quotaReached: quota null ⇒ sempre false (sem limite)', () => {
    fc.assert(
      fc.property(COUNT, (exec) => {
        expect(quotaReached(exec, null)).toBe(false);
      }),
      RUNS
    );
  });

  it('quotaReached: true sse execSentCount >= quota (borda inclusiva)', () => {
    fc.assert(
      fc.property(COUNT, fc.integer({ min: 1, max: 100_000 }), (exec, quota) => {
        expect(quotaReached(exec, quota)).toBe(exec >= quota);
      }),
      RUNS
    );
    // Borda exata.
    expect(quotaReached(100, 100)).toBe(true);
    expect(quotaReached(99, 100)).toBe(false);
  });
});

describe('WhatsApp Worker — decisão do recipient no tick (Req 8.5, 8.6, 8.7)', () => {
  it('planRecipientAction casa com o oráculo (quota antes, pacing depois)', () => {
    fc.assert(
      fc.property(
        EPOCH_MS,
        fc.oneof(EPOCH_MS, fc.constant<null>(null)),
        INTERVAL_SEC,
        COUNT,
        QUOTA,
        (now, lastSendAt, sendIntervalSec, execSentCount, executionQuota) => {
          const action = planRecipientAction({
            now,
            lastSendAt,
            sendIntervalSec,
            execSentCount,
            executionQuota,
          });

          let expected: RecipientAction;
          if (quotaReached(execSentCount, executionQuota)) {
            expected = 'QUOTA_REACHED';
          } else if (!shouldSendNow(now, lastSendAt, sendIntervalSec)) {
            expected = 'WAIT_PACING';
          } else {
            expected = 'SEND';
          }
          expect(action).toBe(expected);
        }
      ),
      RUNS
    );
  });

  it('NUNCA envia com quota atingida (precedência sobre o pacing — Req 8.7)', () => {
    fc.assert(
      fc.property(
        EPOCH_MS,
        fc.oneof(EPOCH_MS, fc.constant<null>(null)),
        INTERVAL_SEC,
        fc.integer({ min: 1, max: 100_000 }),
        (now, lastSendAt, sendIntervalSec, quota) => {
          // execSentCount no limite ou acima ⇒ quota atingida.
          const action = planRecipientAction({
            now,
            lastSendAt,
            sendIntervalSec,
            execSentCount: quota,
            executionQuota: quota,
          });
          expect(action).toBe('QUOTA_REACHED');
        }
      ),
      RUNS
    );
  });

  it('SEND só quando quota livre E pacing permite', () => {
    fc.assert(
      fc.property(
        EPOCH_MS,
        fc.oneof(EPOCH_MS, fc.constant<null>(null)),
        INTERVAL_SEC,
        COUNT,
        QUOTA,
        (now, lastSendAt, sendIntervalSec, execSentCount, executionQuota) => {
          const action = planRecipientAction({
            now,
            lastSendAt,
            sendIntervalSec,
            execSentCount,
            executionQuota,
          });
          if (action === 'SEND') {
            expect(quotaReached(execSentCount, executionQuota)).toBe(false);
            expect(shouldSendNow(now, lastSendAt, sendIntervalSec)).toBe(true);
          }
        }
      ),
      RUNS
    );
  });
});

describe('WhatsApp Worker — finalização do job (Req 10.7, 8.7)', () => {
  it('decideJobFinalState casa com o oráculo (COMPLETED tem precedência)', () => {
    fc.assert(
      fc.property(COUNT, COUNT, COUNT, QUOTA, (pending, sending, execSentCount, executionQuota) => {
        const state = decideJobFinalState({
          pendingCount: pending,
          sendingCount: sending,
          execSentCount,
          executionQuota,
        });

        let expected: JobFinalState;
        if (pending === 0 && sending === 0) {
          expected = 'COMPLETED';
        } else if (quotaReached(execSentCount, executionQuota) && pending > 0) {
          expected = 'PAUSED';
        } else {
          expected = 'RUNNING';
        }
        expect(state).toBe(expected);
      }),
      RUNS
    );
  });

  it('COMPLETED ⇒ não há PENDING nem SENDING; PAUSED ⇒ quota atingida com PENDING', () => {
    fc.assert(
      fc.property(COUNT, COUNT, COUNT, QUOTA, (pending, sending, execSentCount, executionQuota) => {
        const state = decideJobFinalState({
          pendingCount: pending,
          sendingCount: sending,
          execSentCount,
          executionQuota,
        });
        if (state === 'COMPLETED') {
          expect(pending).toBe(0);
          expect(sending).toBe(0);
        }
        if (state === 'PAUSED') {
          expect(quotaReached(execSentCount, executionQuota)).toBe(true);
          expect(pending).toBeGreaterThan(0);
        }
      }),
      RUNS
    );
  });

  it('exemplos canônicos de finalização', () => {
    // Drenado ⇒ COMPLETED.
    expect(decideJobFinalState({ pendingCount: 0, sendingCount: 0, execSentCount: 5, executionQuota: 10 })).toBe('COMPLETED');
    // Quota atingida com pendentes ⇒ PAUSED.
    expect(decideJobFinalState({ pendingCount: 3, sendingCount: 0, execSentCount: 10, executionQuota: 10 })).toBe('PAUSED');
    // Pendentes dentro da quota ⇒ RUNNING.
    expect(decideJobFinalState({ pendingCount: 3, sendingCount: 0, execSentCount: 2, executionQuota: 10 })).toBe('RUNNING');
    // SENDING órfão (pending=0, sending>0) NÃO completa nem pausa ⇒ RUNNING (recuperação resolve).
    expect(decideJobFinalState({ pendingCount: 0, sendingCount: 1, execSentCount: 10, executionQuota: 10 })).toBe('RUNNING');
    // Sem limite de quota e com pendentes ⇒ RUNNING.
    expect(decideJobFinalState({ pendingCount: 5, sendingCount: 0, execSentCount: 999, executionQuota: null })).toBe('RUNNING');
  });
});

describe('WhatsApp Worker — varredura de agendados vencidos (Req 13.3, 13.6, 27.4)', () => {
  interface SchedRow {
    id: string;
    scheduledAt: number;
    executedAt: number | null;
  }
  const schedArb = fc.array(
    fc.record({
      id: fc.uuid(),
      scheduledAt: EPOCH_MS,
      executedAt: fc.oneof(EPOCH_MS, fc.constant<null>(null)),
    }),
    { minLength: 0, maxLength: 40 }
  );

  it('seleciona exatamente os vencidos e pendentes', () => {
    fc.assert(
      fc.property(schedArb, EPOCH_MS, (rows: SchedRow[], now) => {
        const due = selectDueScheduled(rows, now);
        // Todos selecionados: pendentes e vencidos.
        for (const r of due) {
          expect(r.executedAt).toBeNull();
          expect(r.scheduledAt).toBeLessThanOrEqual(now);
        }
        // Nenhum dos não selecionados é elegível.
        const dueIds = new Set(due.map((r) => r.id));
        for (const r of rows) {
          if (!dueIds.has(r.id)) {
            const eligible = r.executedAt === null && r.scheduledAt <= now;
            expect(eligible).toBe(false);
          }
        }
        // Subconjunto (não duplica nem inventa linhas).
        expect(due.length).toBeLessThanOrEqual(rows.length);
      }),
      RUNS
    );
  });

  it('agendado já executado nunca é re-selecionado (idempotência)', () => {
    const rows: SchedRow[] = [
      { id: 'a', scheduledAt: 1_000, executedAt: 2_000 }, // executado
      { id: 'b', scheduledAt: 1_000, executedAt: null }, // vencido pendente
      { id: 'c', scheduledAt: 9_999_999, executedAt: null }, // futuro
    ];
    const due = selectDueScheduled(rows, 5_000);
    expect(due.map((r) => r.id)).toEqual(['b']);
  });

  it('aceita Date além de epoch ms', () => {
    const rows = [{ id: 'b', scheduledAt: new Date(1_000), executedAt: null }];
    expect(selectDueScheduled(rows, new Date(5_000)).map((r) => r.id)).toEqual(['b']);
  });
});

describe('WhatsApp Worker — recuperação (Req 27.2, 27.6)', () => {
  interface RecRow {
    id: string;
    status: string;
    updatedAt: number;
  }
  const recArb = fc.array(
    fc.record({
      id: fc.uuid(),
      status: fc.constantFrom(...RECIPIENT_STATUSES),
      updatedAt: EPOCH_MS,
    }),
    { minLength: 0, maxLength: 40 }
  );

  it('seleciona apenas SENDING órfãos (mais antigos que a janela)', () => {
    fc.assert(
      fc.property(recArb, EPOCH_MS, fc.integer({ min: 1, max: 86_400 }), (rows: RecRow[], now, stale) => {
        const orphans = selectOrphanedRecipients(rows, now, stale);
        const cutoff = now - stale * 1000;
        for (const r of orphans) {
          expect(r.status).toBe('SENDING');
          expect(r.updatedAt).toBeLessThan(cutoff);
        }
        // Nenhum não selecionado é órfão.
        const ids = new Set(orphans.map((r) => r.id));
        for (const r of rows) {
          if (!ids.has(r.id)) {
            const isOrphan = r.status === 'SENDING' && r.updatedAt < cutoff;
            expect(isOrphan).toBe(false);
          }
        }
      }),
      RUNS
    );
  });

  it('SENDING recente (dentro da janela) NÃO é recuperado — evita reverter envio em voo', () => {
    const now = 1_000_000;
    const stale = 300; // 300s => 300_000 ms
    const rows: RecRow[] = [
      { id: 'fresh', status: 'SENDING', updatedAt: now - 10_000 }, // 10s atrás: recente
      { id: 'old', status: 'SENDING', updatedAt: now - 400_000 }, // 400s atrás: órfão
      { id: 'sent', status: 'SENT', updatedAt: now - 999_999 }, // SENT nunca entra
    ];
    expect(selectOrphanedRecipients(rows, now, stale).map((r) => r.id)).toEqual(['old']);
  });

  it('isJobInconsistent: job acionável sem recipients ⇒ inconsistente (JOB_FAILED)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...JOB_STATUSES), COUNT, (status, count) => {
        const expected = (status === 'QUEUED' || status === 'RUNNING') && count === 0;
        expect(isJobInconsistent(status, count)).toBe(expected);
      }),
      RUNS
    );
    // Exemplos: só QUEUED/RUNNING sem recipients.
    expect(isJobInconsistent('QUEUED', 0)).toBe(true);
    expect(isJobInconsistent('RUNNING', 0)).toBe(true);
    expect(isJobInconsistent('QUEUED', 5)).toBe(false);
    expect(isJobInconsistent('DRAFT', 0)).toBe(false);
    expect(isJobInconsistent('COMPLETED', 0)).toBe(false);
  });
});
