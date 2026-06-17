/**
 * Camada de serviço de Scheduled_Dispatch (disparos programados) do
 * WhatsApp_Module (task 12.6, Req 13.1–13.7).
 *
 * Um Scheduled_Dispatch é um Dispatch_Job criado em `DRAFT` (fora do alcance do
 * Job_Worker) com uma linha em `whatsapp_scheduled_dispatches` marcando o
 * horário. No horário, o `whatsapp_worker_sweep_scheduled` (migration 111)
 * promove DRAFT→QUEUED e o motor durável processa normalmente (Req 13.3, 13.6).
 *
 * Este módulo NÃO duplica o motor — REUSA as RPCs da migration 112, que por sua
 * vez reusam `whatsapp_create_dispatch_job` (099):
 *  - CRIAR   → `whatsapp_create_scheduled_dispatch` (valida data futura, cria o
 *              job DRAFT + agendamento, tudo atômico).
 *  - LISTAR  → `whatsapp_list_scheduled_dispatches` (pendentes da Active_Instance).
 *  - CANCELAR→ `whatsapp_cancel_scheduled_dispatch` (DRAFT→CANCELLED + marca o
 *              agendamento resolvido, versionamento otimista + idempotência).
 *
 * As mutações (criar/cancelar) passam por `executeAdminMutation`
 * (audit-by-construction, admin-patterns #1) sempre com o `instance_id` no log
 * (Req 13.7, 18.6). Gating reaplicado no servidor; escopo exclusivo da
 * Active_Instance. Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, isInstanceGuardError, type SupabaseLikeError } from './guards';
import { WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE } from './contacts';
import { validateSendInterval, validateExecutionQuota } from './validation';
import type { DistributionMode } from './distribution';
import {
  WHATSAPP_NO_VALID_CONTENT_MESSAGE,
  WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
  type MutationResult,
  type DispatchKind,
} from './dispatch';

/** Canonical_Message (pt-BR) para data/hora de agendamento no passado (Req 13.2). */
export const WHATSAPP_SCHEDULE_IN_PAST_MESSAGE = 'Informe uma data e hora futuras.' as const;

/** Instante de agendamento aceito: ISO string ou `Date`. */
export type ScheduleTime = string | Date;

/**
 * Entrada para criar um Scheduled_Dispatch. Espelha o `DispatchInput` (sem
 * `status`, sempre `DRAFT` por construção) acrescido do horário `scheduledAt`.
 */
export interface ScheduledDispatchInput {
  /** Tipo de disparo: massa (`BULK`) ou grupos (`GROUP`). */
  kind: DispatchKind;
  /** Distribuição dos Contents (obrigatória em `BULK`; ignorada em `GROUP`). */
  distributionMode?: DistributionMode | null;
  /** Tamanho do bloco para `BLOCK` (`>= 1`); ignorado em `INTERLEAVED`. */
  blockSize?: number | null;
  /** Send_Interval em segundos (`> 0`, Req 8.2). */
  sendIntervalSec: number;
  /** Execution_Quota por execução (`>= 1`, Req 8.4). */
  executionQuota: number;
  /** Contact_List alvo (obrigatória em `BULK`). */
  listId?: string | null;
  /** JIDs de grupos alvo (obrigatórios em `GROUP`). */
  groupJids?: string[] | null;
  /** Contents do disparo (>= 1 válido; Req 6.5). */
  contentIds: string[];
  /** Data/hora futura do agendamento (Req 13.1, 13.2). */
  scheduledAt: ScheduleTime;
}

/** Scheduled_Dispatch persistido, como exposto à UI (camelCase). */
export interface ScheduledDispatch {
  scheduledId: string;
  dispatchJobId: string;
  instanceId: string;
  kind: DispatchKind;
  /** Data/hora agendada (ISO). */
  scheduledAt: string;
  totalCount: number;
  createdAt: string;
  /** Versão otimista do agendamento (ISO) para chamadas subsequentes. */
  updatedAt: string;
}

/** Item da listagem de agendamentos pendentes (camelCase). */
export interface ScheduledDispatchListItem {
  scheduledId: string;
  dispatchJobId: string;
  scheduledAt: string;
  kind: DispatchKind;
  status: string;
  totalCount: number;
  sendIntervalSec: number;
  executionQuota: number | null;
  groupJids: string[] | null;
  contentCount: number;
  /** Versão otimista do Dispatch_Job (ISO), enviada de volta no cancelamento. */
  updatedAt: string;
}

/** Forma crua (snake_case) do Scheduled_Dispatch criado pela RPC. */
interface RawScheduledDispatch {
  scheduled_id: string;
  dispatch_job_id: string;
  instance_id: string;
  kind: DispatchKind;
  scheduled_at: string;
  total_count: number;
  created_at: string;
  updated_at: string;
}

/** Forma crua (snake_case) de um item da listagem. */
interface RawScheduledListItem {
  scheduled_id: string;
  dispatch_job_id: string;
  scheduled_at: string;
  kind: DispatchKind;
  status: string;
  total_count: number;
  send_interval_sec: number;
  execution_quota: number | null;
  group_jids: string[] | null;
  content_count: number;
  updated_at: string;
}

/** Forma crua da transição de cancelamento válida retornada pela RPC. */
interface RawScheduledCancel {
  ok: true;
  scheduled_id: string;
  dispatch_job_id: string;
  instance_id: string;
  previous_status: string;
  status: string;
  updated_at: string;
}

/** Forma crua do retorno idempotente (`_SKIPPED`) do cancelamento. */
interface RawScheduledSkip {
  skipped: true;
  reason: string;
}

/** Converte o instante de agendamento para ISO (epoch ms aceito via `Date`). */
function toIso(value: ScheduleTime): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converte o instante de agendamento para epoch ms (validação client-side). */
function toEpochMs(value: ScheduleTime): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function mapScheduled(row: RawScheduledDispatch): ScheduledDispatch {
  return {
    scheduledId: row.scheduled_id,
    dispatchJobId: row.dispatch_job_id,
    instanceId: row.instance_id,
    kind: row.kind,
    scheduledAt: row.scheduled_at,
    totalCount: row.total_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScheduledListItem(row: RawScheduledListItem): ScheduledDispatchListItem {
  return {
    scheduledId: row.scheduled_id,
    dispatchJobId: row.dispatch_job_id,
    scheduledAt: row.scheduled_at,
    kind: row.kind,
    status: row.status,
    totalCount: row.total_count,
    sendIntervalSec: row.send_interval_sec,
    executionQuota: row.execution_quota,
    groupJids: row.group_jids,
    contentCount: row.content_count,
    updatedAt: row.updated_at,
  };
}

/** Concatena os campos textuais de um erro Supabase-like para busca de marker. */
function errorText(error: unknown): string {
  if (error == null || typeof error !== 'object') {
    return typeof error === 'string' ? error : '';
  }
  const err = error as SupabaseLikeError;
  return [err.message, err.details, err.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
}

/**
 * Mapa marker (SQL) → Canonical_Message/código. Inclui o marker próprio do
 * agendamento (`WHATSAPP_SCHEDULE_IN_PAST`) e os markers herdados da 099
 * (intervalo/quota/conteúdo/lista/grupo). `STALE_VERSION`/`INVALID_STATE_
 * TRANSITION` permanecem como códigos em inglês (admin-patterns #3).
 */
const SCHEDULED_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_SCHEDULE_IN_PAST: WHATSAPP_SCHEDULE_IN_PAST_MESSAGE,
  WHATSAPP_INVALID_SEND_INTERVAL: 'Informe um intervalo válido.',
  WHATSAPP_INVALID_EXECUTION_QUOTA: 'Informe uma quantidade válida.',
  WHATSAPP_NO_VALID_CONTENT: WHATSAPP_NO_VALID_CONTENT_MESSAGE,
  WHATSAPP_EMPTY_CONTACT_LIST: WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE,
  WHATSAPP_NO_GROUPS_SELECTED: WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  STALE_VERSION: 'STALE_VERSION',
};

/**
 * Mapeia um erro de RPC de agendamento: `WHATSAPP_NOT_FOUND` → Canonical_Message
 * anti-enumeração (precedência); markers conhecidos → mensagem/código; demais →
 * fallback seguro.
 */
function mapScheduledError(error: unknown): string {
  if (isInstanceGuardError(error)) {
    return mapInstanceGuardError(error);
  }
  const text = errorText(error);
  for (const [marker, message] of Object.entries(SCHEDULED_ERROR_MESSAGES)) {
    if (text.includes(marker)) {
      return message;
    }
  }
  return mapInstanceGuardError(error);
}

/* ========================================================================== *
 * CRIAR um Scheduled_Dispatch                                                *
 * ========================================================================== */

/**
 * Cria um Scheduled_Dispatch da Active_Instance via RPC
 * `whatsapp_create_scheduled_dispatch` (Req 13.1, 13.2).
 *
 * Fluxo:
 * 1. Revalida no frontend (espelho do backend — defesa em profundidade):
 *    data/hora futura (Req 13.2), Send_Interval (`> 0`), Execution_Quota
 *    (`>= 1`), `distributionMode` para `BULK`, ≥1 Content e destino conforme o
 *    kind (lista em `BULK`, ≥1 grupo em `GROUP`). Falha ⇒ Canonical_Message.
 * 2. Persiste via `executeAdminMutation` (audit com `instance_id`, Req 13.7).
 *    A RPC cria o job em `DRAFT` + o agendamento, revalidando tudo no backend.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo).
 * @param input      Parâmetros do disparo + `scheduledAt` (data/hora futura).
 * @returns `MutationResult<ScheduledDispatch>` — `{ ok, data, updated_at }`.
 * @throws `Error` com Canonical_Message pt-BR (validação/anti-enumeração).
 */
export async function createScheduledDispatch(
  instanceId: string,
  input: ScheduledDispatchInput
): Promise<MutationResult<ScheduledDispatch>> {
  // (1) Revalidação client-side (bloqueia antes do I/O).
  const scheduledMs = toEpochMs(input.scheduledAt);
  if (!Number.isFinite(scheduledMs) || scheduledMs <= Date.now()) {
    throw new Error(WHATSAPP_SCHEDULE_IN_PAST_MESSAGE);
  }

  const intervalCheck = validateSendInterval(input.sendIntervalSec);
  if (!intervalCheck.ok) {
    throw new Error(intervalCheck.message);
  }

  const quotaCheck = validateExecutionQuota(input.executionQuota);
  if (!quotaCheck.ok) {
    throw new Error(quotaCheck.message);
  }

  if (!input.contentIds || input.contentIds.length === 0) {
    throw new Error(WHATSAPP_NO_VALID_CONTENT_MESSAGE);
  }

  if (input.kind === 'BULK') {
    if (input.distributionMode !== 'BLOCK' && input.distributionMode !== 'INTERLEAVED') {
      throw new Error('Selecione o modo de distribuição.');
    }
    if (!input.listId) {
      throw new Error(WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE);
    }
  } else if (!input.groupJids || input.groupJids.length === 0) {
    throw new Error(WHATSAPP_NO_GROUPS_SELECTED_MESSAGE);
  }

  const scheduledIso = toIso(input.scheduledAt);

  return executeAdminMutation(
    {
      action: 'WHATSAPP_SCHEDULED_CREATE',
      targetType: 'whatsapp_scheduled_dispatches',
      targetId: instanceId,
      before: null,
      after: {
        instance_id: instanceId,
        kind: input.kind,
        scheduled_at: scheduledIso,
        distribution_mode: input.kind === 'BULK' ? (input.distributionMode ?? null) : null,
        send_interval_sec: input.sendIntervalSec,
        execution_quota: input.executionQuota,
        list_id: input.listId ?? null,
        group_count: input.groupJids?.length ?? 0,
        content_count: input.contentIds.length,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_create_scheduled_dispatch', {
        p_instance_id: instanceId,
        p_kind: input.kind,
        p_distribution_mode: input.kind === 'BULK' ? (input.distributionMode ?? null) : null,
        p_block_size: input.blockSize ?? null,
        p_send_interval_sec: input.sendIntervalSec,
        p_execution_quota: input.executionQuota,
        p_list_id: input.listId ?? null,
        p_group_jids: input.groupJids ?? null,
        p_content_ids: input.contentIds,
        p_scheduled_at: scheduledIso,
      });
      if (error) {
        throw new Error(mapScheduledError(error));
      }
      const scheduled = mapScheduled(data as RawScheduledDispatch);
      return { ok: true, data: scheduled, updated_at: scheduled.updatedAt };
    }
  );
}

/* ========================================================================== *
 * LISTAR agendamentos pendentes                                              *
 * ========================================================================== */

/**
 * Lista os Scheduled_Dispatches pendentes da Active_Instance via RPC
 * `whatsapp_list_scheduled_dispatches` (Req 13.4): leitura escopada por
 * `instance_id`, com data/hora, destino e contagem de Contents.
 *
 * @param instanceId Active_Instance alvo.
 * @returns lista de agendamentos pendentes (vazia quando não há).
 * @throws `Error` com Canonical_Message anti-enumeração em instância inválida.
 */
export async function listScheduledDispatches(
  instanceId: string
): Promise<ScheduledDispatchListItem[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_scheduled_dispatches', {
    p_instance_id: instanceId,
  });
  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }
  const rows = Array.isArray(data) ? (data as RawScheduledListItem[]) : [];
  return rows.map(mapScheduledListItem);
}

/* ========================================================================== *
 * CANCELAR um agendamento                                                    *
 * ========================================================================== */

/** Resultado do cancelamento: transição válida (camelCase) ou skip idempotente. */
export interface ScheduledCancel {
  scheduledId: string;
  dispatchJobId: string;
  instanceId: string;
  previousStatus: string;
  status: string;
  updatedAt: string;
}

/**
 * Cancela um Scheduled_Dispatch pendente da Active_Instance via RPC
 * `whatsapp_cancel_scheduled_dispatch` (Req 13.5): o Dispatch_Job vai de
 * `DRAFT`→`CANCELLED` e o agendamento é marcado como resolvido, impedindo a
 * execução no horário.
 *
 * Fluxo (espelho de `transitionDispatch`):
 * 1. Chama a RPC com o `expected_updated_at` (versionamento otimista).
 * 2. Idempotência (`_SKIPPED`, ALREADY_CANCELLED/ALREADY_EXECUTED): retorna
 *    `{ skipped, reason }` SEM auditar de novo (a RPC já gravou o log).
 * 3. Cancelamento válido: registra o audit positivo (Req 13.7) via
 *    `executeAdminMutation` com o `instance_id`, e devolve `{ ok, data, updated_at }`.
 *
 * Erros: `STALE_VERSION` (Req 13.5) e `INVALID_STATE_TRANSITION` (job iniciado
 * manualmente) → códigos em inglês; `WHATSAPP_NOT_FOUND` → Canonical_Message.
 *
 * @param instanceId        Active_Instance alvo.
 * @param scheduledId       Agendamento a cancelar.
 * @param expectedUpdatedAt Versão otimista lida na listagem.
 * @returns `MutationResult<ScheduledCancel>` — `{ ok, data, updated_at }` no
 *          cancelamento; `{ skipped, reason }` na idempotência.
 * @throws `Error` com código (`STALE_VERSION`/`INVALID_STATE_TRANSITION`) ou
 *         Canonical_Message anti-enumeração (`WHATSAPP_NOT_FOUND`).
 */
export async function cancelScheduledDispatch(
  instanceId: string,
  scheduledId: string,
  expectedUpdatedAt: string
): Promise<MutationResult<ScheduledCancel>> {
  // (1) RPC chamada PRIMEIRO: distingue skip (idempotência, já auditada) de
  //     cancelamento válido e fornece previous_status/status para o audit.
  const { data, error } = await supabase.rpc('whatsapp_cancel_scheduled_dispatch', {
    p_instance_id: instanceId,
    p_scheduled_id: scheduledId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    throw new Error(mapScheduledError(error));
  }

  const result = data as RawScheduledCancel | RawScheduledSkip;

  // (2) Idempotência (_SKIPPED): a RPC já gravou o log — apenas propaga.
  if ('skipped' in result) {
    return { skipped: true, reason: result.reason };
  }

  // (3) Cancelamento válido: audit positivo (Req 13.7) com instance_id.
  const cancel: ScheduledCancel = {
    scheduledId: result.scheduled_id,
    dispatchJobId: result.dispatch_job_id,
    instanceId: result.instance_id,
    previousStatus: result.previous_status,
    status: result.status,
    updatedAt: result.updated_at,
  };

  return executeAdminMutation(
    {
      action: 'WHATSAPP_SCHEDULED_CANCEL',
      targetType: 'whatsapp_scheduled_dispatches',
      targetId: cancel.scheduledId,
      before: { instance_id: instanceId, status: cancel.previousStatus },
      after: {
        instance_id: instanceId,
        dispatch_job_id: cancel.dispatchJobId,
        status: cancel.status,
      },
    },
    async () => ({ ok: true, data: cancel, updated_at: cancel.updatedAt })
  );
}
