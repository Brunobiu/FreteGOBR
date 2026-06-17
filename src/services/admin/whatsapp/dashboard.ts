/**
 * Instance_Dashboard (Req 19) — camada de serviço de LEITURA.
 *
 * Envolve a RPC `whatsapp_get_dashboard` (migration 113), que retorna TODOS os
 * contadores operacionais do dia em um único round-trip atômico, escopados pelo
 * `instance_id` da Active_Instance e revalidando `SETTINGS_VIEW` no servidor
 * (Req 19.8, 19.9). É LEITURA ⇒ NÃO passa por `executeAdminMutation`.
 *
 * Decisão de design (vs. "Promise.allSettled por bloco" da admin-patterns #6):
 * todos os contadores compartilham a MESMA fonte (o banco) e o MESMO gate de
 * permissão, então uma leitura atômica é mais eficiente, evita leitura
 * "rasgada" entre blocos e concentra a precedência de `permission_denied` num
 * único ponto. A degradação por bloco fica na UI (`InstanceDashboard`, task
 * 20.3): em falha da leitura, exibe um erro com retry — sem dados parciais
 * inconsistentes.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { mapInstanceGuardError } from './guards';

/** Status de conexão da WhatsApp_Session (espelho do domínio `session_status`). */
export type WhatsAppConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_PENDING'
  | 'CONNECTED'
  | 'EXPIRED';

/**
 * Indicadores operacionais do dia da Active_Instance (Req 19.1). Todos os
 * contadores derivam exclusivamente de dados do `instance_id` (Req 19.8); os de
 * "hoje" usam o dia corrente no fuso America/Sao_Paulo (produto pt-BR).
 */
export interface InstanceDashboard {
  /** Status da conexão (Req 19.1). */
  connectionStatus: WhatsAppConnectionStatus;
  /** Mensagens enviadas hoje (recipients `SENT` no dia corrente — Req 19.2). */
  sentToday: number;
  /** Disparos em andamento (jobs `RUNNING` — Req 19.10). */
  inProgress: number;
  /** Mensagens agendadas (Scheduled_Dispatches pendentes futuros — Req 19.5). */
  scheduled: number;
  /** Disparos concluídos hoje (jobs `COMPLETED` no dia corrente — Req 19.11). */
  completedToday: number;
  /** Mensagens com erro (recipients `FAILED` — Req 19.3). */
  errored: number;
  /** Total na fila atual (jobs `QUEUED` + `RUNNING` — Req 19.4). */
  queueCurrent: number;
  /** Respostas recebidas hoje (mensagens INBOUND no dia corrente — Req 19.12). */
  repliesReceived: number;
  /** Atendimentos ativos (Conversations em modo ativo — Req 19.13). */
  activeConversations: number;
}

/** Forma crua (snake_case) retornada pela RPC `whatsapp_get_dashboard`. */
interface RawDashboard {
  connection_status: WhatsAppConnectionStatus;
  sent_today: number;
  in_progress: number;
  scheduled: number;
  completed_today: number;
  errored: number;
  queue_current: number;
  replies_received: number;
  active_conversations: number;
}

/** Coage um contador cru a inteiro `>= 0` (defensivo contra null/strings). */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Lê os contadores do Instance_Dashboard da Active_Instance (Req 19), via RPC
 * `whatsapp_get_dashboard` (gating `SETTINGS_VIEW` no servidor). Mapeia
 * snake_case → camelCase. LEITURA — não audita.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo dos contadores).
 * @returns Os contadores do dashboard no shape camelCase.
 * @throws `Error` com a mensagem mapeada — anti-enumeração (Canonical_Message
 *   pt-BR) quando a instância é inexistente/cruzada; `permission_denied`
 *   propagado quando falta `SETTINGS_VIEW`.
 */
export async function getDashboard(instanceId: string): Promise<InstanceDashboard> {
  const { data, error } = await supabase.rpc('whatsapp_get_dashboard', {
    p_instance_id: instanceId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const row = (data ?? {}) as Partial<RawDashboard>;

  return {
    connectionStatus: (row.connection_status as WhatsAppConnectionStatus) ?? 'DISCONNECTED',
    sentToday: toCount(row.sent_today),
    inProgress: toCount(row.in_progress),
    scheduled: toCount(row.scheduled),
    completedToday: toCount(row.completed_today),
    errored: toCount(row.errored),
    queueCurrent: toCount(row.queue_current),
    repliesReceived: toCount(row.replies_received),
    activeConversations: toCount(row.active_conversations),
  };
}
