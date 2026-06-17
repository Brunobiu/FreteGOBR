/**
 * Error_Log (Req 23.2, 23.8) — camada de serviço de LEITURA.
 *
 * Envolve a RPC `whatsapp_get_error_log` (migration 113), que lista os
 * Dispatch_Recipients `FAILED` de um Dispatch_Job da Active_Instance com o
 * Contact_Number e o `failure_reason`, escopados por `instance_id` e
 * revalidando `SETTINGS_VIEW` no servidor (Req 23.7). É LEITURA ⇒ não audita.
 *
 * O `failure_reason` é gravado pelo Job_Worker já em pt-BR e sem segredos
 * (Req 23.8) — esta camada apenas o repassa. A ação "Reenviar apenas os que
 * falharam" (Req 23.3) é a mutação `resendFailed` (dispatch.ts, task 11.5),
 * separada desta leitura.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { mapInstanceGuardError } from './guards';

/** Tipo de alvo do destinatário (espelho do `target_kind` do SQL). */
export type RecipientTargetKind = 'CONTACT' | 'GROUP';

/** Entrada do Error_Log: um Dispatch_Recipient `FAILED` (camelCase). */
export interface ErrorLogEntry {
  recipientId: string;
  targetKind: RecipientTargetKind;
  /** Telefone do contato (quando `CONTACT`). */
  phone: string | null;
  /** JID do grupo (quando `GROUP`). */
  groupJid: string | null;
  /** Número/identificador exibível: `phone` (CONTACT) ou `group_jid` (GROUP). */
  contactNumber: string | null;
  /** Motivo da falha em pt-BR, sem segredos (Req 23.8). */
  failureReason: string | null;
  /** Ordem determinística do destinatário no job. */
  seq: number;
}

/** Forma crua (snake_case) de uma entrada retornada pela RPC. */
interface RawErrorLogEntry {
  recipient_id: string;
  target_kind: RecipientTargetKind;
  phone: string | null;
  group_jid: string | null;
  failure_reason: string | null;
  seq: number;
}

function mapEntry(row: RawErrorLogEntry): ErrorLogEntry {
  const targetKind: RecipientTargetKind = row.target_kind === 'GROUP' ? 'GROUP' : 'CONTACT';
  const contactNumber = targetKind === 'GROUP' ? row.group_jid : row.phone;
  return {
    recipientId: row.recipient_id,
    targetKind,
    phone: row.phone ?? null,
    groupJid: row.group_jid ?? null,
    contactNumber: contactNumber ?? null,
    failureReason: row.failure_reason ?? null,
    seq: row.seq,
  };
}

/**
 * Lê o Error_Log de um Dispatch_Job da Active_Instance (Req 23.2): os
 * Dispatch_Recipients `FAILED` com Contact_Number e `failure_reason`. Via RPC
 * `whatsapp_get_error_log` (gating `SETTINGS_VIEW`; job inexistente/cruzado ⇒
 * anti-enumeração). LEITURA — não audita.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo — Req 23.7).
 * @param jobId      Dispatch_Job cujos destinatários `FAILED` serão listados.
 * @returns Entradas `FAILED` (vazio quando não há), ordenadas por `seq`.
 * @throws `Error` com a mensagem mapeada — anti-enumeração (Canonical_Message
 *   pt-BR) quando instância/job é inexistente/cruzado; `permission_denied`
 *   quando falta `SETTINGS_VIEW`.
 */
export async function getErrorLog(instanceId: string, jobId: string): Promise<ErrorLogEntry[]> {
  const { data, error } = await supabase.rpc('whatsapp_get_error_log', {
    p_instance_id: instanceId,
    p_job_id: jobId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = Array.isArray(data) ? (data as RawErrorLogEntry[]) : [];
  return rows.map(mapEntry);
}
