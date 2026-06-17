/**
 * Camada de serviço de Drafts (rascunhos de disparo) do WhatsApp_Module
 * (task 11.3, Req 21.1–21.8).
 *
 * Drafts são Dispatch_Jobs no status `DRAFT`: salvos sem habilitar o
 * Job_Worker (que só reclama `QUEUED`/`RUNNING`), editáveis enquanto
 * permanecem `DRAFT`, e iniciados (DRAFT→QUEUED) com revalidação no backend.
 *
 * Este módulo NÃO duplica o motor de disparo — REUSA as RPCs já existentes,
 * espelhando exatamente o estilo de `dispatch.ts`:
 *  - SALVAR como Draft  → `whatsapp_create_dispatch_job(..., status='DRAFT')`
 *    (migration 099), via `createDispatchJob` desta camada — persiste o job em
 *    `DRAFT` sem habilitar o worker (Req 21.1).
 *  - EDITAR um Draft    → `whatsapp_update_draft` (migration 106) — altera
 *    Contents/Contact_List/Distribution_Mode/Send_Interval/Execution_Quota
 *    com versionamento otimista (`expected_updated_at`/`STALE_VERSION`),
 *    mantendo o status `DRAFT` (Req 21.3, 21.4).
 *  - INICIAR um Draft   → `whatsapp_transition_dispatch(..., 'START')`
 *    (migration 101), via `transitionDispatch` desta camada — aplica
 *    DRAFT→QUEUED revalidando lista/conteúdos no backend (Req 21.5, 21.6).
 *
 * Todas as mutações passam por `executeAdminMutation` (audit-by-construction,
 * admin-patterns #1) sempre incluindo o `instance_id` no log (Req 21.7, 18.6).
 * O gating `SETTINGS_EDIT` é reaplicado no servidor (camada 2 do RBAC) e o
 * escopo é exclusivo da Active_Instance (Req 21.8).
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR. Erros canônicos
 * (`STALE_VERSION`, `INVALID_STATE_TRANSITION`, anti-enumeração) são lançados,
 * não retornados.
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, isInstanceGuardError, type SupabaseLikeError } from './guards';
import { WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE } from './contacts';
import { validateSendInterval, validateExecutionQuota } from './validation';
import type { DistributionMode } from './distribution';
import {
  createDispatchJob,
  transitionDispatch,
  WHATSAPP_NO_VALID_CONTENT_MESSAGE,
  WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
  type MutationResult,
  type DispatchInput,
  type DispatchJob,
  type DispatchKind,
  type DispatchTransition,
} from './dispatch';

/* ========================================================================== *
 * SALVAR como Draft — reusa a criação de Dispatch_Job (status DRAFT)         *
 * ========================================================================== */

/**
 * Entrada para salvar um Draft. Idêntica ao `DispatchInput`, porém SEM o campo
 * `status`: salvar como rascunho força `DRAFT` por construção, sem habilitar o
 * Job_Worker (Req 21.1).
 */
export type DraftInput = Omit<DispatchInput, 'status'>;

/**
 * Salva uma campanha como Draft (Req 21.1): persiste o Dispatch_Job no status
 * `DRAFT` da Active_Instance via `whatsapp_create_dispatch_job` (status forçado
 * `DRAFT`), materializando os Dispatch_Recipients SEM habilitar o Job_Worker
 * (que só reclama jobs `QUEUED`/`RUNNING`).
 *
 * Reusa `createDispatchJob` desta camada — mesma revalidação client-side
 * (intervalo/quota/modo), mesmo audit-by-construction com `instance_id`
 * (Req 21.7, 18.6) e mesmo mapeamento de erros canônicos.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo, Req 21.8).
 * @param input      Parâmetros do disparo (sem `status`; forçado `DRAFT`).
 * @returns `MutationResult<DispatchJob>` — `{ ok, data, updated_at }` na criação.
 * @throws `Error` com Canonical_Message pt-BR (validação/anti-enumeração).
 */
export async function saveDraft(
  instanceId: string,
  input: DraftInput
): Promise<MutationResult<DispatchJob>> {
  return createDispatchJob(instanceId, { ...input, status: 'DRAFT' });
}

/* ========================================================================== *
 * EDITAR um Draft — RPC whatsapp_update_draft (migration 106)                *
 *                                                                            *
 * A RPC edita um Dispatch_Job no status `DRAFT` escopado por `instance_id`,   *
 * com versionamento otimista (`expected_updated_at`/`STALE_VERSION`), e        *
 * RE-MATERIALIZA os Dispatch_Recipients (lista/conteúdos/modo podem ter        *
 * mudado). Mantém o status `DRAFT` (Req 21.3, 21.4).                          *
 *                                                                            *
 * A RPC revalida no backend (defesa em profundidade, espelho da 099):         *
 *  - send_interval_sec > 0  → WHATSAPP_INVALID_SEND_INTERVAL                  *
 *  - execution_quota  >= 1  → WHATSAPP_INVALID_EXECUTION_QUOTA                *
 *  - >= 1 Content válido     → WHATSAPP_NO_VALID_CONTENT                       *
 *  - BULK: lista não vazia   → WHATSAPP_EMPTY_CONTACT_LIST                     *
 *  - GROUP: >= 1 grupo        → WHATSAPP_NO_GROUPS_SELECTED                     *
 * Job fora de `DRAFT` (já iniciado/terminal) → INVALID_STATE_TRANSITION;       *
 * instância/job inexistente ou cruzado → WHATSAPP_NOT_FOUND (anti-enum).      *
 *                                                                            *
 * O audit positivo da edição (Req 21.7) é gravado por esta camada via         *
 * `executeAdminMutation`, sempre incluindo o `instance_id` (Req 18.6).         *
 * ========================================================================== */

/**
 * Entrada para editar um Draft (Req 21.3). O `kind` é PRESERVADO no backend
 * (não muda na edição); aqui ele é opcional e usado APENAS na revalidação
 * client-side do `distributionMode` (exigido para `BULK`).
 */
export interface DraftUpdateInput {
  /** Tipo do disparo (opcional; só para revalidar `distributionMode` no front). */
  kind?: DispatchKind;
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
}

/** Forma crua (snake_case) do Draft editado retornado pela RPC `whatsapp_update_draft`. */
interface RawDraftJob {
  id: string;
  instance_id: string;
  kind: DispatchKind;
  status: DispatchJob['status'];
  distribution_mode: DistributionMode | null;
  block_size: number | null;
  send_interval_sec: number;
  execution_quota: number;
  total_count: number;
  /** A RPC 106 não retorna `created_at` (preservado no banco); opcional aqui. */
  created_at?: string;
  updated_at: string;
}

/**
 * Converte o Draft cru da RPC para o shape camelCase `DispatchJob`. A RPC 106
 * não retorna `created_at` (a data de criação não muda na edição); preservamos
 * o campo do registro carregado pela UI quando informado, senão string vazia.
 */
function mapDraftJob(row: RawDraftJob, createdAtFallback?: string): DispatchJob {
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
    createdAt: row.created_at ?? createdAtFallback ?? '',
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
 * Mapa marker (SQL) → mensagem/código propagado. Markers de revalidação viram
 * Canonical_Message pt-BR; `STALE_VERSION` (Req 21.4) e `INVALID_STATE_TRANSITION`
 * (Req 21.3 — Draft já iniciado/terminal) são mantidos como códigos em inglês
 * para que os chamadores os reconheçam (admin-patterns #3).
 */
const DRAFT_UPDATE_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_INVALID_SEND_INTERVAL: 'Informe um intervalo válido.',
  WHATSAPP_INVALID_EXECUTION_QUOTA: 'Informe uma quantidade válida.',
  WHATSAPP_NO_VALID_CONTENT: WHATSAPP_NO_VALID_CONTENT_MESSAGE,
  WHATSAPP_EMPTY_CONTACT_LIST: WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE,
  WHATSAPP_NO_GROUPS_SELECTED: WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  STALE_VERSION: 'STALE_VERSION',
};

/**
 * Mapeia um erro da RPC de edição de Draft para a mensagem/código apropriado:
 * `WHATSAPP_NOT_FOUND` → Canonical_Message anti-enumeração (precedência);
 * markers de revalidação → Canonical_Message pt-BR; `STALE_VERSION`/
 * `INVALID_STATE_TRANSITION` → código inglês reconhecível; demais → fallback.
 */
function mapUpdateDraftError(error: unknown): string {
  // Anti-enumeração (instância/Draft inexistente ou cruzado) tem precedência.
  if (isInstanceGuardError(error)) {
    return mapInstanceGuardError(error);
  }

  const text = errorText(error);
  for (const [marker, message] of Object.entries(DRAFT_UPDATE_ERROR_MESSAGES)) {
    if (text.includes(marker)) {
      return message;
    }
  }

  return mapInstanceGuardError(error);
}

/**
 * Edita um Draft da Active_Instance via RPC `whatsapp_update_draft` (Req 21.3,
 * 21.4), mantendo o status `DRAFT` e re-materializando os Dispatch_Recipients.
 *
 * Fluxo:
 * 1. Revalida no frontend (espelho do backend — defesa em profundidade): o
 *    Send_Interval (`> 0`, Req 8.2) e a Execution_Quota (`>= 1`, Req 8.4); para
 *    `BULK` (quando `kind` é informado), exige `distributionMode`. Falha ⇒
 *    Canonical_Message pt-BR (bloqueia antes do I/O).
 * 2. Persiste via `executeAdminMutation` (audit-by-construction com `instance_id`
 *    no log — Req 21.7, 18.6). A RPC aplica o versionamento otimista
 *    (`expected_updated_at`) e revalida lista/conteúdos/intervalo/quota.
 *
 * Erros: markers de revalidação → Canonical_Messages pt-BR; `STALE_VERSION`
 * (Req 21.4) e `INVALID_STATE_TRANSITION` (Req 21.3) → códigos em inglês;
 * `WHATSAPP_NOT_FOUND` → Canonical_Message anti-enumeração.
 *
 * @param instanceId        Active_Instance alvo (escopo exclusivo, Req 21.8).
 * @param jobId             Draft a editar (status `DRAFT`).
 * @param input             Novos parâmetros (modo/lista/conteúdos/intervalo/quota).
 * @param expectedUpdatedAt Versão otimista lida antes de abrir a edição (Req 21.4).
 * @returns `MutationResult<DispatchJob>` — `{ ok, data, updated_at }` na edição.
 * @throws `Error` com Canonical_Message pt-BR, `STALE_VERSION` ou
 *         `INVALID_STATE_TRANSITION`.
 */
export async function updateDraft(
  instanceId: string,
  jobId: string,
  input: DraftUpdateInput,
  expectedUpdatedAt: string
): Promise<MutationResult<DispatchJob>> {
  // (1) Revalidação client-side (espelha o backend) — bloqueia antes do I/O.
  const intervalCheck = validateSendInterval(input.sendIntervalSec);
  if (!intervalCheck.ok) {
    throw new Error(intervalCheck.message);
  }

  const quotaCheck = validateExecutionQuota(input.executionQuota);
  if (!quotaCheck.ok) {
    throw new Error(quotaCheck.message);
  }

  if (
    input.kind === 'BULK' &&
    input.distributionMode !== 'BLOCK' &&
    input.distributionMode !== 'INTERLEAVED'
  ) {
    throw new Error('Selecione o modo de distribuição.');
  }

  return executeAdminMutation(
    {
      action: 'WHATSAPP_DRAFT_UPDATE',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: jobId,
      // Inclui sempre o instance_id no audit (Req 21.7, 18.6).
      before: { instance_id: instanceId, status: 'DRAFT' },
      after: {
        instance_id: instanceId,
        status: 'DRAFT',
        distribution_mode: input.kind === 'GROUP' ? null : (input.distributionMode ?? null),
        send_interval_sec: input.sendIntervalSec,
        execution_quota: input.executionQuota,
        list_id: input.listId ?? null,
        group_count: input.groupJids?.length ?? 0,
        content_count: input.contentIds.length,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_update_draft', {
        p_instance_id: instanceId,
        p_distribution_mode: input.kind === 'GROUP' ? null : (input.distributionMode ?? null),
        p_block_size: input.blockSize ?? null,
        p_send_interval_sec: input.sendIntervalSec,
        p_execution_quota: input.executionQuota,
        p_list_id: input.listId ?? null,
        p_group_jids: input.groupJids ?? null,
        p_content_ids: input.contentIds,
        p_job_id: jobId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) {
        throw new Error(mapUpdateDraftError(error));
      }

      const job = mapDraftJob(data as RawDraftJob);
      return { ok: true, data: job, updated_at: job.updatedAt };
    }
  );
}

/* ========================================================================== *
 * INICIAR um Draft — reusa a transição de estado (DRAFT→QUEUED via START)     *
 * ========================================================================== */

/**
 * Inicia um Draft (Req 21.5, 21.6): aciona a transição `START`
 * (`whatsapp_transition_dispatch`), que aplica DRAFT→QUEUED REVALIDANDO no
 * backend a Contact_List e os Contents. Se a lista válida estiver vazia ou os
 * Contents forem inválidos, o início é bloqueado e o status permanece `DRAFT`,
 * com a Canonical_Message correspondente.
 *
 * Reusa `transitionDispatch` desta camada — mesmo versionamento otimista
 * (`expected_updated_at`/`STALE_VERSION`), mesma idempotência (`_SKIPPED`) e
 * mesmo audit-by-construction com `instance_id` (Req 21.7, 18.6).
 *
 * @param instanceId        Active_Instance alvo (escopo exclusivo, Req 21.8).
 * @param jobId             Draft a iniciar (status `DRAFT`).
 * @param expectedUpdatedAt Versão otimista lida antes de acionar "Iniciar".
 * @returns `MutationResult<DispatchTransition>` — `{ ok, data, updated_at }` na
 *          transição válida; `{ skipped, reason }` na idempotência.
 * @throws `Error` com Canonical_Message pt-BR (lista vazia/Content inválido),
 *         `STALE_VERSION`, `INVALID_STATE_TRANSITION` ou anti-enumeração.
 */
export async function startDraft(
  instanceId: string,
  jobId: string,
  expectedUpdatedAt: string
): Promise<MutationResult<DispatchTransition>> {
  return transitionDispatch(instanceId, jobId, 'START', expectedUpdatedAt);
}

/* ========================================================================== *
 * LISTAR Drafts — RPC whatsapp_list_drafts (migration 114, Req 21.2)         *
 *                                                                            *
 * LEITURA (não audita). Retorna os Dispatch_Jobs `DRAFT` da Active_Instance   *
 * SEM agendamento pendente (os agendados ficam na aba Programados), com o     *
 * resumo exibido na DraftsList: tipo, distribuição, intervalo/quota, total de *
 * destinatários, nº de Contents e datas de criação/última edição.            *
 * ========================================================================== */

/** Resumo de um Draft, como exposto à UI (camelCase). */
export interface DraftSummary {
  id: string;
  kind: DispatchKind;
  distributionMode: DistributionMode | null;
  blockSize: number | null;
  sendIntervalSec: number;
  executionQuota: number;
  /** Destinatários materializados (Req 21.2 — resumo de destinatários). */
  totalCount: number;
  /** Contents distintos atribuídos (Req 21.2 — resumo de Contents). */
  contentCount: number;
  /** Data de criação (ISO). */
  createdAt: string;
  /** Data da última edição (ISO) — também a versão otimista para iniciar/editar. */
  updatedAt: string;
}

/** Forma crua (snake_case) retornada pela RPC `whatsapp_list_drafts`. */
interface RawDraftSummary {
  id: string;
  kind: DispatchKind;
  distribution_mode: DistributionMode | null;
  block_size: number | null;
  send_interval_sec: number;
  execution_quota: number;
  total_count: number;
  content_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Lista os Drafts da Active_Instance (Req 21.2), via RPC `whatsapp_list_drafts`
 * (gating `SETTINGS_VIEW` no servidor). Mapeia snake_case → camelCase. LEITURA —
 * não audita.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo, Req 21.8).
 * @returns Lista de `DraftSummary` (vazia quando não há rascunhos).
 * @throws `Error` com Canonical_Message anti-enumeração para instância
 *         inexistente/cruzada; `permission_denied` quando falta `SETTINGS_VIEW`.
 */
export async function listDrafts(instanceId: string): Promise<DraftSummary[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_drafts', {
    p_instance_id: instanceId,
  });
  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = Array.isArray(data) ? (data as RawDraftSummary[]) : [];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    distributionMode: row.distribution_mode,
    blockSize: row.block_size,
    sendIntervalSec: row.send_interval_sec,
    executionQuota: row.execution_quota,
    totalCount: row.total_count,
    contentCount: row.content_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
