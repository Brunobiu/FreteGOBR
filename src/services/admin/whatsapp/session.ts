/**
 * WhatsApp_Session — camada de serviço (TypeScript).
 *
 * Envolve as RPCs `whatsapp_get_session` / `whatsapp_set_session_status`
 * (migration 094) que materializam a sessão **única por instância**
 * (UNIQUE(instance_id)). A mesma sessão autenticada é reutilizada por todos os
 * módulos da instância — Disparo em Massa, Grupo, Programados, IA e Extrator
 * (Req 4.1, 4.2, 4.3, 4.6).
 *
 * - `getSession` é LEITURA: chama a RPC diretamente (gating SETTINGS_VIEW no
 *   servidor) e nunca audita.
 * - `connect` / `disconnect` / `setSessionStatus` são MUTAÇÕES: passam por
 *   `executeAdminMutation` (audit-by-construction, admin-patterns #1), sempre
 *   registrando o `instance_id` no log de auditoria. O gating SETTINGS_EDIT é
 *   reaplicado no servidor (camada 2 do RBAC).
 *
 * Este módulo apenas **expõe** o estado da sessão. O bloqueio de ações quando a
 * sessão não está `CONNECTED` (`Conecte o WhatsApp antes de iniciar o disparo.`,
 * Req 3.8/4.5) é responsabilidade dos chamadores (abas de disparo/extração/IA).
 * A interação real com a Evolution_API (QR/pareamento/logout) vive na Edge
 * Function `whatsapp-evolution-proxy` (task 7); aqui apenas transicionamos o
 * estado durável da sessão.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError } from './guards';

/** Domínio fechado de status da sessão (espelha `session_status` do SQL). */
export type SessionStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_PENDING' | 'CONNECTED' | 'EXPIRED';

/**
 * Forma da WhatsApp_Session exposta à UI. `qr_code` é transitório (presente
 * apenas durante `QR_PENDING`); `updated_at` é `null` enquanto não há linha de
 * sessão materializada (estado default `DISCONNECTED`).
 */
export interface WhatsAppSession {
  instanceId: string;
  status: SessionStatus;
  qrCode: string | null;
  lastConnectedAt: string | null;
  updatedAt: string | null;
}

/** Forma crua (snake_case) retornada pelas RPCs de sessão. */
interface WhatsAppSessionRow {
  instance_id: string;
  status: SessionStatus;
  qr_code: string | null;
  last_connected_at: string | null;
  updated_at: string | null;
}

/**
 * Canonical_Message (pt-BR) exibida quando uma ação de disparo/extração/
 * atendimento é solicitada com a sessão da Active_Instance fora de `CONNECTED`
 * (Req 3.8, 4.5).
 */
export const WHATSAPP_NOT_CONNECTED_MESSAGE =
  'Conecte o WhatsApp antes de iniciar o disparo.' as const;

/**
 * Guarda de "bloquear ações quando não `CONNECTED`" (Req 3.8, 4.5). Os
 * chamadores (abas de disparo/grupo/programados/IA/extrator) invocam esta
 * guarda antes de operar: lança a Canonical_Message
 * `Conecte o WhatsApp antes de iniciar o disparo.` quando a sessão não está
 * `CONNECTED`; é no-op quando está.
 *
 * @throws Error com `WHATSAPP_NOT_CONNECTED_MESSAGE` se `status !== 'CONNECTED'`.
 */
export function assertConnected(session: WhatsAppSession): void {
  if (session.status !== 'CONNECTED') {
    throw new Error(WHATSAPP_NOT_CONNECTED_MESSAGE);
  }
}

/** Converte a linha crua da RPC para o shape camelCase da camada de serviço. */
function mapSession(row: WhatsAppSessionRow): WhatsAppSession {
  return {
    instanceId: row.instance_id,
    status: row.status,
    qrCode: row.qr_code,
    lastConnectedAt: row.last_connected_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lê a sessão única da instância (status, QR e último instante conectado).
 * Quando ainda não há sessão registrada, a RPC retorna a forma default
 * `DISCONNECTED` (Req 4.1, 4.3). LEITURA — não audita.
 *
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function getSession(instanceId: string): Promise<WhatsAppSession> {
  const { data, error } = await supabase.rpc('whatsapp_get_session', {
    p_instance_id: instanceId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  return mapSession(data as WhatsAppSessionRow);
}

/**
 * Mutação base: UPSERT do status da sessão via RPC, embrulhada em
 * `executeAdminMutation` para garantir o audit log com `instance_id`.
 *
 * @param action     Action code (UPPER_SNAKE, inglês) gravado na auditoria.
 * @param instanceId Instância alvo (chave da sessão única).
 * @param status     Novo `SessionStatus`.
 * @param qrCode     QR transitório (apenas em `QR_PENDING`); ignorado/limpo ao
 *                   atingir `CONNECTED`.
 */
async function applySessionStatus(
  action: string,
  instanceId: string,
  status: SessionStatus,
  qrCode: string | null
): Promise<WhatsAppSession> {
  return executeAdminMutation(
    {
      action,
      targetType: 'whatsapp_sessions',
      targetId: instanceId,
      before: null,
      after: { instance_id: instanceId, status },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_set_session_status', {
        p_instance_id: instanceId,
        p_status: status,
        p_qr_code: qrCode,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }
      return mapSession(data as WhatsAppSessionRow);
    }
  );
}

/**
 * Define explicitamente o status da sessão (uso geral: ex.: o proxy Evolution
 * marca `QR_PENDING`/`CONNECTED`/`EXPIRED`). Mutação auditada com `instance_id`.
 */
export async function setSessionStatus(
  instanceId: string,
  status: SessionStatus,
  qrCode: string | null = null
): Promise<WhatsAppSession> {
  return applySessionStatus('WHATSAPP_SESSION_SET_STATUS', instanceId, status, qrCode);
}

/**
 * Inicia a conexão da sessão da instância, transicionando para `CONNECTING`
 * (Req 3.1). A leitura do QR e o pareamento real ocorrem via proxy Evolution
 * (task 7), que posteriormente promove a sessão a `QR_PENDING`/`CONNECTED`.
 * Mutação auditada com `instance_id`.
 */
export async function connect(instanceId: string): Promise<WhatsAppSession> {
  return applySessionStatus('WHATSAPP_SESSION_CONNECT', instanceId, 'CONNECTING', null);
}

/**
 * Desconecta a sessão da instância, transicionando para `DISCONNECTED`
 * (Req 3.6), sem afetar as demais instâncias. Mutação auditada com
 * `instance_id`.
 */
export async function disconnect(instanceId: string): Promise<WhatsAppSession> {
  return applySessionStatus('WHATSAPP_SESSION_DISCONNECT', instanceId, 'DISCONNECTED', null);
}
