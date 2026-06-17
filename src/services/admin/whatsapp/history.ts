/**
 * Camada de serviço do Campaign_History (histórico de campanhas/disparos) —
 * I/O via RPC, escopada por `instance_id` da Active_Instance (Req 20).
 *
 * Espelha o estilo de `dispatch.ts`: leituras chamam a RPC e mapeiam erros pela
 * rota de anti-enumeração (`guards.ts`); a escrita (Duplicar/Reenviar/Reutilizar)
 * passa por `executeAdminMutation` (audit-by-construction, admin-patterns #1),
 * sempre registrando o `instance_id` (Req 18.6) e o `source_job_id` da campanha
 * de origem (Req 20.7, 20.12).
 *
 * Contraparte server-side: migration 107 (`whatsapp_list_campaign_history`,
 * `whatsapp_get_campaign_detail`, `whatsapp_duplicate_campaign`). As RPCs são
 * `SECURITY DEFINER` e revalidam o RBAC no servidor (camada 2): `SETTINGS_VIEW`
 * nas leituras (Req 20.8) e `SETTINGS_EDIT` na escrita. Job inexistente ou
 * cruzado entre instâncias ⇒ `WHATSAPP_NOT_FOUND` (P0001), traduzido aqui para a
 * Canonical_Message anti-enumeração `Não foi possível concluir a operação.`
 * (Req 20.6, 2.8, 30.8).
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 *
 * _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12_
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError } from './guards';
import type { DistributionMode } from './distribution';
import type {
  DispatchKind,
  DispatchJobStatus,
  MutationResult,
} from './dispatch';

/* ========================================================================== *
 * Tipos de leitura — Campaign_History                                        *
 * ========================================================================== */

/**
 * Item do Campaign_History (campanha JÁ EXECUTADA da instância), como exposto à
 * UI (camelCase). Estados terminais preservados (`COMPLETED`/`CANCELLED`/
 * `FAILED` — Req 20.1) e em andamento (`RUNNING`/`PAUSED`); `DRAFT`/`QUEUED`
 * ficam de fora. Cada item traz data/hora, qtd de contatos, conteúdos
 * utilizados, estado final, total enviado/erro e o Execution_Duration (Req 20.2,
 * 20.9, 20.10).
 */
export interface CampaignHistoryItem {
  id: string;
  instanceId: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distributionMode: DistributionMode | null;
  blockSize: number | null;
  sendIntervalSec: number;
  executionQuota: number;
  /** Quantidade de contatos (total de destinatários materializados). */
  totalCount: number;
  /** Total enviado com sucesso (recipients `SENT`). */
  sentCount: number;
  /** Total com erro (recipients `FAILED`). */
  failedCount: number;
  /** Conteúdos utilizados (Contents distintos referenciados). */
  contentCount: number;
  /** Campanha de origem, quando este disparo nasceu de uma duplicação/reenvio. */
  sourceJobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Execution_Duration em segundos (`completed_at - started_at`); `null` quando
   * o disparo ainda não terminou ou não iniciou (Req 20.10).
   */
  executionDurationSec: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Forma crua (snake_case) de um item do Campaign_History retornado pela RPC. */
interface RawCampaignHistoryItem {
  id: string;
  instance_id: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distribution_mode: DistributionMode | null;
  block_size: number | null;
  send_interval_sec: number;
  execution_quota: number;
  total_count: number;
  sent_count: number;
  failed_count: number;
  content_count: number;
  source_job_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  execution_duration_sec: number | null;
  created_at: string;
  updated_at: string;
}

/** Mídia de um Content utilizado no disparo (detalhe do Campaign_History). */
export interface CampaignContentMedia {
  id: string;
  mediaType: string;
  mimeType: string | null;
  storagePath: string;
}

/** Content utilizado no disparo (com mídias), exposto no detalhe (Req 20.3). */
export interface CampaignContent {
  id: string;
  body: string | null;
  position: number;
  isValid: boolean;
  media: CampaignContentMedia[];
}

/** Destinatário do disparo com o resultado por recipient (Req 20.3). */
export interface CampaignRecipient {
  id: string;
  targetKind: string;
  phone: string | null;
  groupJid: string | null;
  recipientData: unknown;
  assignedContentId: string | null;
  seq: number;
  status: string;
  sentAt: string | null;
  /** Motivo da falha (sempre pt-BR e sem segredos, garantido na escrita). */
  failureReason: string | null;
}

/**
 * Detalhe completo de um item do Campaign_History (config + resultados +
 * Execution_Duration + Contents com mídias + destinatários), escopado à
 * Active_Instance (Req 20.3, 20.9, 20.10).
 */
export interface CampaignDetail {
  id: string;
  instanceId: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distributionMode: DistributionMode | null;
  blockSize: number | null;
  sendIntervalSec: number;
  executionQuota: number;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  pendingCount: number;
  sourceJobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  executionDurationSec: number | null;
  createdAt: string;
  updatedAt: string;
  contents: CampaignContent[];
  recipients: CampaignRecipient[];
}

/** Forma crua (snake_case) das mídias de um Content no detalhe. */
interface RawCampaignContentMedia {
  id: string;
  media_type: string;
  mime_type: string | null;
  storage_path: string;
}

/** Forma crua (snake_case) de um Content utilizado, no detalhe. */
interface RawCampaignContent {
  id: string;
  body: string | null;
  position: number;
  is_valid: boolean;
  media: RawCampaignContentMedia[];
}

/** Forma crua (snake_case) de um destinatário, no detalhe. */
interface RawCampaignRecipient {
  id: string;
  target_kind: string;
  phone: string | null;
  group_jid: string | null;
  recipient_data: unknown;
  assigned_content_id: string | null;
  seq: number;
  status: string;
  sent_at: string | null;
  failure_reason: string | null;
}

/** Forma crua (snake_case) do detalhe completo retornado pela RPC. */
interface RawCampaignDetail {
  id: string;
  instance_id: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distribution_mode: DistributionMode | null;
  block_size: number | null;
  send_interval_sec: number;
  execution_quota: number;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  pending_count: number;
  source_job_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  execution_duration_sec: number | null;
  created_at: string;
  updated_at: string;
  contents: RawCampaignContent[];
  recipients: RawCampaignRecipient[];
}

/** Converte um item cru do Campaign_History para o shape camelCase. */
function mapHistoryItem(row: RawCampaignHistoryItem): CampaignHistoryItem {
  return {
    id: row.id,
    instanceId: row.instance_id,
    kind: row.kind,
    status: row.status,
    distributionMode: row.distribution_mode,
    blockSize: row.block_size,
    sendIntervalSec: row.send_interval_sec,
    executionQuota: row.execution_quota,
    totalCount: row.total_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    contentCount: row.content_count,
    sourceJobId: row.source_job_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    executionDurationSec: row.execution_duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Converte a mídia crua de um Content para o shape camelCase. */
function mapContentMedia(row: RawCampaignContentMedia): CampaignContentMedia {
  return {
    id: row.id,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
  };
}

/** Converte um Content cru (com mídias) para o shape camelCase. */
function mapCampaignContent(row: RawCampaignContent): CampaignContent {
  return {
    id: row.id,
    body: row.body,
    position: row.position,
    isValid: row.is_valid,
    media: (row.media ?? []).map(mapContentMedia),
  };
}

/** Converte um destinatário cru (com resultado) para o shape camelCase. */
function mapCampaignRecipient(row: RawCampaignRecipient): CampaignRecipient {
  return {
    id: row.id,
    targetKind: row.target_kind,
    phone: row.phone,
    groupJid: row.group_jid,
    recipientData: row.recipient_data,
    assignedContentId: row.assigned_content_id,
    seq: row.seq,
    status: row.status,
    sentAt: row.sent_at,
    failureReason: row.failure_reason,
  };
}

/** Converte o detalhe cru completo para o shape camelCase. */
function mapCampaignDetail(row: RawCampaignDetail): CampaignDetail {
  return {
    id: row.id,
    instanceId: row.instance_id,
    kind: row.kind,
    status: row.status,
    distributionMode: row.distribution_mode,
    blockSize: row.block_size,
    sendIntervalSec: row.send_interval_sec,
    executionQuota: row.execution_quota,
    totalCount: row.total_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    pendingCount: row.pending_count,
    sourceJobId: row.source_job_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    executionDurationSec: row.execution_duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contents: (row.contents ?? []).map(mapCampaignContent),
    recipients: (row.recipients ?? []).map(mapCampaignRecipient),
  };
}

/* ========================================================================== *
 * Leituras — Campaign_History (gating SETTINGS_VIEW revalidado no servidor)  *
 * ========================================================================== */

/** Opções de filtro/paginação da listagem do Campaign_History. */
export interface CampaignHistoryListOptions {
  /** Filtra por um único Status executado; `null`/omitido = todos. */
  status?: DispatchJobStatus | null;
  /** Tamanho da página (default 50 no backend; cap hard de 200). */
  limit?: number | null;
  /** Deslocamento da página (default 0). */
  offset?: number | null;
}

/**
 * Lista o Campaign_History da Active_Instance via RPC
 * `whatsapp_list_campaign_history` (Req 20.1, 20.2, 20.6, 20.8, 20.9, 20.10).
 *
 * Retorna apenas os Dispatch_Jobs JÁ EXECUTADOS (terminais preservados +
 * em andamento), cada um com data/hora, qtd de contatos, conteúdos utilizados,
 * estado final, total enviado/erro e o Execution_Duration. A RPC revalida
 * `SETTINGS_VIEW` no servidor antes de retornar qualquer registro.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo, Req 20.6).
 * @param options    Filtro de Status e paginação (`limit`/`offset`).
 * @returns Lista de `CampaignHistoryItem` (vazia quando não há histórico).
 * @throws `Error` com Canonical_Message anti-enumeração quando a instância é
 *         inexistente/cruzada (`WHATSAPP_NOT_FOUND`); `permission_denied` quando
 *         o gating server-side nega `SETTINGS_VIEW`.
 */
export async function listCampaignHistory(
  instanceId: string,
  options: CampaignHistoryListOptions = {}
): Promise<CampaignHistoryItem[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_campaign_history', {
    p_instance_id: instanceId,
    p_status: options.status ?? null,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  });
  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = (data ?? []) as RawCampaignHistoryItem[];
  return rows.map(mapHistoryItem);
}

/**
 * Carrega o detalhe de um item do Campaign_History via RPC
 * `whatsapp_get_campaign_detail` (Req 20.3, 20.9, 20.10), ESCOPADO à instância
 * (Req 20.6). A RPC revalida `SETTINGS_VIEW` no servidor.
 *
 * Job inexistente OU de outra instância (cruzado) ⇒ a RPC levanta
 * `WHATSAPP_NOT_FOUND` e aqui o erro vira a Canonical_Message anti-enumeração
 * `Não foi possível concluir a operação.` — resposta indistinguível, sem
 * revelar existência (Req 2.8, 30.8).
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo).
 * @param jobId      Dispatch_Job (item do Campaign_History) a detalhar.
 * @returns `CampaignDetail` (config + resultados + Contents + destinatários).
 * @throws `Error` com Canonical_Message anti-enumeração para job inexistente/
 *         cruzado; `permission_denied` quando o gating server-side nega.
 */
export async function getCampaignDetail(
  instanceId: string,
  jobId: string
): Promise<CampaignDetail> {
  const { data, error } = await supabase.rpc('whatsapp_get_campaign_detail', {
    p_instance_id: instanceId,
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  return mapCampaignDetail(data as RawCampaignDetail);
}

/* ========================================================================== *
 * Escrita — Duplicar / Reenviar / Reutilizar como nova (gating SETTINGS_EDIT)*
 *                                                                            *
 * Envolve a RPC `whatsapp_duplicate_campaign` (migration 107), que cria um    *
 * NOVO Dispatch_Job copiando Contents (novas linhas + mídias), destinatários  *
 * e configurações da campanha de origem, gravando `source_job_id` e           *
 * preservando INTACTO o Dispatch_Job histórico original (Req 20.4, 20.5,      *
 * 20.11). O AUDIT (Req 20.7, 20.12) é responsabilidade desta camada: a RPC é  *
 * envolvida por `executeAdminMutation`, registrando o `instance_id` (Req      *
 * 18.6) e o `source_job_id` (campanha de origem).                            *
 * ========================================================================== */

/**
 * Modo de criação a partir de um item do Campaign_History (domínio fechado,
 * espelha a RPC):
 * - `DUPLICATE` ⇒ novo Dispatch_Job em `DRAFT` (Req 20.4);
 * - `REUSE`     ⇒ novo Dispatch_Job em `DRAFT` para edição (Req 20.11);
 * - `RESEND`    ⇒ novo Dispatch_Job em `QUEUED` para reprocessamento (Req 20.5).
 */
export type DuplicateCampaignMode = 'DUPLICATE' | 'REUSE' | 'RESEND';

/** Action codes de audit por modo (inglês, UPPER_SNAKE — admin-patterns #1). */
const DUPLICATE_AUDIT_ACTION: Record<DuplicateCampaignMode, string> = {
  DUPLICATE: 'WHATSAPP_CAMPAIGN_DUPLICATE',
  REUSE: 'WHATSAPP_CAMPAIGN_REUSE',
  RESEND: 'WHATSAPP_CAMPAIGN_RESEND',
};

/**
 * Novo Dispatch_Job criado a partir de uma campanha do Campaign_History, como
 * exposto à UI (camelCase). Carrega a origem (`sourceJobId`) e o `mode` aplicado.
 */
export interface DuplicatedCampaign {
  id: string;
  instanceId: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distributionMode: DistributionMode | null;
  blockSize: number | null;
  sendIntervalSec: number;
  executionQuota: number;
  /** Quantidade de destinatários copiados para o novo job. */
  totalCount: number;
  /** Campanha de origem (Dispatch_Job histórico preservado). */
  sourceJobId: string;
  /** Modo aplicado na criação (`DUPLICATE`/`REUSE`/`RESEND`). */
  mode: DuplicateCampaignMode;
  createdAt: string;
  updatedAt: string;
}

/** Forma crua (snake_case) do novo Dispatch_Job retornado pela RPC. */
interface RawDuplicatedCampaign {
  id: string;
  instance_id: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distribution_mode: DistributionMode | null;
  block_size: number | null;
  send_interval_sec: number;
  execution_quota: number;
  total_count: number;
  source_job_id: string;
  mode: DuplicateCampaignMode;
  created_at: string;
  updated_at: string;
}

/** Converte o novo Dispatch_Job cru da RPC para o shape camelCase. */
function mapDuplicatedCampaign(row: RawDuplicatedCampaign): DuplicatedCampaign {
  return {
    id: row.id,
    instanceId: row.instance_id,
    kind: row.kind,
    status: row.status,
    distributionMode: row.distribution_mode,
    blockSize: row.block_size,
    sendIntervalSec: row.send_interval_sec,
    executionQuota: row.execution_quota,
    totalCount: row.total_count,
    sourceJobId: row.source_job_id,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Cria um novo Dispatch_Job a partir de um item do Campaign_History via RPC
 * `whatsapp_duplicate_campaign` (Req 20.4, 20.5, 20.11), preservando INTACTO o
 * Dispatch_Job histórico de origem.
 *
 * Modos: `DUPLICATE`/`REUSE` ⇒ novo job em `DRAFT`; `RESEND` ⇒ novo job em
 * `QUEUED` para reprocessamento. A RPC revalida `SETTINGS_EDIT` no servidor.
 *
 * Audit (Req 20.7, 20.12): a operação passa por `executeAdminMutation`,
 * registrando o `instance_id` (Req 18.6) e o `source_job_id` (campanha de
 * origem). A action de audit varia por modo (DUPLICATE/REUSE/RESEND).
 *
 * Origem inexistente/cruzada ⇒ `WHATSAPP_NOT_FOUND` traduzido para a
 * Canonical_Message anti-enumeração `Não foi possível concluir a operação.`
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo, Req 20.6).
 * @param jobId      Dispatch_Job de ORIGEM (item do Campaign_History).
 * @param mode       `DUPLICATE` (default), `REUSE` ou `RESEND`.
 * @returns `MutationResult<DuplicatedCampaign>` — `{ ok, data, updated_at }`.
 * @throws `Error` com Canonical_Message anti-enumeração para origem inexistente/
 *         cruzada; `permission_denied` quando o gating server-side nega.
 */
export async function duplicateCampaign(
  instanceId: string,
  jobId: string,
  mode: DuplicateCampaignMode = 'DUPLICATE'
): Promise<MutationResult<DuplicatedCampaign>> {
  return executeAdminMutation(
    {
      action: DUPLICATE_AUDIT_ACTION[mode],
      targetType: 'whatsapp_dispatch_jobs',
      targetId: jobId,
      // Origem da operação: instância + campanha de origem (Req 20.7, 20.12).
      before: { instance_id: instanceId, source_job_id: jobId, mode },
      after: {
        instance_id: instanceId,
        source_job_id: jobId,
        mode,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_duplicate_campaign', {
        p_instance_id: instanceId,
        p_job_id: jobId,
        p_mode: mode,
      });
      if (error) {
        throw new Error(mapInstanceGuardError(error));
      }

      const campaign = mapDuplicatedCampaign(data as RawDuplicatedCampaign);
      return { ok: true, data: campaign, updated_at: campaign.updatedAt };
    }
  );
}
