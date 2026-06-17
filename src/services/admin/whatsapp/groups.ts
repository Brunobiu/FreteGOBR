/**
 * Camada de serviço de Group_Dispatch (disparo em grupo) do WhatsApp_Module
 * (task 12.7, Req 12.1–12.7).
 *
 * Um Group_Dispatch é um Dispatch_Job `kind = 'GROUP'`: REUSA o MESMO motor
 * durável do disparo em massa (mesmas garantias de retomada e idempotência por
 * Dispatch_Recipient — Req 12.6), apenas com os destinatários sendo os grupos
 * selecionados (um Dispatch_Recipient por grupo). A RPC
 * `whatsapp_create_dispatch_job` (099) já materializa os recipients de grupo,
 * persiste `distribution_mode = NULL` e registra os JIDs em
 * `whatsapp_group_dispatches`.
 *
 * Por isso este módulo é uma fina composição sobre `dispatch.ts` (iniciar agora)
 * e `scheduled.ts` (agendar) — sem nenhuma RPC/SQL própria:
 *  - INICIAR/SALVAR → `createDispatchJob({ kind: 'GROUP', ... })`.
 *  - AGENDAR        → `createScheduledDispatch({ kind: 'GROUP', ... })`.
 *
 * A seleção vazia é bloqueada no cliente com a Canonical_Message
 * `Selecione ao menos um grupo.` (Req 12.7) — defesa em profundidade; o backend
 * reaplica a mesma regra (`WHATSAPP_NO_GROUPS_SELECTED`). O Send_Interval entre
 * grupos distintos (Req 12.4) é o mesmo `send_interval_sec` do job, aplicado
 * pelo pacing do worker. O conteúdo multimídia (Req 12.3) é resolvido pelos
 * Contents informados.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import {
  createDispatchJob,
  WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
  type MutationResult,
  type DispatchJob,
  type DispatchCreateStatus,
} from './dispatch';
import {
  createScheduledDispatch,
  type ScheduledDispatch,
  type ScheduleTime,
} from './scheduled';

/** Entrada para iniciar/salvar um Group_Dispatch (sem agendamento). */
export interface GroupDispatchInput {
  /** JIDs dos grupos alvo (>= 1; Req 12.2). */
  groupJids: string[];
  /** Contents do disparo (>= 1 válido; texto e/ou mídia — Req 12.3, 6.5). */
  contentIds: string[];
  /** Send_Interval em segundos entre envios a grupos distintos (Req 12.4). */
  sendIntervalSec: number;
  /** Execution_Quota por execução (`>= 1`, Req 8.4). */
  executionQuota: number;
  /**
   * Status inicial: `QUEUED` (default, "iniciar agora" — habilita o Job_Worker)
   * ou `DRAFT` (salvar sem iniciar). Req 12.6.
   */
  status?: DispatchCreateStatus;
}

/** Entrada para agendar um Group_Dispatch (data/hora futura). */
export interface ScheduleGroupDispatchInput {
  /** JIDs dos grupos alvo (>= 1; Req 12.2). */
  groupJids: string[];
  /** Contents do disparo (>= 1 válido). */
  contentIds: string[];
  /** Send_Interval em segundos entre grupos (Req 12.4). */
  sendIntervalSec: number;
  /** Execution_Quota por execução (`>= 1`). */
  executionQuota: number;
  /** Data/hora futura do agendamento (Req 12.5, 13.2). */
  scheduledAt: ScheduleTime;
}

/** Garante seleção não vazia de grupos (Req 12.7). */
function assertGroupsSelected(groupJids: string[] | null | undefined): void {
  if (!groupJids || groupJids.length === 0) {
    throw new Error(WHATSAPP_NO_GROUPS_SELECTED_MESSAGE);
  }
}

/**
 * Inicia (ou salva como rascunho) um Group_Dispatch da Active_Instance,
 * reutilizando o motor durável via `createDispatchJob` com `kind = 'GROUP'`
 * (Req 12.2, 12.3, 12.6).
 *
 * Bloqueia no cliente quando nenhum grupo é selecionado
 * (`Selecione ao menos um grupo.`, Req 12.7) — o backend reaplica a regra. O
 * `distributionMode` é `NULL` (rodízio interno garante exatamente 1 Content por
 * grupo).
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo).
 * @param input      Grupos, Contents, Send_Interval, Execution_Quota e status.
 * @returns `MutationResult<DispatchJob>` — `{ ok, data, updated_at }` na criação.
 * @throws `Error` com Canonical_Message pt-BR (seleção vazia/validação/anti-enum).
 */
export async function createGroupDispatch(
  instanceId: string,
  input: GroupDispatchInput
): Promise<MutationResult<DispatchJob>> {
  assertGroupsSelected(input.groupJids);

  return createDispatchJob(instanceId, {
    kind: 'GROUP',
    distributionMode: null,
    sendIntervalSec: input.sendIntervalSec,
    executionQuota: input.executionQuota,
    groupJids: input.groupJids,
    contentIds: input.contentIds,
    status: input.status ?? 'QUEUED',
  });
}

/**
 * Agenda um Group_Dispatch para data/hora futura, reutilizando o agendamento
 * durável via `createScheduledDispatch` com `kind = 'GROUP'` (Req 12.5).
 *
 * Bloqueia no cliente quando nenhum grupo é selecionado (Req 12.7). A validação
 * de data futura e a criação atômica (job DRAFT + agendamento) ficam a cargo de
 * `createScheduledDispatch`/da RPC 112.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo).
 * @param input      Grupos, Contents, Send_Interval, Execution_Quota e `scheduledAt`.
 * @returns `MutationResult<ScheduledDispatch>` — `{ ok, data, updated_at }`.
 * @throws `Error` com Canonical_Message pt-BR (seleção vazia/data passada/anti-enum).
 */
export async function scheduleGroupDispatch(
  instanceId: string,
  input: ScheduleGroupDispatchInput
): Promise<MutationResult<ScheduledDispatch>> {
  assertGroupsSelected(input.groupJids);

  return createScheduledDispatch(instanceId, {
    kind: 'GROUP',
    distributionMode: null,
    sendIntervalSec: input.sendIntervalSec,
    executionQuota: input.executionQuota,
    groupJids: input.groupJids,
    contentIds: input.contentIds,
    scheduledAt: input.scheduledAt,
  });
}
