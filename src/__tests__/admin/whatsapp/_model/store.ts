/**
 * Modelo de servidor EM MEMÓRIA (store + reducers PUROS) — WhatsApp_Module.
 *
 * Este módulo NÃO faz I/O. Ele espelha, de forma determinística, a lógica das
 * RPCs `SECURITY DEFINER` e do Job_Worker durável descritos em `design.md`, para
 * que as Correctness Properties que envolvem o servidor possam ser testadas com
 * `fast-check` sem um banco de dados:
 *
 *  - P1  Isolamento total entre instâncias        (Req 2.6, 2.7, 26.5, 30.6, 31.18)
 *  - P2  Responsável único (guarda de modo)        (Req 16.7, 31.2, 31.5, 31.10, 31.11)
 *  - P3  Idempotência por destinatário             (Req 10.4, 10.5, 23.3, 23.4, 27.2)
 *  - P6  Quota por execução nunca excedida          (Req 8.5, 8.7)
 *  - P9  Idempotência do auto-reply por evento      (Req 16.6, 31.12)
 *  - P13 No máximo uma sessão por instância          (Req 4.2)
 *
 * Princípios de design do modelo:
 *  - **Isolamento por construção (P1):** todo estado é particionado por
 *    `instanceId`. Toda operação recebe um `instanceId` e só consegue ler/escrever
 *    dentro daquela partição — espelha as RPCs parametrizadas por `p_instance_id`.
 *  - **Pureza:** reducers nunca mutam o estado recebido; retornam um novo
 *    `ModelState` (ou `{ state, ... }` quando há um valor de resultado).
 *  - **Determinismo:** sem relógio real, sem aleatoriedade. O pacing usa o
 *    `now` virtual fornecido pelo chamador e reaproveita `shouldSendNow`.
 *
 * Reuso de lógica pura existente:
 *  - `assignContents` (distribution.ts) para o vínculo recipient ↔ content.
 *  - `shouldSendNow`   (dispatch.ts)     para a decisão de pacing por relógio.
 *  - `renderMessage`   (render.ts)        para a Rendered_Message do envio.
 */

import { assignContents } from '../../../../services/admin/whatsapp/distribution';
import { shouldSendNow } from '../../../../services/admin/whatsapp/dispatch';
import { renderMessage, type RecipientData } from '../../../../services/admin/whatsapp/render';
import type { DistributionMode } from '../../../../services/admin/whatsapp/distribution';

// ─── Domínios de status (espelham os CHECKs da migration 044) ────────────────

/** Status da WhatsApp_Session (Req 3). */
export type SessionStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_PENDING' | 'CONNECTED' | 'EXPIRED';

/** Status do Dispatch_Job (Req 9, 10). */
export type DispatchStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/** Status do Dispatch_Recipient (Req 10). */
export type RecipientStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/** Conversation_Mode (Req 31). */
export type ConversationMode = 'AI_MODE' | 'HUMAN_MODE' | 'AI_PAUSED' | 'RETURNED_TO_AI';

/** Conjunto AI-allowed: modos em que o auto-reply é permitido (Req 31.2, design). */
export const AI_ALLOWED_MODES: readonly ConversationMode[] = ['AI_MODE', 'RETURNED_TO_AI'];

/** Status de um registro de idempotência de auto-reply (whatsapp_ai_replies). */
export type AiReplyStatus = 'SENT' | 'BLOCKED' | 'AI_PROVIDER_ERROR';

// ─── Entidades (todas carregam `instanceId`) ─────────────────────────────────

/** WhatsApp_Session — no máximo uma por instância (Req 4.2). */
export interface Session {
  instanceId: string;
  status: SessionStatus;
  lastConnectedAt: number | null;
}

/** Dispatch_Job (BULK/GROUP). */
export interface DispatchJob {
  id: string;
  instanceId: string;
  status: DispatchStatus;
  mode: DistributionMode;
  blockSize: number;
  sendIntervalSec: number;
  executionQuota: number;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  /** Enviados na execução corrente (controle de quota — Req 8.5). */
  execSentCount: number;
  /** Job de origem em Duplicar/Reenviar/Failed_Resend (Req 20, 23). */
  sourceJobId: string | null;
  /** Pacing: instante (epoch ms) do último envio bem-sucedido (Req 8.6). */
  lastSendAt: number | null;
  failureCode: string | null;
}

/** Dispatch_Recipient — unidade durável com idempotência própria. */
export interface DispatchRecipient {
  id: string;
  instanceId: string;
  jobId: string;
  /** Ordem determinística de processamento (claim por `seq` crescente). */
  seq: number;
  status: RecipientStatus;
  assignedContentId: string;
  recipientData: RecipientData;
  sentAt: number | null;
  failureReason: string | null;
  /** Id da mensagem entregue pela Evolution (idempotência de envio). */
  providerMessageId: string | null;
}

/** Conversation — uma por (instância, contato). */
export interface Conversation {
  id: string;
  instanceId: string;
  contactPhone: string;
  mode: ConversationMode;
  updatedAt: number;
}

/** Mensagem inbound/outbound — dedup por `providerEventId`. */
export interface Message {
  id: string;
  instanceId: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  providerEventId: string | null;
}

/** Registro de idempotência de auto-reply (UNIQUE instância+evento). */
export interface AiReply {
  instanceId: string;
  providerEventId: string;
  conversationId: string;
  status: AiReplyStatus;
}

/** Configuração de IA por instância (segredo fica no Vault — aqui só indicador). */
export interface AiConfig {
  enabled: boolean;
  hasApiKey: boolean;
}

// ─── Estado em memória, particionado por instância ───────────────────────────

/** Partição de uma única instância: todas as entidades daquele `instanceId`. */
export interface InstanceState {
  instanceId: string;
  label: string;
  displayOrder: number;
  enabled: boolean;
  session: Session | null;
  aiConfig: AiConfig;
  jobs: Record<string, DispatchJob>;
  recipients: Record<string, DispatchRecipient>;
  conversations: Record<string, Conversation>;
  messages: Record<string, Message>;
  /** ai_replies indexados por `providerEventId` (UNIQUE instância+evento). */
  aiReplies: Record<string, AiReply>;
}

/** Estado completo do modelo: mapa `instanceId` → partição. */
export interface ModelState {
  instances: Record<string, InstanceState>;
}

// ─── Helpers internos (puros) ────────────────────────────────────────────────

/** Estado inicial vazio. */
export function createInitialState(): ModelState {
  return { instances: {} };
}

/**
 * Aplica `fn` à partição de `instanceId`, retornando um NOVO `ModelState`.
 * Se a instância não existe, o estado é retornado inalterado (anti-enumeração:
 * operação sobre instância inexistente é no-op — Req 2.8).
 */
function updateInstance(
  state: ModelState,
  instanceId: string,
  fn: (inst: InstanceState) => InstanceState
): ModelState {
  const current = state.instances[instanceId];
  if (!current) {
    return state;
  }
  const next = fn(current);
  if (next === current) {
    return state;
  }
  return { instances: { ...state.instances, [instanceId]: next } };
}

/** Lê a partição de uma instância (somente leitura, escopada). */
export function getInstance(state: ModelState, instanceId: string): InstanceState | undefined {
  return state.instances[instanceId];
}

// ─── Instâncias e configuração de IA ─────────────────────────────────────────

export interface CreateInstanceInput {
  instanceId: string;
  label?: string;
  displayOrder?: number;
  enabled?: boolean;
  aiConfig?: Partial<AiConfig>;
}

/**
 * Cria (ou substitui) uma instância e sua partição vazia. Idempotente em estrutura:
 * recriar com o mesmo `instanceId` substitui a configuração mas mantém o contrato.
 */
export function createInstance(state: ModelState, input: CreateInstanceInput): ModelState {
  const inst: InstanceState = {
    instanceId: input.instanceId,
    label: input.label ?? input.instanceId,
    displayOrder: input.displayOrder ?? Object.keys(state.instances).length,
    enabled: input.enabled ?? true,
    session: null,
    aiConfig: {
      enabled: input.aiConfig?.enabled ?? false,
      hasApiKey: input.aiConfig?.hasApiKey ?? false,
    },
    jobs: {},
    recipients: {},
    conversations: {},
    messages: {},
    aiReplies: {},
  };
  return { instances: { ...state.instances, [input.instanceId]: inst } };
}

/** Atualiza a configuração de IA da instância (habilitado / chave presente). */
export function setAiConfig(
  state: ModelState,
  instanceId: string,
  config: Partial<AiConfig>
): ModelState {
  return updateInstance(state, instanceId, (inst) => ({
    ...inst,
    aiConfig: { ...inst.aiConfig, ...config },
  }));
}

// ─── Sessão única por instância (P13) ────────────────────────────────────────

/**
 * Conecta (ou reusa) a sessão da instância. Espelha o UNIQUE(instance_id):
 * existe **no máximo uma** sessão; chamar de novo reaproveita a mesma linha,
 * apenas atualizando o status — nunca cria uma segunda sessão (Req 4.1, 4.2).
 *
 * @param status Status alvo (default `CONNECTED`).
 */
export function connectSession(
  state: ModelState,
  instanceId: string,
  status: SessionStatus = 'CONNECTED',
  now = 0
): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const session: Session = {
      instanceId,
      status,
      lastConnectedAt: status === 'CONNECTED' ? now : (inst.session?.lastConnectedAt ?? null),
    };
    return { ...inst, session };
  });
}

/** Desconecta a sessão (mantém a linha única, status `DISCONNECTED`). */
export function disconnectSession(state: ModelState, instanceId: string): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    if (!inst.session) {
      // Sem sessão: cria a linha única em DISCONNECTED (reuso garantido).
      return { ...inst, session: { instanceId, status: 'DISCONNECTED', lastConnectedAt: null } };
    }
    return { ...inst, session: { ...inst.session, status: 'DISCONNECTED' } };
  });
}

/** Lê a sessão da instância (no máximo uma). */
export function getSession(state: ModelState, instanceId: string): Session | null {
  return state.instances[instanceId]?.session ?? null;
}

// ─── Criação de Dispatch_Job + geração de recipients ─────────────────────────

export interface DispatchJobInput {
  jobId: string;
  /** Telefones/targets na ordem determinística de processamento (vira `seq`). */
  recipients: Array<{ phone: string; recipientData?: RecipientData }>;
  /** Ids dos Contents registrados (ordem = `position`). */
  contentIds: string[];
  mode: DistributionMode;
  blockSize: number;
  sendIntervalSec: number;
  executionQuota: number;
  status?: DispatchStatus;
  sourceJobId?: string | null;
}

/**
 * Cria um Dispatch_Job e gera seus Dispatch_Recipients **antes** do início
 * (Req 7.6, 10.1). Usa `assignContents` (lógica pura compartilhada) para gravar
 * `assignedContentId` — exatamente um content por recipient (Property 5). Cada
 * recipient nasce `PENDING`, com `seq` determinístico crescente.
 */
export function addDispatchJob(
  state: ModelState,
  instanceId: string,
  input: DispatchJobInput
): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const assignments = assignContents(
      input.recipients.map((_r, i) => ({ id: `${input.jobId}:r${i}` })),
      input.contentIds.map((id) => ({ id })),
      input.mode,
      input.blockSize
    );

    const recipients: Record<string, DispatchRecipient> = { ...inst.recipients };
    input.recipients.forEach((r, i) => {
      const id = `${input.jobId}:r${i}`;
      recipients[id] = {
        id,
        instanceId,
        jobId: input.jobId,
        seq: i,
        status: 'PENDING',
        assignedContentId: assignments[i]?.contentId ?? input.contentIds[0] ?? '',
        recipientData: r.recipientData ?? { telefone: r.phone },
        sentAt: null,
        failureReason: null,
        providerMessageId: null,
      };
    });

    const job: DispatchJob = {
      id: input.jobId,
      instanceId,
      status: input.status ?? 'QUEUED',
      mode: input.mode,
      blockSize: input.blockSize,
      sendIntervalSec: input.sendIntervalSec,
      executionQuota: input.executionQuota,
      totalCount: input.recipients.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      execSentCount: 0,
      sourceJobId: input.sourceJobId ?? null,
      lastSendAt: null,
      failureCode: null,
    };

    return {
      ...inst,
      jobs: { ...inst.jobs, [input.jobId]: job },
      recipients,
    };
  });
}

/** Lê um job escopado à instância. */
export function getJob(
  state: ModelState,
  instanceId: string,
  jobId: string
): DispatchJob | undefined {
  return state.instances[instanceId]?.jobs[jobId];
}

/** Lista os recipients de um job (ordenados por `seq`), escopados à instância. */
export function listRecipients(
  state: ModelState,
  instanceId: string,
  jobId: string
): DispatchRecipient[] {
  const inst = state.instances[instanceId];
  if (!inst) {
    return [];
  }
  return Object.values(inst.recipients)
    .filter((r) => r.jobId === jobId)
    .sort((a, b) => a.seq - b.seq);
}

// ─── Claim atômico do próximo recipient PENDING (P3) ─────────────────────────

/**
 * Resultado do claim: o recipient reservado (`SENDING`) ou `null` se não há
 * `PENDING` elegível.
 */
export interface ClaimResult {
  state: ModelState;
  recipient: DispatchRecipient | null;
}

/**
 * Reserva atomicamente o próximo Dispatch_Recipient `PENDING` (menor `seq`),
 * marcando-o `SENDING` (espelha o `UPDATE ... FOR UPDATE SKIP LOCKED`). Apenas
 * recipients `PENDING` são elegíveis: um já `SENT` nunca é reivindicado de novo
 * (Req 10.4, 10.5) — base da idempotência por destinatário (Property 3).
 */
export function claimRecipient(state: ModelState, instanceId: string, jobId: string): ClaimResult {
  const inst = state.instances[instanceId];
  if (!inst) {
    return { state, recipient: null };
  }

  const next = Object.values(inst.recipients)
    .filter((r) => r.jobId === jobId && r.status === 'PENDING')
    .sort((a, b) => a.seq - b.seq)[0];

  if (!next) {
    return { state, recipient: null };
  }

  const claimed: DispatchRecipient = { ...next, status: 'SENDING' };
  const newState = updateInstance(state, instanceId, (i) => ({
    ...i,
    recipients: { ...i.recipients, [claimed.id]: claimed },
  }));
  return { state: newState, recipient: claimed };
}

/**
 * Marca um recipient `SENDING` como `SENT` (idempotente: um `SENT` permanece
 * `SENT`). Incrementa `sentCount` do job. Atualiza `lastSendAt` (pacing).
 */
export function markRecipientSent(
  state: ModelState,
  instanceId: string,
  recipientId: string,
  opts: { now?: number; providerMessageId?: string } = {}
): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const rec = inst.recipients[recipientId];
    if (!rec || rec.status === 'SENT') {
      return inst;
    }
    const job = inst.jobs[rec.jobId];
    const sentRec: DispatchRecipient = {
      ...rec,
      status: 'SENT',
      sentAt: opts.now ?? 0,
      providerMessageId: opts.providerMessageId ?? `${recipientId}:msg`,
    };
    const nextJobs = job
      ? {
          ...inst.jobs,
          [job.id]: {
            ...job,
            sentCount: job.sentCount + 1,
            lastSendAt: opts.now ?? job.lastSendAt,
          },
        }
      : inst.jobs;
    return {
      ...inst,
      recipients: { ...inst.recipients, [recipientId]: sentRec },
      jobs: nextJobs,
    };
  });
}

/** Marca um recipient `SENDING` como `FAILED` com motivo (pt-BR, sem segredos). */
export function markRecipientFailed(
  state: ModelState,
  instanceId: string,
  recipientId: string,
  failureReason: string
): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const rec = inst.recipients[recipientId];
    if (!rec || rec.status === 'SENT' || rec.status === 'FAILED') {
      return inst;
    }
    const job = inst.jobs[rec.jobId];
    const failedRec: DispatchRecipient = { ...rec, status: 'FAILED', failureReason };
    const nextJobs = job
      ? { ...inst.jobs, [job.id]: { ...job, failedCount: job.failedCount + 1 } }
      : inst.jobs;
    return {
      ...inst,
      recipients: { ...inst.recipients, [recipientId]: failedRec },
      jobs: nextJobs,
    };
  });
}

// ─── Worker tick: pacing + quota por execução (P3, P6) ───────────────────────

/** Opções de uma execução do worker. */
export interface TickOptions {
  /**
   * Instante virtual (epoch ms) do início da execução. Quando fornecido, o
   * pacing é exercitado via `shouldSendNow`, avançando um relógio interno em
   * `sendIntervalSec` a cada envio. Quando omitido, o pacing é desativado (todos
   * os envios elegíveis ocorrem) — útil para isolar a propriedade de quota (P6).
   */
  now?: number;
  /**
   * Decide, de forma determinística, se o envio do recipient falha. Default:
   * todos os envios são bem-sucedidos.
   */
  shouldFail?: (recipient: DispatchRecipient) => boolean;
}

/** Resultado de uma execução (tick) do worker. */
export interface TickResult {
  state: ModelState;
  /** Mensagens efetivamente enviadas (`SENT`) nesta execução. */
  sentThisExecution: number;
  job: DispatchJob | undefined;
}

/**
 * Executa **uma** fatia de trabalho (tick) do Job_Worker durável, espelhando o
 * laço descrito em `design.md` ("Modelo de execução do Job_Worker"):
 *
 *  1. O job passa a `RUNNING` e a execução reinicia `execSentCount = 0`.
 *  2. Enquanto houver `PENDING` E `execSentCount < executionQuota` E o pacing
 *     permitir (`shouldSendNow`), reivindica o próximo recipient e envia:
 *       - sucesso ⇒ `SENT`, `sentCount++`, `execSentCount++`, `lastSendAt = clock`;
 *       - falha   ⇒ `FAILED` + motivo (não conta para a quota — "efetivamente
 *         enviadas" são apenas os `SENT`, Property 6 / Req 8.5).
 *  3. Ao final:
 *       - sem `PENDING` restante ⇒ job `COMPLETED`;
 *       - quota atingida com `PENDING` restante ⇒ job `PAUSED` (Req 8.7).
 *
 * Idempotência (Property 3): um recipient `SENT` jamais é reivindicado de novo,
 * então repetir ticks (inclusive após "reinício") nunca reenvia.
 */
export function tickWorker(
  state: ModelState,
  instanceId: string,
  jobId: string,
  opts: TickOptions = {}
): TickResult {
  let working = state;
  const startJob = getJob(working, instanceId, jobId);

  // Só jobs acionáveis executam (espelha claim_due_jobs: QUEUED/RUNNING/PAUSED).
  if (!startJob || !['QUEUED', 'RUNNING', 'PAUSED'].includes(startJob.status)) {
    return { state, sentThisExecution: 0, job: startJob };
  }

  // Início da execução: RUNNING + zera a quota da execução corrente.
  working = updateInstance(working, instanceId, (inst) => ({
    ...inst,
    jobs: { ...inst.jobs, [jobId]: { ...inst.jobs[jobId], status: 'RUNNING', execSentCount: 0 } },
  }));

  const intervalSec = startJob.sendIntervalSec;
  const pacingEnabled = opts.now !== undefined;
  let clock = opts.now ?? 0;
  let sentThisExecution = 0;

  for (;;) {
    const job = getJob(working, instanceId, jobId);
    if (!job) {
      break;
    }
    // Quota da execução atingida: para (pode restar PENDING ⇒ PAUSED depois).
    if (job.execSentCount >= job.executionQuota) {
      break;
    }
    // Pacing por relógio (Req 8.6): só envia se o intervalo já venceu.
    if (pacingEnabled && !shouldSendNow(clock, job.lastSendAt, intervalSec)) {
      break;
    }

    const { state: afterClaim, recipient } = claimRecipient(working, instanceId, jobId);
    working = afterClaim;
    if (!recipient) {
      // Sem PENDING elegível: execução drena.
      break;
    }

    const fails = opts.shouldFail?.(recipient) ?? false;
    if (fails) {
      working = markRecipientFailed(working, instanceId, recipient.id, 'Falha no envio.');
      // Falha não conta para a quota; avança apenas o relógio de tentativa.
      if (pacingEnabled) {
        clock += intervalSec * 1000;
      }
      continue;
    }

    working = markRecipientSent(working, instanceId, recipient.id, { now: clock });
    sentThisExecution += 1;
    working = updateInstance(working, instanceId, (inst) => ({
      ...inst,
      jobs: {
        ...inst.jobs,
        [jobId]: { ...inst.jobs[jobId], execSentCount: inst.jobs[jobId].execSentCount + 1 },
      },
    }));
    if (pacingEnabled) {
      clock += intervalSec * 1000;
    }
  }

  // Estado terminal da execução: COMPLETED se nada pendente, senão PAUSED.
  const pendingLeft = listRecipients(working, instanceId, jobId).some(
    (r) => r.status === 'PENDING' || r.status === 'SENDING'
  );
  working = updateInstance(working, instanceId, (inst) => ({
    ...inst,
    jobs: {
      ...inst.jobs,
      [jobId]: { ...inst.jobs[jobId], status: pendingLeft ? 'PAUSED' : 'COMPLETED' },
    },
  }));

  return {
    state: working,
    sentThisExecution,
    job: getJob(working, instanceId, jobId),
  };
}

/**
 * "Continuar" (RESUME): um job `PAUSED` volta a `QUEUED` e zera a quota da
 * execução (Req 9.3) — o próximo tick reinicia o drain dos `PENDING` restantes.
 */
export function resumeJob(state: ModelState, instanceId: string, jobId: string): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const job = inst.jobs[jobId];
    if (!job || job.status !== 'PAUSED') {
      return inst;
    }
    return {
      ...inst,
      jobs: { ...inst.jobs, [jobId]: { ...job, status: 'QUEUED', execSentCount: 0 } },
    };
  });
}

// ─── Failed_Resend (P3) ──────────────────────────────────────────────────────

/** Resultado do Failed_Resend: novo job ou skip quando não há `FAILED`. */
export type ResendResult =
  | { state: ModelState; skipped: false; newJobId: string; resentCount: number }
  | { state: ModelState; skipped: true; reason: 'NO_FAILED_RECIPIENTS' };

/**
 * Cria um novo Dispatch_Job contendo **apenas** os recipients `FAILED` do job de
 * origem (re-enfileirados como `PENDING`), preservando o original e **nunca**
 * incluindo nenhum `SENT` (Req 23.3, 23.4). Sem `FAILED` ⇒ `_SKIPPED`
 * (`NO_FAILED_RECIPIENTS`, Req 23.5). Base da segunda metade da Property 3.
 */
export function resendFailed(
  state: ModelState,
  instanceId: string,
  sourceJobId: string,
  newJobId: string
): ResendResult {
  const sourceJob = getJob(state, instanceId, sourceJobId);
  if (!sourceJob) {
    return { state, skipped: true, reason: 'NO_FAILED_RECIPIENTS' };
  }

  const failed = listRecipients(state, instanceId, sourceJobId).filter(
    (r) => r.status === 'FAILED'
  );
  if (failed.length === 0) {
    return { state, skipped: true, reason: 'NO_FAILED_RECIPIENTS' };
  }

  const newState = updateInstance(state, instanceId, (inst) => {
    const recipients: Record<string, DispatchRecipient> = { ...inst.recipients };
    failed.forEach((src, i) => {
      const id = `${newJobId}:r${i}`;
      recipients[id] = {
        ...src,
        id,
        jobId: newJobId,
        seq: i,
        status: 'PENDING',
        sentAt: null,
        failureReason: null,
        providerMessageId: null,
      };
    });

    const newJob: DispatchJob = {
      ...sourceJob,
      id: newJobId,
      status: 'QUEUED',
      totalCount: failed.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      execSentCount: 0,
      sourceJobId,
      lastSendAt: null,
      failureCode: null,
    };

    return { ...inst, jobs: { ...inst.jobs, [newJobId]: newJob }, recipients };
  });

  return { state: newState, skipped: false, newJobId, resentCount: failed.length };
}

// ─── Conversas e transições de Conversation_Mode (P2) ────────────────────────

/** Garante a existência de uma Conversation (cria em `AI_MODE` se nova — Req 31.3). */
export function upsertConversation(
  state: ModelState,
  instanceId: string,
  contactPhone: string,
  now = 0
): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const existing = Object.values(inst.conversations).find((c) => c.contactPhone === contactPhone);
    if (existing) {
      return inst;
    }
    const id = `${instanceId}:conv:${contactPhone}`;
    const conv: Conversation = { id, instanceId, contactPhone, mode: 'AI_MODE', updatedAt: now };
    return { ...inst, conversations: { ...inst.conversations, [id]: conv } };
  });
}

/**
 * Aplica uma transição de Conversation_Mode (Req 31). Define o modo alvo
 * diretamente (a validação de transições válidas/inválidas é exercitada pelos
 * testes unitários da tarefa 17.3; aqui o foco é montar cenários para P2).
 */
export function applyConversationTransition(
  state: ModelState,
  instanceId: string,
  conversationId: string,
  targetMode: ConversationMode,
  now = 0
): ModelState {
  return updateInstance(state, instanceId, (inst) => {
    const conv = inst.conversations[conversationId];
    if (!conv) {
      return inst;
    }
    return {
      ...inst,
      conversations: {
        ...inst.conversations,
        [conversationId]: { ...conv, mode: targetMode, updatedAt: now },
      },
    };
  });
}

/** Lê uma Conversation por telefone, escopada à instância. */
export function getConversation(
  state: ModelState,
  instanceId: string,
  contactPhone: string
): Conversation | undefined {
  const inst = state.instances[instanceId];
  if (!inst) {
    return undefined;
  }
  return Object.values(inst.conversations).find((c) => c.contactPhone === contactPhone);
}

// ─── Webhook inbound: idempotência + guarda de modo (P2, P9) ─────────────────

export interface WebhookEventInput {
  instanceId: string;
  providerEventId: string;
  contactPhone: string;
  body: string;
  /** Instante virtual (epoch ms) do processamento. */
  now?: number;
  /** Simula erro do provedor de IA ao gerar a resposta (Req 16.4). */
  aiProviderError?: boolean;
}

/** Resultado do processamento de um evento inbound. */
export interface WebhookResult {
  state: ModelState;
  /** Houve novo auto-reply enviado neste processamento? */
  replied: boolean;
  /** Status do registro de idempotência para este evento (se houve decisão). */
  replyStatus: AiReplyStatus | null;
  /** O evento já havia sido processado antes (idempotência — Req 16.6). */
  duplicate: boolean;
}

/**
 * Processa um evento inbound de webhook, espelhando a Edge Function
 * `whatsapp-webhook` (`design.md` "Caminho de auto-reply"):
 *
 *  - **Idempotência por evento (P9, Req 16.6, 31.12):** se já existe um
 *    `ai_reply` para `(instanceId, providerEventId)`, o reprocessamento é no-op
 *    (no máximo um auto-reply por evento, qualquer que seja o nº de reentregas).
 *  - Faz upsert da Conversation (cria em `AI_MODE` se nova) e registra a mensagem
 *    inbound (dedup por `providerEventId`).
 *  - **Guarda de modo (P2, Req 31.2/31.5/31.11):** o auto-reply só é `SENT` quando
 *    o modo é AI-allowed (`AI_MODE`/`RETURNED_TO_AI`) E a IA está habilitada com
 *    `hasApiKey`. Em `HUMAN_MODE`/`AI_PAUSED`/desabilitado ⇒ `BLOCKED` (sem envio).
 *    Erro do provedor ⇒ `AI_PROVIDER_ERROR` (sem envio, Req 16.4).
 */
export function processWebhookEvent(state: ModelState, input: WebhookEventInput): WebhookResult {
  const inst = state.instances[input.instanceId];
  if (!inst) {
    return { state, replied: false, replyStatus: null, duplicate: false };
  }

  // Idempotência: evento já decidido ⇒ no-op (no máximo um auto-reply — P9).
  if (inst.aiReplies[input.providerEventId]) {
    return { state, replied: false, replyStatus: null, duplicate: true };
  }

  const now = input.now ?? 0;

  // Upsert da conversa (cria em AI_MODE se nova) e mensagem inbound.
  let working = upsertConversation(state, input.instanceId, input.contactPhone, now);
  const conv = getConversation(working, input.instanceId, input.contactPhone);
  // `conv` sempre existe após o upsert; o guard mantém o TypeScript estrito feliz.
  if (!conv) {
    return { state: working, replied: false, replyStatus: null, duplicate: false };
  }

  working = updateInstance(working, input.instanceId, (i) => {
    const msgId = `${input.instanceId}:msg:${input.providerEventId}`;
    if (i.messages[msgId]) {
      return i; // dedup INSERT ... ON CONFLICT DO NOTHING
    }
    const message: Message = {
      id: msgId,
      instanceId: input.instanceId,
      conversationId: conv.id,
      direction: 'INBOUND',
      body: input.body,
      providerEventId: input.providerEventId,
    };
    return { ...i, messages: { ...i.messages, [msgId]: message } };
  });

  // Guarda de modo + habilitação da IA (responsável único — P2).
  const aiConfig = working.instances[input.instanceId].aiConfig;
  const modeAllowsAi = AI_ALLOWED_MODES.includes(conv.mode);
  const aiCanReply = modeAllowsAi && aiConfig.enabled && aiConfig.hasApiKey;

  let status: AiReplyStatus;
  let replied = false;
  if (!aiCanReply) {
    status = 'BLOCKED';
  } else if (input.aiProviderError) {
    status = 'AI_PROVIDER_ERROR';
  } else {
    status = 'SENT';
    replied = true;
  }

  // Registra o ai_reply (UNIQUE instância+evento) — fecha a idempotência (P9).
  working = updateInstance(working, input.instanceId, (i) => {
    const aiReply: AiReply = {
      instanceId: input.instanceId,
      providerEventId: input.providerEventId,
      conversationId: conv.id,
      status,
    };
    let messages = i.messages;
    if (replied) {
      const replyId = `${input.instanceId}:reply:${input.providerEventId}`;
      const replyBody = renderMessage('Olá {{nome}}', conv ? { telefone: conv.contactPhone } : {});
      messages = {
        ...messages,
        [replyId]: {
          id: replyId,
          instanceId: input.instanceId,
          conversationId: conv.id,
          direction: 'OUTBOUND',
          body: replyBody,
          providerEventId: null,
        },
      };
    }
    return {
      ...i,
      messages,
      aiReplies: { ...i.aiReplies, [input.providerEventId]: aiReply },
    };
  });

  return { state: working, replied, replyStatus: status, duplicate: false };
}

/** Conta os auto-replies registrados para um evento (deve ser ≤ 1 — P9). */
export function countAutoReplies(
  state: ModelState,
  instanceId: string,
  providerEventId: string
): number {
  const inst = state.instances[instanceId];
  if (!inst) {
    return 0;
  }
  return inst.aiReplies[providerEventId] ? 1 : 0;
}

/** Lista as mensagens OUTBOUND (auto-replies enviados) de uma instância. */
export function listOutboundMessages(state: ModelState, instanceId: string): Message[] {
  const inst = state.instances[instanceId];
  if (!inst) {
    return [];
  }
  return Object.values(inst.messages).filter((m) => m.direction === 'OUTBOUND');
}
