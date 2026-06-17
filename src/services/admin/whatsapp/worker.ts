/**
 * worker.ts — Lógica PURA de decisão do Job_Worker durável (sem I/O).
 *
 * O processamento de disparos é SERVER-SIDE e durável: a fila vive em Postgres e
 * a Edge Function `supabase/functions/whatsapp-job-worker` é acionada pelo
 * `pg_cron` a cada minuto (tick). Cada tick é *stateless*: lê o estado durável,
 * faz uma fatia de trabalho respeitando `Send_Interval`/quota e persiste o
 * progresso (design.md > "Modelo de execução do Job_Worker (tick)").
 *
 * Como a Edge Function roda em Deno e NÃO importa de `src/`, este módulo NÃO é
 * importado por ela diretamente. Ele é o **espelho puro e testável** das
 * decisões que a Edge Function (e as RPCs da migration 111) implementam — no
 * mesmo espírito do `_model/store.ts`. Manter as duas implementações em paralelo
 * permite exercitar as invariantes do motor (pacing, quota, finalização,
 * varredura de agendados, recuperação) com testes unitários determinísticos, sem
 * um banco de dados.
 *
 * Correspondência com a migration 111 (RPCs `SECURITY DEFINER`, service_role):
 *  - `planRecipientAction`  ↔ laço do tick (quota antes, pacing depois).
 *  - `decideJobFinalState`  ↔ `whatsapp_worker_finalize_job`.
 *  - `selectDueScheduled`   ↔ `whatsapp_worker_sweep_scheduled` (seleção).
 *  - `selectOrphanedRecipients` / `isJobInconsistent` ↔ `whatsapp_worker_recover`.
 *
 * Identifiers/codes em inglês; nenhum segredo trafega por aqui.
 */

import { shouldSendNow, type TimeInput } from './dispatch';

/** Converte um `TimeInput` (epoch ms ou `Date`) para epoch em milissegundos. */
function toEpochMs(value: TimeInput): number {
  return value instanceof Date ? value.getTime() : value;
}

/* ========================================================================== *
 * Pacing + quota por execução (Req 8.5, 8.6, 8.7) — tasks 12.2/12.3          *
 * ========================================================================== */

/**
 * Decide, de forma PURA, se a quota da execução corrente já foi atingida
 * (Req 8.5). `executionQuota` nulo significa "sem limite de quota" (nunca
 * atingida). Espelha o teste `exec_sent_count >= execution_quota` das RPCs.
 *
 * @param execSentCount  Enviados (`SENT`) na execução corrente.
 * @param executionQuota Quota da execução (`>= 1`) ou `null` (sem limite).
 * @returns `true` se `executionQuota` está definida e foi alcançada/excedida.
 */
export function quotaReached(execSentCount: number, executionQuota: number | null): boolean {
  return executionQuota !== null && executionQuota !== undefined && execSentCount >= executionQuota;
}

/** Ação a tomar para o próximo Dispatch_Recipient no laço do tick. */
export type RecipientAction = 'SEND' | 'WAIT_PACING' | 'QUOTA_REACHED';

/**
 * Decide a ação do próximo recipient no tick (Req 8.5–8.7), espelhando o laço do
 * `design.md`: a quota é checada ANTES (se atingida, o tick para e o job pausa);
 * caso contrário, o pacing por relógio (`shouldSendNow`) decide entre enviar
 * agora (`SEND`) ou aguardar o próximo tick (`WAIT_PACING`).
 *
 * @returns
 *  - `QUOTA_REACHED`: quota da execução atingida — para de enviar (=> PAUSED se
 *    restam pendentes).
 *  - `WAIT_PACING`: o `Send_Interval` ainda não venceu — encerra a fatia deste
 *    job e aguarda o próximo tick (o recipient reivindicado é devolvido a
 *    PENDING via `whatsapp_worker_release_recipient`).
 *  - `SEND`: pode enviar agora.
 */
export function planRecipientAction(input: {
  now: TimeInput;
  lastSendAt: TimeInput | null | undefined;
  sendIntervalSec: number;
  execSentCount: number;
  executionQuota: number | null;
}): RecipientAction {
  if (quotaReached(input.execSentCount, input.executionQuota)) {
    return 'QUOTA_REACHED';
  }
  if (!shouldSendNow(input.now, input.lastSendAt, input.sendIntervalSec)) {
    return 'WAIT_PACING';
  }
  return 'SEND';
}

/* ========================================================================== *
 * Finalização do job ao fim de uma fatia (Req 10.7, 8.7) — task 12.3         *
 * ========================================================================== */

/** Estado decidido pela finalização de uma fatia do job. */
export type JobFinalState = 'COMPLETED' | 'PAUSED' | 'RUNNING';

/**
 * Decide o estado de um job `RUNNING` ao fim de uma fatia (Req 10.7, 8.7),
 * espelhando `whatsapp_worker_finalize_job`. `COMPLETED` tem precedência sobre
 * `PAUSED`:
 *  - sem `PENDING` E sem `SENDING` ⇒ `COMPLETED` (todos processados, Req 10.7);
 *  - quota atingida com `PENDING` restante ⇒ `PAUSED` (Req 8.7);
 *  - caso contrário ⇒ permanece `RUNNING` (mais trabalho no próximo tick).
 *
 * Observação: a precedência de `COMPLETED` evita pausar um job cuja única
 * pendência é um `SENDING` órfão — esse caso retorna `RUNNING` e é resolvido
 * pela recuperação (`selectOrphanedRecipients`).
 */
export function decideJobFinalState(input: {
  pendingCount: number;
  sendingCount: number;
  execSentCount: number;
  executionQuota: number | null;
}): JobFinalState {
  const { pendingCount, sendingCount, execSentCount, executionQuota } = input;

  if (pendingCount === 0 && sendingCount === 0) {
    return 'COMPLETED';
  }
  if (quotaReached(execSentCount, executionQuota) && pendingCount > 0) {
    return 'PAUSED';
  }
  return 'RUNNING';
}

/* ========================================================================== *
 * Varredura de agendados vencidos (Req 13.3, 13.6, 27.4) — task 12.4         *
 * ========================================================================== */

/** Subconjunto de um Scheduled_Dispatch necessário à seleção de vencidos. */
export interface ScheduledDispatchLite {
  id: string;
  scheduledAt: TimeInput;
  /** `null`/`undefined` ⇒ ainda pendente (não executado). */
  executedAt: TimeInput | null | undefined;
}

/**
 * Seleciona os Scheduled_Dispatches VENCIDOS e pendentes (`scheduled_at <= now`
 * E `executed_at IS NULL`), espelhando o filtro de `whatsapp_worker_sweep_
 * scheduled`. Inclui agendados cuja data passou durante uma indisponibilidade
 * (executam na primeira varredura subsequente — Req 13.6, 27.4); um já executado
 * nunca é re-selecionado (idempotência).
 *
 * Não muta a entrada nem depende da ordem.
 */
export function selectDueScheduled<T extends ScheduledDispatchLite>(
  rows: readonly T[],
  now: TimeInput
): T[] {
  const nowMs = toEpochMs(now);
  return rows.filter(
    (r) => (r.executedAt === null || r.executedAt === undefined) && toEpochMs(r.scheduledAt) <= nowMs
  );
}

/* ========================================================================== *
 * Recuperação (Req 27) — task 12.5                                           *
 * ========================================================================== */

/** Subconjunto de um Dispatch_Recipient necessário à detecção de órfãos. */
export interface RecipientLite {
  id: string;
  status: string;
  /** Instante da última transição (epoch ms ou `Date`). */
  updatedAt: TimeInput;
}

/**
 * Seleciona recipients `SENDING` ÓRFÃOS — reivindicados por um tick que morreu
 * antes de marcar `SENT`/`FAILED` — cujo `updated_at` é mais antigo que
 * `staleSeconds` (visibility timeout). Espelha o passo (1) de
 * `whatsapp_worker_recover`: esses recipients voltam a `PENDING` para
 * reprocessamento (Req 27.2). A idempotência por destinatário garante que um já
 * `SENT` jamais entra aqui (status filtrado em `SENDING`).
 *
 * Janela conservadora (padrão 300s na RPC) evita reverter um envio em voo dentro
 * de um tick normal. Não muta a entrada nem depende da ordem.
 */
export function selectOrphanedRecipients<T extends RecipientLite>(
  rows: readonly T[],
  now: TimeInput,
  staleSeconds: number
): T[] {
  const cutoff = toEpochMs(now) - staleSeconds * 1000;
  return rows.filter((r) => r.status === 'SENDING' && toEpochMs(r.updatedAt) < cutoff);
}

/**
 * Decide se um Dispatch_Job está INCONSISTENTE e deve ser marcado `JOB_FAILED`
 * (Req 27.6, 10.8), espelhando o passo (2) de `whatsapp_worker_recover`: um job
 * acionável (`QUEUED`/`RUNNING`) que não possui NENHUM Dispatch_Recipient nunca
 * poderá concluir — estado parcial/inconsistente após reinício.
 *
 * @param status         Estado atual do job.
 * @param recipientCount Quantidade de Dispatch_Recipients existentes do job.
 */
export function isJobInconsistent(status: string, recipientCount: number): boolean {
  return (status === 'QUEUED' || status === 'RUNNING') && recipientCount === 0;
}
