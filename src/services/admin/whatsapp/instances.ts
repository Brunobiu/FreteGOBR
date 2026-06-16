/**
 * instances.ts — leitura das WhatsApp_Instances do painel admin.
 *
 * Camada de serviço (TypeScript) para a RPC `whatsapp_list_instances`
 * (migration 093). A listagem é **data-driven**: a RPC itera as instâncias
 * HABILITADAS de `whatsapp_instances` (sem quantidade fixa / sem `5` hardcoded),
 * retornando, por instância, `id`, `label`, `display_order` e o `status` de
 * conexão derivado de `whatsapp_sessions` (`DISCONNECTED` quando não há sessão).
 *
 * Esta é uma operação de LEITURA: chama a RPC diretamente (sem
 * `executeAdminMutation`, que é reservado a mutações — admin-patterns #1). O
 * gating server-side (`SETTINGS_VIEW`) vive na própria RPC.
 *
 * Erros são mapeados por `mapInstanceGuardError` (reuso de `guards.ts`) para
 * preservar a anti-enumeração canônica em pt-BR, sem vazar detalhes.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 *
 * _Requirements: 2.1, 2.2, 29.1, 29.2, 29.7_
 */

import { supabase } from '../../supabase';
import { mapInstanceGuardError } from './guards';

/**
 * Domínio fechado de status de conexão de uma instância (espelha o domínio SQL
 * `session_status` da migration 092). `DISCONNECTED` é o valor efetivo quando a
 * instância ainda não possui sessão registrada.
 */
export type WhatsAppInstanceStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_PENDING'
  | 'CONNECTED'
  | 'EXPIRED';

/** Uma WhatsApp_Instance habilitada, como exibida no Instance_Panel. */
export interface WhatsAppInstance {
  /** uuid da instância. */
  id: string;
  /** Rótulo exibido no painel ("WhatsApp 1", ...). */
  label: string;
  /** Ordem de exibição no painel (não é limite). */
  displayOrder: number;
  /** Status de conexão derivado da sessão única da instância. */
  status: WhatsAppInstanceStatus;
}

/** Forma crua de cada item retornado pela RPC `whatsapp_list_instances`. */
interface RawInstanceRow {
  id: string;
  label: string;
  display_order: number;
  status: WhatsAppInstanceStatus;
}

/**
 * Lista as WhatsApp_Instances habilitadas do painel, ordenadas por
 * `displayOrder`.
 *
 * Chama a RPC `whatsapp_list_instances` (data-driven, sem quantidade fixa) e
 * normaliza o retorno para `WhatsAppInstance[]`. A ordenação por `display_order`
 * já é garantida pela RPC; reforçamos no cliente para robustez.
 *
 * @returns A lista de instâncias (id, label, displayOrder, status).
 * @throws com a mensagem mapeada (anti-enumeração quando aplicável).
 */
export async function listInstances(): Promise<WhatsAppInstance[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_instances');

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = (data ?? []) as RawInstanceRow[];

  return rows
    .map((row) => ({
      id: row.id,
      label: row.label,
      displayOrder: row.display_order,
      status: row.status,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
