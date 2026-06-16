/**
 * Lógica de disparo (dispatch) — parte PURA, sem I/O.
 *
 * Este arquivo concentra, por enquanto, apenas o helper puro de pacing
 * (`shouldSendNow`), alvo de property test (Property 14, tarefa 2.16). As demais
 * peças do disparo (RPC `createDispatchJob`, `transitionDispatch`, lógica do
 * worker durável) são adicionadas em tarefas posteriores (10.2 / 11.2 / 12.x) e
 * conviverão neste módulo; mantemos aqui o helper puro isolado e exportado de
 * forma limpa para que possa ser reutilizado pelo worker sem acoplamento a I/O.
 *
 * ## Pacing sem dormir (Req 8.6 — "Pacing e quota")
 *
 * Cada tick do worker é stateless e curto: em vez de "dormir" pelo
 * `Send_Interval`, ele **olha o relógio**. Só envia ao próximo destinatário se já
 * passou tempo suficiente desde o último envio. `shouldSendNow` encapsula essa
 * decisão de forma pura e determinística, permitindo testá-la isoladamente.
 *
 * ## Unidades de tempo (escolha explícita)
 *
 * - `now` e `lastSendAt`: instantes no tempo, expressos como **epoch em
 *   milissegundos** (`number`) **ou** como `Date`. Internamente tudo é convertido
 *   para epoch ms via `toEpochMs`.
 * - `intervalSec`: o `Send_Interval` em **segundos** (como persistido em
 *   `whatsapp_dispatch_jobs.send_interval_sec`). É convertido para milissegundos
 *   (`× 1000`) antes da comparação, garantindo unidades consistentes.
 *
 * O chamador (worker) tipicamente passa `now = Date.now()` e
 * `lastSendAt = job.last_send_at` (timestamp do banco convertido para ms ou Date).
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, isInstanceGuardError, type SupabaseLikeError } from './guards';
import { WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE } from './contacts';
import { validateSendInterval, validateExecutionQuota } from './validation';
import type { DistributionMode } from './distribution';

/** Instante no tempo aceito pelos helpers de pacing: epoch ms ou `Date`. */
export type TimeInput = number | Date;

/**
 * Converte um `TimeInput` para epoch em milissegundos.
 *
 * @param value Instante como epoch ms (`number`) ou `Date`.
 * @returns Epoch em milissegundos.
 */
function toEpochMs(value: TimeInput): number {
  return value instanceof Date ? value.getTime() : value;
}

/**
 * Decide, de forma PURA, se o próximo envio pode ocorrer agora respeitando o
 * `Send_Interval` (Req 8.6).
 *
 * Regra: retorna `true` se, e somente se,
 * `now >= lastSendAt + intervalSec` (com `intervalSec` convertido para ms).
 *
 * Primeiro envio: quando não houve envio anterior (`lastSendAt` `null`/`undefined`),
 * não há intervalo a respeitar, então retorna `true`.
 *
 * @param now         Instante atual (epoch ms ou `Date`).
 * @param lastSendAt  Instante do último envio (epoch ms ou `Date`); `null`/`undefined`
 *                    no primeiro envio.
 * @param intervalSec `Send_Interval` em **segundos**.
 * @returns `true` se o envio deve ocorrer agora; caso contrário `false`.
 */
export function shouldSendNow(
  now: TimeInput,
  lastSendAt: TimeInput | null | undefined,
  intervalSec: number
): boolean {
  // Primeiro envio: sem último envio registrado, não há intervalo a aguardar.
  if (lastSendAt === null || lastSendAt === undefined) {
    return true;
  }

  const nowMs = toEpochMs(now);
  const lastMs = toEpochMs(lastSendAt);
  const intervalMs = intervalSec * 1000;

  return nowMs >= lastMs + intervalMs;
}

/* ========================================================================== *
 * Criação de Dispatch_Job — camada de serviço (I/O via RPC)                  *
 *                                                                            *
 * Envolve a RPC `whatsapp_create_dispatch_job` (migration 099, task 10.1),   *
 * que persiste o Dispatch_Job e MATERIALIZA seus Dispatch_Recipients com     *
 * `seq` determinístico, `assigned_content_id` (via a fórmula de              *
 * Distribution_Mode, espelho de `assignContents`) e `recipient_data` em      *
 * snapshot — tudo ANTES do início do processamento (Req 7.6, 10.1, 25.7).    *
 *                                                                            *
 * A criação é uma MUTAÇÃO: passa por `executeAdminMutation`                  *
 * (audit-by-construction, admin-patterns #1), sempre registrando o           *
 * `instance_id` no log de auditoria (Req 18.6). O gating SETTINGS_EDIT é     *
 * reaplicado no servidor (camada 2 do RBAC).                                 *
 *                                                                            *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR; segredos      *
 * nunca trafegam por aqui.                                                   *
 * ========================================================================== */

/**
 * Resultado canônico de uma mutação do WhatsApp_Module (design.md — "Camada de
 * serviços"). Discrimina entre:
 * - `{ ok: true; data; updated_at }`: a mutação ocorreu; `data` é a entidade
 *   resultante e `updated_at` a versão otimista para chamadas subsequentes.
 * - `{ skipped: true; reason }`: operação idempotente sem mutação real
 *   (`_SKIPPED`, Req 9.5, 23.5, 31.15) — a UI exibe um toast neutro, não erro.
 *
 * Erros canônicos (`permission_denied`, `STALE_VERSION`,
 * `INVALID_STATE_TRANSITION`, Canonical_Messages anti-enumeração) são lançados,
 * não retornados.
 */
export type MutationResult<T> =
  | { ok: true; data: T; updated_at: string }
  | { skipped: true; reason: string };

/** Tipo de disparo (espelha o domínio fechado `dispatch_kind` do SQL). */
export type DispatchKind = 'BULK' | 'GROUP';

/**
 * Status de um Dispatch_Job (espelha o domínio fechado `dispatch_status`).
 * A criação só produz `DRAFT` (rascunho) ou `QUEUED` (enfileirado); os demais
 * são alcançados por transição posterior (task 11.x).
 */
export type DispatchJobStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/** Status aceitos no momento da criação de um Dispatch_Job. */
export type DispatchCreateStatus = Extract<DispatchJobStatus, 'DRAFT' | 'QUEUED'>;

/**
 * Entrada para criar um Dispatch_Job. `kind = 'BULK'` exige `listId` e
 * `distributionMode`; `kind = 'GROUP'` exige `groupJids` (o backend persiste
 * `distribution_mode` como `NULL` e usa rodízio interno).
 */
export interface DispatchInput {
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
  /** Status inicial: `DRAFT` (rascunho, default) ou `QUEUED` (enfileirado). */
  status?: DispatchCreateStatus;
}

/** Dispatch_Job persistido, como exposto à UI (camelCase). */
export interface DispatchJob {
  id: string;
  instanceId: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distributionMode: DistributionMode | null;
  blockSize: number | null;
  sendIntervalSec: number;
  executionQuota: number;
  /** Quantidade de Dispatch_Recipients materializados. */
  totalCount: number;
  createdAt: string;
  /** Versão otimista da linha (ISO) para chamadas subsequentes. */
  updatedAt: string;
}

/** Forma crua (snake_case) do Dispatch_Job retornado pela RPC. */
interface RawDispatchJob {
  id: string;
  instance_id: string;
  kind: DispatchKind;
  status: DispatchJobStatus;
  distribution_mode: DistributionMode | null;
  block_size: number | null;
  send_interval_sec: number;
  execution_quota: number;
  total_count: number;
  created_at: string;
  updated_at: string;
}

/** Converte o Dispatch_Job cru da RPC para o shape camelCase da camada de serviço. */
function mapDispatchJob(row: RawDispatchJob): DispatchJob {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Canonical_Messages (pt-BR) dos markers de revalidação da RPC
 * `whatsapp_create_dispatch_job` (ERRCODE `P0001`). Espelham as mensagens dos
 * validadores compartilhados (`validation.ts`) e das guardas de lista/grupo.
 */
export const WHATSAPP_NO_VALID_CONTENT_MESSAGE =
  'Informe um texto ou anexe ao menos uma mídia.' as const;
export const WHATSAPP_NO_GROUPS_SELECTED_MESSAGE = 'Selecione ao menos um grupo.' as const;

/**
 * Mapa marker (SQL) → Canonical_Message (pt-BR). `STALE_VERSION` é mantido como
 * código em inglês para que os chamadores o reconheçam (`err.message ===
 * 'STALE_VERSION'`, admin-patterns #3); os demais viram mensagem user-facing.
 */
const DISPATCH_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_INVALID_SEND_INTERVAL: 'Informe um intervalo válido.',
  WHATSAPP_INVALID_EXECUTION_QUOTA: 'Informe uma quantidade válida.',
  WHATSAPP_NO_VALID_CONTENT: WHATSAPP_NO_VALID_CONTENT_MESSAGE,
  WHATSAPP_EMPTY_CONTACT_LIST: WHATSAPP_EMPTY_CONTACT_LIST_MESSAGE,
  WHATSAPP_NO_GROUPS_SELECTED: WHATSAPP_NO_GROUPS_SELECTED_MESSAGE,
  STALE_VERSION: 'STALE_VERSION',
};

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
 * Mapeia um erro da RPC de criação de disparo para a mensagem apropriada:
 * markers de revalidação → Canonical_Message pt-BR; `WHATSAPP_NOT_FOUND` →
 * anti-enumeração; demais → mensagem do erro (fallback seguro).
 */
function mapCreateDispatchError(error: unknown): string {
  // Anti-enumeração (instância/registro cruzado ou inexistente) tem precedência.
  if (isInstanceGuardError(error)) {
    return mapInstanceGuardError(error);
  }

  const text = errorText(error);
  for (const [marker, message] of Object.entries(DISPATCH_ERROR_MESSAGES)) {
    if (text.includes(marker)) {
      return message;
    }
  }

  return mapInstanceGuardError(error);
}

/**
 * Cria um Dispatch_Job da Active_Instance e materializa seus Dispatch_Recipients
 * via RPC `whatsapp_create_dispatch_job` (Req 10.1).
 *
 * Fluxo:
 * 1. Revalida no frontend (espelho do backend — defesa em profundidade): o
 *    Send_Interval (`> 0`, Req 8.2) e a Execution_Quota (`>= 1`, Req 8.4), além
 *    de exigir `distributionMode` para `BULK`. Falha ⇒ Canonical_Message pt-BR.
 * 2. Persiste via `executeAdminMutation` (audit-by-construction com `instance_id`
 *    no log — Req 18.6). A RPC revalida lista/conteúdos/intervalo/quota no
 *    backend e gera os recipients com `seq`/`assigned_content_id`/snapshot.
 *
 * Erros da RPC são mapeados para Canonical_Messages pt-BR (intervalo/quota/
 * conteúdo/lista/grupo inválidos) ou anti-enumeração (`WHATSAPP_NOT_FOUND`);
 * `STALE_VERSION` é propagado como código em inglês.
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo).
 * @param input      Parâmetros do disparo (kind, distribuição, intervalo, quota,
 *                   lista/grupos, contents, status).
 * @returns `MutationResult<DispatchJob>` — `{ ok, data, updated_at }` na criação.
 * @throws `Error` com Canonical_Message pt-BR em validação/anti-enumeração, ou
 *         `STALE_VERSION`.
 */
export async function createDispatchJob(
  instanceId: string,
  input: DispatchInput
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

  const status: DispatchCreateStatus = input.status ?? 'DRAFT';

  return executeAdminMutation(
    {
      action: 'WHATSAPP_DISPATCH_CREATE',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: instanceId,
      before: null,
      // Registra o `instance_id` (Req 18.6) e metadados não sensíveis do job.
      after: {
        instance_id: instanceId,
        kind: input.kind,
        status,
        distribution_mode: input.kind === 'BULK' ? input.distributionMode : null,
        send_interval_sec: input.sendIntervalSec,
        execution_quota: input.executionQuota,
        list_id: input.listId ?? null,
        group_count: input.groupJids?.length ?? 0,
        content_count: input.contentIds.length,
      },
    },
    async () => {
      const { data, error } = await supabase.rpc('whatsapp_create_dispatch_job', {
        p_instance_id: instanceId,
        p_kind: input.kind,
        p_distribution_mode: input.kind === 'BULK' ? (input.distributionMode ?? null) : null,
        p_block_size: input.blockSize ?? null,
        p_send_interval_sec: input.sendIntervalSec,
        p_execution_quota: input.executionQuota,
        p_list_id: input.listId ?? null,
        p_group_jids: input.groupJids ?? null,
        p_content_ids: input.contentIds,
        p_status: status,
      });
      if (error) {
        throw new Error(mapCreateDispatchError(error));
      }

      const job = mapDispatchJob(data as RawDispatchJob);
      return { ok: true, data: job, updated_at: job.updatedAt };
    }
  );
}

/* ========================================================================== *
 * Transição de estado do Dispatch_Job — camada de serviço (I/O via RPC)      *
 *                                                                            *
 * Envolve a RPC `whatsapp_transition_dispatch` (migration 101, task 11.1),   *
 * contraparte server-side dos botões "Iniciar / Pausar / Continuar /         *
 * Cancelar" (Req 9.1–9.4). A RPC aplica a máquina de estados escopada por     *
 * `instance_id` e devolve um de dois formatos:                               *
 *                                                                            *
 *  - Transição VÁLIDA: `{ ok, id, instance_id, action, previous_status,      *
 *    status, updated_at }`. A mutação real já ocorreu no servidor; aqui       *
 *    registramos o AUDIT positivo (Req 9.8) via `executeAdminMutation`        *
 *    (audit-by-construction, admin-patterns #1) com `before = previous_status`*
 *    e `after = status`, sempre incluindo o `instance_id` (Req 18.6).         *
 *                                                                            *
 *  - IDEMPOTÊNCIA (`_SKIPPED`, Req 9.5): `{ skipped, reason }`. A RPC NÃO     *
 *    mutou e JÁ gravou o log `WHATSAPP_DISPATCH_<ACTION>_SKIPPED` por dentro  *
 *    (admin-patterns #4). Portanto NÃO auditamos de novo — apenas propagamos  *
 *    o skip para a UI exibir um toast neutro.                                 *
 *                                                                            *
 * Por isso a RPC é chamada ANTES de `executeAdminMutation`: só após o retorno *
 * sabemos (a) se houve mutação (válida) ou skip, e (b) os valores            *
 * `previous_status`/`status` exigidos no before/after do audit. Auditar antes *
 * (como faz `executeAdminMutation`, que loga upfront) duplicaria o log no     *
 * caminho de skip e não teria os status corretos.                            *
 *                                                                            *
 * Markers de erro (ERRCODE P0001) mapeados aqui (Req 9.6, 9.7):              *
 *  - `STALE_VERSION`            → propagado como código inglês (toast          *
 *    "Outro admin atualizou", admin-patterns #3).                            *
 *  - `INVALID_STATE_TRANSITION` → propagado como código inglês (design.md —   *
 *    "erros lançados"; a UI o reconhece e exibe o aviso adequado).           *
 *  - `WHATSAPP_NOT_FOUND`       → Canonical_Message anti-enumeração            *
 *    `Não foi possível concluir a operação.` (via guards.ts).                *
 * ========================================================================== */

/** Ação de controle de um Dispatch_Job (espelha o domínio fechado da RPC). */
export type DispatchAction = 'START' | 'PAUSE' | 'RESUME' | 'CANCEL';

/**
 * Resultado de uma transição de estado VÁLIDA, exposto à camada de serviço
 * (camelCase). Carrega o estado anterior e o novo (para o audit e para a UI
 * refletir a mudança) e a nova versão otimista (`updatedAt`).
 */
export interface DispatchTransition {
  id: string;
  instanceId: string;
  action: DispatchAction;
  /** Estado imediatamente anterior à transição (before do audit). */
  previousStatus: DispatchJobStatus;
  /** Estado resultante da transição (after do audit). */
  status: DispatchJobStatus;
  /** Nova versão otimista da linha (ISO) para chamadas subsequentes. */
  updatedAt: string;
}

/** Forma crua (snake_case) da transição válida retornada pela RPC. */
interface RawDispatchTransition {
  ok: true;
  id: string;
  instance_id: string;
  action: DispatchAction;
  previous_status: DispatchJobStatus;
  status: DispatchJobStatus;
  updated_at: string;
}

/** Forma crua do retorno idempotente (`_SKIPPED`) da RPC. */
interface RawDispatchSkip {
  skipped: true;
  reason: string;
}

/**
 * Mapa marker (SQL) → mensagem/código propagado pela camada TS. `STALE_VERSION`
 * e `INVALID_STATE_TRANSITION` são mantidos como códigos em inglês para que os
 * chamadores os reconheçam (admin-patterns #3 / design.md "erros lançados");
 * `WHATSAPP_NOT_FOUND` é tratado à parte pelos helpers de `guards.ts`
 * (Canonical_Message anti-enumeração).
 */
const TRANSITION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  STALE_VERSION: 'STALE_VERSION',
};

/**
 * Mapeia um erro da RPC de transição para a mensagem/código apropriado:
 * `WHATSAPP_NOT_FOUND` → Canonical_Message anti-enumeração (precedência);
 * `STALE_VERSION`/`INVALID_STATE_TRANSITION` → código inglês reconhecível;
 * demais → fallback seguro (mensagem do erro ou Canonical_Message).
 */
function mapTransitionDispatchError(error: unknown): string {
  // Anti-enumeração (instância/job inexistente ou cruzado) tem precedência.
  if (isInstanceGuardError(error)) {
    return mapInstanceGuardError(error);
  }

  const text = errorText(error);
  for (const [marker, message] of Object.entries(TRANSITION_ERROR_MESSAGES)) {
    if (text.includes(marker)) {
      return message;
    }
  }

  return mapInstanceGuardError(error);
}

/**
 * Aplica uma transição de estado a um Dispatch_Job da Active_Instance via RPC
 * `whatsapp_transition_dispatch` (Req 9.1–9.8).
 *
 * Fluxo:
 * 1. Chama a RPC com o `expected_updated_at` (versionamento otimista, Req 9.6).
 * 2. Se a RPC sinalizar idempotência (`_SKIPPED`, Req 9.5), retorna
 *    `{ skipped, reason }` SEM auditar de novo — a própria RPC já gravou o log
 *    `WHATSAPP_DISPATCH_<ACTION>_SKIPPED`.
 * 3. Em transição válida, registra o audit positivo (Req 9.8) via
 *    `executeAdminMutation` com `before = previous_status`, `after = status` e o
 *    `instance_id` (Req 18.6), e devolve `{ ok, data, updated_at }`.
 *
 * Erros: `STALE_VERSION` (Req 9.6) e `INVALID_STATE_TRANSITION` (Req 9.7) são
 * propagados como códigos em inglês; `WHATSAPP_NOT_FOUND` vira a
 * Canonical_Message anti-enumeração `Não foi possível concluir a operação.`
 *
 * @param instanceId        Active_Instance alvo (escopo exclusivo).
 * @param jobId             Dispatch_Job a transicionar.
 * @param action            Ação de controle (`START`/`PAUSE`/`RESUME`/`CANCEL`).
 * @param expectedUpdatedAt Versão otimista lida antes de acionar o controle.
 * @returns `MutationResult<DispatchTransition>` — `{ ok, data, updated_at }` na
 *          transição válida; `{ skipped, reason }` na idempotência.
 * @throws `Error` com código inglês (`STALE_VERSION`/`INVALID_STATE_TRANSITION`)
 *         ou Canonical_Message anti-enumeração (`WHATSAPP_NOT_FOUND`).
 */
export async function transitionDispatch(
  instanceId: string,
  jobId: string,
  action: DispatchAction,
  expectedUpdatedAt: string
): Promise<MutationResult<DispatchTransition>> {
  // (1) RPC chamada PRIMEIRO: o retorno distingue skip (idempotência, já
  //     auditada pela RPC) de transição válida e fornece previous_status/status
  //     exigidos no before/after do audit positivo.
  const { data, error } = await supabase.rpc('whatsapp_transition_dispatch', {
    p_instance_id: instanceId,
    p_job_id: jobId,
    p_action: action,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    throw new Error(mapTransitionDispatchError(error));
  }

  const result = data as RawDispatchTransition | RawDispatchSkip;

  // (2) Idempotência (_SKIPPED, Req 9.5): NÃO há mutação e o log `_SKIPPED` já
  //     foi gravado dentro da RPC — apenas propagamos o skip (não auditar de novo).
  if ('skipped' in result) {
    return { skipped: true, reason: result.reason };
  }

  // (3) Transição válida: materializa o shape camelCase e registra o audit
  //     positivo (Req 9.8) via executeAdminMutation. A mutação real já ocorreu
  //     no servidor; a `fn` apenas expõe o resultado obtido, de modo que o
  //     wrapper grave o log before/after por construção (admin-patterns #1).
  const transition: DispatchTransition = {
    id: result.id,
    instanceId: result.instance_id,
    action: result.action,
    previousStatus: result.previous_status,
    status: result.status,
    updatedAt: result.updated_at,
  };

  return executeAdminMutation(
    {
      action: 'WHATSAPP_DISPATCH_TRANSITION',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: jobId,
      // Inclui sempre o instance_id no audit (Req 18.6).
      before: { instance_id: instanceId, status: transition.previousStatus },
      after: {
        instance_id: instanceId,
        action: transition.action,
        status: transition.status,
      },
    },
    async () => ({ ok: true, data: transition, updated_at: transition.updatedAt })
  );
}

/* ========================================================================== *
 * Failed_Resend ("Reenviar apenas os que falharam") — camada de serviço      *
 *                                                                            *
 * Envolve a RPC `whatsapp_resend_failed` (migration 108, task 11.5),         *
 * contraparte server-side do botão "Reenviar apenas os que falharam" do       *
 * Error_Log (Req 23.3-23.7). A RPC, escopada por `instance_id`, devolve um de *
 * dois formatos:                                                             *
 *                                                                            *
 *  - CRIAÇÃO (há FAILED na origem): `{ id, instance_id, kind, status,        *
 *    distribution_mode, block_size, send_interval_sec, execution_quota,       *
 *    total_count, source_job_id, failed_count, created_at, updated_at }`. Um  *
 *    NOVO Dispatch_Job (Failed_Resend) `QUEUED` foi criado contendo SOMENTE   *
 *    os Dispatch_Recipients que estavam `FAILED` na origem (os `SENT` não são *
 *    copiados — Req 23.4). A mutação real já ocorreu no servidor; aqui        *
 *    registramos o AUDIT POSITIVO (Req 23.6) via `executeAdminMutation`       *
 *    (audit-by-construction, admin-patterns #1) incluindo o `instance_id`     *
 *    (Req 18.6), o `source_job_id` (disparo de origem) e a quantidade de      *
 *    destinatários reenfileirados (`failed_count`).                          *
 *                                                                            *
 *  - IDEMPOTÊNCIA (`_SKIPPED`, Req 23.5): `{ skipped, reason:                 *
 *    'NO_FAILED_RECIPIENTS' }`. A origem não tinha nenhum `FAILED`: a RPC NÃO *
 *    criou job e JÁ gravou o log `WHATSAPP_DISPATCH_RESEND_SKIPPED` por dentro *
 *    (admin-patterns #4). Portanto NÃO auditamos de novo — apenas propagamos  *
 *    o skip para a UI exibir um toast neutro.                                *
 *                                                                            *
 * Por isso a RPC é chamada ANTES de `executeAdminMutation`: só após o retorno *
 * sabemos (a) se houve criação ou skip e (b) o `source_job_id`/`failed_count` *
 * exigidos no `after` do audit positivo. Auditar antes (como faz             *
 * `executeAdminMutation`, que loga upfront) duplicaria o log no caminho de    *
 * skip e não teria a contagem correta.                                       *
 *                                                                            *
 * `WHATSAPP_NOT_FOUND` (origem inexistente/cruzada ou instância sem acesso —  *
 * Req 23.7) vira a Canonical_Message anti-enumeração via `guards.ts`.         *
 * ========================================================================== */

/** Reason canônico do skip de Failed_Resend (Req 23.5). */
export const WHATSAPP_NO_FAILED_RECIPIENTS_REASON = 'NO_FAILED_RECIPIENTS' as const;

/**
 * Forma crua (snake_case) do Failed_Resend criado pela RPC. Estende o
 * `RawDispatchJob` com a origem (`source_job_id`) e a quantidade reenfileirada
 * (`failed_count`), usados apenas no audit positivo (não expostos no DispatchJob).
 */
interface RawResendJob extends RawDispatchJob {
  source_job_id: string;
  failed_count: number;
}

/**
 * Cria um Failed_Resend a partir de um Dispatch_Job de origem via RPC
 * `whatsapp_resend_failed` (Req 23.3-23.7): um novo Dispatch_Job `QUEUED`
 * contendo SOMENTE os Dispatch_Recipients que estavam `FAILED` na origem,
 * preservando os `SENT` (que não são reenviados, Req 23.4).
 *
 * Fluxo:
 * 1. Chama a RPC (escopada por `instance_id`).
 * 2. Se a origem não tinha nenhum `FAILED` (`_SKIPPED`, Req 23.5), retorna
 *    `{ skipped: true, reason: 'NO_FAILED_RECIPIENTS' }` SEM auditar de novo — a
 *    própria RPC já gravou o log `WHATSAPP_DISPATCH_RESEND_SKIPPED`.
 * 3. Na criação, registra o audit positivo (Req 23.6) via
 *    `executeAdminMutation` com o `instance_id` (Req 18.6), o `source_job_id`
 *    (origem) e a quantidade reenfileirada (`failed_count`), e devolve
 *    `{ ok, data, updated_at }`.
 *
 * Erro: `WHATSAPP_NOT_FOUND` (origem inexistente/cruzada ou instância sem
 * acesso, Req 23.7) vira a Canonical_Message anti-enumeração
 * `Não foi possível concluir a operação.`
 *
 * @param instanceId Active_Instance alvo (escopo exclusivo).
 * @param jobId      Dispatch_Job de ORIGEM (de onde os `FAILED` são copiados).
 * @returns `MutationResult<DispatchJob>` — `{ ok, data, updated_at }` na criação;
 *          `{ skipped, reason: 'NO_FAILED_RECIPIENTS' }` quando não há `FAILED`.
 * @throws `Error` com Canonical_Message anti-enumeração (`WHATSAPP_NOT_FOUND`).
 */
export async function resendFailed(
  instanceId: string,
  jobId: string
): Promise<MutationResult<DispatchJob>> {
  // (1) RPC chamada PRIMEIRO: o retorno distingue skip (idempotência, já
  //     auditada pela RPC) de criação e fornece source_job_id/failed_count
  //     exigidos no after do audit positivo.
  const { data, error } = await supabase.rpc('whatsapp_resend_failed', {
    p_instance_id: instanceId,
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const result = data as RawResendJob | RawDispatchSkip;

  // (2) Idempotência (_SKIPPED, Req 23.5): sem nenhum FAILED na origem, não há
  //     mutação e o log `_SKIPPED` já foi gravado dentro da RPC — apenas
  //     propagamos o skip (não auditar de novo).
  if ('skipped' in result) {
    return { skipped: true, reason: result.reason };
  }

  // (3) Criação: materializa o shape camelCase e registra o audit positivo
  //     (Req 23.6) via executeAdminMutation. A mutação real já ocorreu no
  //     servidor; a `fn` apenas expõe o resultado obtido, de modo que o wrapper
  //     grave o log por construção (admin-patterns #1) com instance_id (Req
  //     18.6), origem (source_job_id) e quantidade reenfileirada (failed_count).
  const job = mapDispatchJob(result);

  return executeAdminMutation(
    {
      action: 'WHATSAPP_DISPATCH_RESEND',
      targetType: 'whatsapp_dispatch_jobs',
      targetId: job.id,
      before: { instance_id: instanceId, source_job_id: jobId },
      after: {
        instance_id: instanceId,
        source_job_id: jobId,
        new_job_id: job.id,
        status: job.status,
        failed_count: result.failed_count,
      },
    },
    async () => ({ ok: true, data: job, updated_at: job.updatedAt })
  );
}
