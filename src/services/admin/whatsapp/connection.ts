/**
 * Conexão da WhatsApp_Session (Req 3, 4) — cliente da Edge Function
 * `whatsapp-evolution-proxy` (task 7.1).
 *
 * O QR/pareamento real e a consulta de estado vivem na Evolution API e são
 * intermediados EXCLUSIVAMENTE pela Edge Function `whatsapp-evolution-proxy`
 * (a Evolution_Api_Key nunca trafega ao browser — Req 3.7/18.7). Este módulo é
 * o wrapper TS fino dessa function: invoca via `supabase.functions.invoke`
 * (com o JWT do admin; a function revalida a permissão server-side) e devolve
 * o status + QR para a UI (`ConnectionCard`, task 20.2).
 *
 * A própria function persiste a transição de estado em `whatsapp_sessions` e
 * audita; este wrapper NÃO duplica isso. Em erro/indisponibilidade, devolve
 * `ok:false` com a Canonical_Message `Não foi possível conectar o WhatsApp.`
 * (Req 3.5) e status `DISCONNECTED` (não lança — a UI reage ao `ok`).
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import type { SessionStatus } from './session';

/** Canonical_Message (pt-BR) de falha/indisponibilidade da conexão (Req 3.5). */
export const WHATSAPP_CONNECT_FAILED_MESSAGE = 'Não foi possível conectar o WhatsApp.' as const;

/** Resultado de uma ação de conexão intermediada pelo proxy. */
export interface ConnectionResult {
  /** `true` se a ação foi aceita pela Evolution; `false` em erro/indisponível. */
  ok: boolean;
  /** Status corrente da sessão após a ação. */
  status: SessionStatus;
  /** QR (data URL base64) quando `QR_PENDING`; caso contrário `null`. */
  qr: string | null;
  /** Mensagem user-facing em pt-BR (presente quando `ok` é `false`). */
  message?: string;
}

/** Grupo do WhatsApp retornado pela listagem (cache da Evolution). */
export interface WhatsAppGroup {
  groupJid: string;
  name: string | null;
  participantCount: number | null;
}

type ProxyAction = 'connect' | 'qr' | 'status' | 'logout';

/** Coage um status cru do proxy a um `SessionStatus` válido (default DISCONNECTED). */
function toSessionStatus(value: unknown): SessionStatus {
  switch (value) {
    case 'CONNECTING':
    case 'QR_PENDING':
    case 'CONNECTED':
    case 'EXPIRED':
      return value;
    default:
      return 'DISCONNECTED';
  }
}

/**
 * Invoca o proxy para uma ação de conexão (`connect`/`qr`/`status`/`logout`).
 * Qualquer erro de transporte ou resposta `ok:false` é normalizado para um
 * `ConnectionResult` com a Canonical_Message; nunca lança.
 */
async function invokeConnection(action: ProxyAction, instanceId: string): Promise<ConnectionResult> {
  try {
    const { data, error } = await supabase.functions.invoke('whatsapp-evolution-proxy', {
      body: { action, instanceId },
    });

    if (error || typeof data !== 'object' || data === null) {
      return { ok: false, status: 'DISCONNECTED', qr: null, message: WHATSAPP_CONNECT_FAILED_MESSAGE };
    }

    const res = data as { ok?: unknown; status?: unknown; qr?: unknown; message?: unknown };
    if (res.ok !== true) {
      return {
        ok: false,
        status: toSessionStatus(res.status),
        qr: null,
        message: typeof res.message === 'string' ? res.message : WHATSAPP_CONNECT_FAILED_MESSAGE,
      };
    }

    return {
      ok: true,
      status: toSessionStatus(res.status),
      qr: typeof res.qr === 'string' && res.qr.length > 0 ? res.qr : null,
    };
  } catch {
    return { ok: false, status: 'DISCONNECTED', qr: null, message: WHATSAPP_CONNECT_FAILED_MESSAGE };
  }
}

/**
 * Inicia a conexão da instância e obtém o QR (Req 3.1-3.5): DISCONNECTED →
 * CONNECTING → QR_PENDING (com QR) ou CONNECTED (já pareado). Erro ⇒ `ok:false`
 * + Canonical_Message, mantendo DISCONNECTED.
 */
export function connectInstance(instanceId: string): Promise<ConnectionResult> {
  return invokeConnection('connect', instanceId);
}

/** Re-obtém o QR atual (ou confirma a conexão) sem reiniciar o pareamento. */
export function refreshQr(instanceId: string): Promise<ConnectionResult> {
  return invokeConnection('qr', instanceId);
}

/** Consulta e persiste o estado corrente da conexão na Evolution (Req 3.3). */
export function getConnectionStatus(instanceId: string): Promise<ConnectionResult> {
  return invokeConnection('status', instanceId);
}

/** Encerra a sessão na Evolution e marca DISCONNECTED (Req 3.6). */
export function disconnectInstance(instanceId: string): Promise<ConnectionResult> {
  return invokeConnection('logout', instanceId);
}

/**
 * Lista os WhatsApp_Groups da instância (cache da Evolution via proxy), exigindo
 * sessão `CONNECTED` (Req 12.1, 17.1). Em sessão não conectada ou
 * indisponibilidade, devolve lista vazia + a mensagem apropriada (não lança).
 */
export async function listInstanceGroups(
  instanceId: string
): Promise<{ ok: boolean; status: SessionStatus; groups: WhatsAppGroup[]; message?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('whatsapp-evolution-proxy', {
      body: { action: 'listGroups', instanceId },
    });

    if (error || typeof data !== 'object' || data === null) {
      return { ok: false, status: 'DISCONNECTED', groups: [], message: WHATSAPP_CONNECT_FAILED_MESSAGE };
    }

    const res = data as { ok?: unknown; status?: unknown; groups?: unknown; message?: unknown };
    if (res.ok !== true) {
      return {
        ok: false,
        status: toSessionStatus(res.status),
        groups: [],
        message: typeof res.message === 'string' ? res.message : WHATSAPP_CONNECT_FAILED_MESSAGE,
      };
    }

    const rawGroups = Array.isArray(res.groups) ? res.groups : [];
    const groups: WhatsAppGroup[] = rawGroups
      .map((g) => {
        const o = (typeof g === 'object' && g !== null ? g : {}) as Record<string, unknown>;
        const jid = o.group_jid;
        if (typeof jid !== 'string') return null;
        return {
          groupJid: jid,
          name: typeof o.name === 'string' ? o.name : null,
          participantCount: typeof o.participant_count === 'number' ? o.participant_count : null,
        };
      })
      .filter((g): g is WhatsAppGroup => g !== null);

    return { ok: true, status: toSessionStatus(res.status), groups };
  } catch {
    return { ok: false, status: 'DISCONNECTED', groups: [], message: WHATSAPP_CONNECT_FAILED_MESSAGE };
  }
}
