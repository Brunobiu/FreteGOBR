/**
 * Execution_Queue (Req 22) — camada de serviço de LEITURA.
 *
 * Envolve a RPC `whatsapp_get_execution_queue` (migration 113), que retorna os
 * Dispatch_Jobs da Active_Instance em estados de fila + os Scheduled_Dispatches
 * pendentes (grupo `SCHEDULED`), escopados por `instance_id` e revalidando
 * `SETTINGS_VIEW` no servidor (Req 22.4, 22.6). É LEITURA ⇒ não audita.
 *
 * O mapa de rótulos exibidos ao Admin_User (Req 22.8) vive AQUI (camada de
 * serviço): Aguardando→`QUEUED`, Em execução→`RUNNING`, Pausada→`PAUSED`,
 * Agendada→Scheduled_Dispatch, Concluída→`COMPLETED`, Cancelada→`CANCELLED`,
 * Erro→`FAILED`. O progresso reusa a função pura `progressPercent` (stats.ts).
 *
 * Identifiers/codes em inglês; rótulos user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { mapInstanceGuardError } from './guards';
import { progressPercent } from './stats';
import type { DispatchKind } from './dispatch';

/**
 * Grupo de estado da fila (Req 22.1, 22.8). `SCHEDULED` representa os
 * Scheduled_Dispatches pendentes (cujo Dispatch_Job está em `DRAFT`); os demais
 * espelham o `dispatch_status` do job.
 */
export type QueueGroup =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/**
 * Mapa canônico grupo → rótulo pt-BR exibido ao Admin_User (Req 22.8). Fonte
 * única de verdade dos rótulos da fila (reusada pela UI da task 20.11).
 */
export const QUEUE_GROUP_LABELS: Record<QueueGroup, string> = {
  QUEUED: 'Aguardando',
  RUNNING: 'Em execução',
  PAUSED: 'Pausada',
  SCHEDULED: 'Agendada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  FAILED: 'Erro',
};

/** Item da Execution_Queue, como exposto à UI (camelCase). */
export interface ExecutionQueueItem {
  jobId: string;
  /** Presente apenas em itens `SCHEDULED` (para cancelar o agendamento). */
  scheduledId: string | null;
  queueGroup: QueueGroup;
  /** Rótulo pt-BR derivado de `QUEUE_GROUP_LABELS` (Req 22.8). */
  label: string;
  kind: DispatchKind;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  /** Progresso em `[0, 1]` = (SENT+FAILED+SKIPPED)/total (Req 22.2). */
  progress: number;
  /** Data/hora relevante (início, agendamento ou conclusão — Req 22.2), ISO ou null. */
  relevantAt: string | null;
  updatedAt: string;
}

/** Forma crua (snake_case) de um item retornado pela RPC. */
interface RawQueueItem {
  job_id: string;
  scheduled_id: string | null;
  queue_group: QueueGroup;
  kind: DispatchKind;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  send_interval_sec: number;
  relevant_at: string | null;
  updated_at: string;
}

function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** Rótulo pt-BR do grupo (fallback para o próprio código se desconhecido). */
function labelFor(group: QueueGroup): string {
  return QUEUE_GROUP_LABELS[group] ?? group;
}

function mapQueueItem(row: RawQueueItem): ExecutionQueueItem {
  const total = toCount(row.total_count);
  const sent = toCount(row.sent_count);
  const failed = toCount(row.failed_count);
  const skipped = toCount(row.skipped_count);
  return {
    jobId: row.job_id,
    scheduledId: row.scheduled_id ?? null,
    queueGroup: row.queue_group,
    label: labelFor(row.queue_group),
    kind: row.kind,
    totalCount: total,
    sentCount: sent,
    failedCount: failed,
    skippedCount: skipped,
    // Processados = SENT + FAILED + SKIPPED (Req 22.2 / Property 12).
    progress: progressPercent(sent + failed + skipped, total),
    relevantAt: row.relevant_at ?? null,
    updatedAt: row.updated_at,
  };
}

/**
 * Lê a Execution_Queue da Active_Instance (Req 22.1, 22.2, 22.8): jobs em
 * estados de fila + agendados pendentes, com rótulo pt-BR, progresso e data
 * relevante. Via RPC `whatsapp_get_execution_queue` (gating `SETTINGS_VIEW`).
 * LEITURA — não audita.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo — Req 22.4).
 * @returns Itens da fila (vazio quando não há), já com rótulo e progresso.
 * @throws `Error` com a mensagem mapeada — anti-enumeração (Canonical_Message
 *   pt-BR) em instância inválida; `permission_denied` quando falta `SETTINGS_VIEW`.
 */
export async function getExecutionQueue(instanceId: string): Promise<ExecutionQueueItem[]> {
  const { data, error } = await supabase.rpc('whatsapp_get_execution_queue', {
    p_instance_id: instanceId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = Array.isArray(data) ? (data as RawQueueItem[]) : [];
  return rows.map(mapQueueItem);
}
