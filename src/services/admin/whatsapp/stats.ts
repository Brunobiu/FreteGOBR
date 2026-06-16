/**
 * Estatísticas e progresso de disparo (Req 11, 28) — lógica PURA + serviço de leitura.
 *
 * A parte PURA (`estimatedCompletionMs`, `progressPercent`) é determinística e
 * sem I/O, usada tanto pelas RPCs/serviços de leitura quanto pela UI para exibir
 * Dispatch_Statistics. São alvo de property tests (`fast-check`):
 * - `estimatedCompletionMs` → Property 11 (tarefa 2.10).
 * - `progressPercent`       → Property 12 (tarefa 2.12).
 *
 * A parte de SERVIÇO (`getDispatchStatistics`) é LEITURA: envolve a RPC
 * `whatsapp_get_dispatch_statistics` (migration 105, tarefa 14.1), que agrega os
 * contadores de `whatsapp_dispatch_recipients` por status escopados por
 * `(instance_id, dispatch_job_id)`, e reusa a função pura `estimatedCompletionMs`
 * para derivar o Estimated_Completion_Time (Req 28). Não muta nada ⇒ não audita.
 */

import { supabase } from '../../supabase';
import { mapInstanceGuardError } from './guards';

/**
 * Tempo estimado de conclusão do disparo, em **milissegundos** (Req 28.3, 28.4).
 *
 * Fórmula do design ("Statistics (Req 28)"):
 *   Estimated_Completion_Time = Dispatch_Recipients pending × Send_Interval
 *
 * O nome da função (`...Ms`) fixa a unidade de retorno em milissegundos. Como o
 * `Send_Interval` é informado em segundos (`intervalSec`, ver
 * `send_interval_sec` no schema), a conversão é:
 *
 *   resultado = pending × intervalSec × 1000
 *
 * Casos:
 * - `pending = 0` ⇒ retorna `0` (nada a enviar; Req 28.4).
 * - Entradas negativas ou não-finitas (NaN/Infinity) ⇒ tratadas como `0` para
 *   manter a função total e nunca produzir um ETA negativo ou inválido.
 *
 * @param pending     Quantidade de `Dispatch_Recipients` ainda pendentes (`>= 0`).
 * @param intervalSec Send_Interval em segundos (`> 0` no domínio válido).
 * @returns Tempo estimado de conclusão em milissegundos (`>= 0`).
 */
export function estimatedCompletionMs(pending: number, intervalSec: number): number {
  // Função total: entradas inválidas (negativas, NaN, Infinity) ⇒ ETA 0.
  if (
    !Number.isFinite(pending) ||
    !Number.isFinite(intervalSec) ||
    pending <= 0 ||
    intervalSec <= 0
  ) {
    return 0;
  }

  return pending * intervalSec * 1000;
}

/**
 * Percentual de progresso de um Dispatch_Job, como razão em `[0, 1]` (Req 11.4, 28.2).
 *
 * Conforme o design ("Property 12: Percentual de progresso é uma razão válida"):
 *
 *   progressPercent = processados / total
 *
 * onde `processados = SENT + FAILED + SKIPPED` — ou seja, todo destinatário que já
 * saiu do estado pendente/em envio. O chamador soma os três contadores e passa o
 * resultado em `processed`; `total` é o total de destinatários do job.
 *
 * Casos:
 * - `total <= 0` ⇒ retorna `0` (evita divisão por zero; job sem destinatários não
 *   tem progresso a exibir — Req 28.2).
 * - O resultado é sempre **clampado** ao intervalo `[0, 1]`, de forma que entradas
 *   inconsistentes (`processed` negativo ou maior que `total`) nunca produzam uma
 *   razão fora do domínio válido.
 * - Entradas não-finitas (NaN/Infinity) ⇒ tratadas como `0` para manter a função
 *   total.
 *
 * @param processed Destinatários já processados (`SENT + FAILED + SKIPPED`, `>= 0`).
 * @param total     Total de destinatários do job (`>= 0`).
 * @returns Razão de progresso no intervalo `[0, 1]`.
 */
export function progressPercent(processed: number, total: number): number {
  // Função total: entradas inválidas ou total não-positivo ⇒ sem progresso.
  if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0 || processed <= 0) {
    return 0;
  }

  const ratio = processed / total;

  // Clamp em [0, 1]: protege contra processed > total (estado inconsistente).
  if (ratio > 1) {
    return 1;
  }

  return ratio;
}

/* ========================================================================== *
 * Dispatch_Statistics por job — camada de serviço (LEITURA via RPC)          *
 *                                                                            *
 * Envolve a RPC `whatsapp_get_dispatch_statistics` (migration 105, task      *
 * 14.1). A RPC aplica gating SETTINGS_VIEW (camada 2 do RBAC, com log         *
 * negativo), anti-enumeração de instância e valida que o job pertence à       *
 * MESMA instância (job inexistente/cruzado => WHATSAPP_NOT_FOUND), agregando  *
 * os contadores de Dispatch_Recipients por status (Req 28.2, 28.6).          *
 *                                                                            *
 * É LEITURA (não mutação) => NÃO passa por `executeAdminMutation`. O          *
 * Estimated_Completion_Time é derivado AQUI reusando a função pura            *
 * `estimatedCompletionMs(pending, intervalSec)`, mantendo a fórmula em um     *
 * único lugar testável (Req 28.3, 28.4).                                     *
 * ========================================================================== */

/**
 * Dispatch_Statistics de um Dispatch_Job, como exposto à UI (camelCase). Os
 * contadores derivam exclusivamente de Dispatch_Recipients do `instance_id` da
 * Active_Instance (Req 28.6):
 * - `sentCount`      : enviados (status `SENT`) — total enviado (Req 28.2).
 * - `pendingCount`   : pendentes (status `PENDING`) — total pendente.
 * - `failedCount`    : com erro (status `FAILED`) — total com erro.
 * - `skippedCount`   : pulados (status `SKIPPED`).
 * - `completedCount` : concluídos = `SENT + FAILED + SKIPPED` — total concluído.
 * - `totalCount`     : total de destinatários do job.
 * - `estimatedCompletionMs` : Estimated_Completion_Time em ms (Req 28.3, 28.4),
 *   = `pendingCount × sendIntervalSec × 1000` (zero quando não há pendentes).
 */
export interface DispatchStatistics {
  jobId: string;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
  skippedCount: number;
  completedCount: number;
  totalCount: number;
  estimatedCompletionMs: number;
}

/** Forma crua (snake_case) retornada pela RPC `whatsapp_get_dispatch_statistics`. */
interface DispatchStatisticsRow {
  job_id: string;
  sent_count: number;
  pending_count: number;
  failed_count: number;
  skipped_count: number;
  completed_count: number;
  total_count: number;
  send_interval_sec: number;
}

/**
 * Lê as Dispatch_Statistics de um Dispatch_Job (enviado/pendente/concluído/erro
 * + Estimated_Completion_Time), escopadas por instância (Req 28.1, 28.2, 28.6).
 *
 * Chama a RPC `whatsapp_get_dispatch_statistics` (gating SETTINGS_VIEW no
 * servidor) e mapeia snake_case → camelCase. O Estimated_Completion_Time é
 * calculado reusando a função pura `estimatedCompletionMs` sobre o contador de
 * pendentes e o Send_Interval do job (Req 28.3, 28.4). LEITURA — não audita.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo das estatísticas).
 * @param jobId      Dispatch_Job cujas estatísticas serão lidas.
 * @returns As `DispatchStatistics` do job no shape camelCase.
 * @throws `Error` com a mensagem mapeada — anti-enumeração (Canonical_Message
 *   pt-BR) quando a instância/job é inexistente ou cruzado entre instâncias.
 */
export async function getDispatchStatistics(
  instanceId: string,
  jobId: string
): Promise<DispatchStatistics> {
  const { data, error } = await supabase.rpc('whatsapp_get_dispatch_statistics', {
    p_instance_id: instanceId,
    p_job_id: jobId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const row = data as DispatchStatisticsRow;

  return {
    jobId: row.job_id,
    sentCount: row.sent_count,
    pendingCount: row.pending_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    completedCount: row.completed_count,
    totalCount: row.total_count,
    // Reusa a função pura — fórmula única e testável (Req 28.3, 28.4).
    estimatedCompletionMs: estimatedCompletionMs(row.pending_count, row.send_interval_sec),
  };
}
