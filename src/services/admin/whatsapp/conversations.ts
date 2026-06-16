/**
 * Central de Conversas (Conversation_Inbox) — camada de serviço (TypeScript).
 *
 * Envolve as RPCs de LEITURA `whatsapp_list_conversations` /
 * `whatsapp_get_conversation` (migration 104) que materializam o
 * Conversation_Inbox da Active_Instance (Req 30). Tudo é escopado por
 * `instance_id`: a lista e o detalhe só retornam Conversations da própria
 * instância, nunca de outra (isolamento multi-instância — Req 30.1, 30.6,
 * 31.18).
 *
 * - `listConversations` e `getConversation` são LEITURAS: chamam a RPC
 *   diretamente (gating `SETTINGS_VIEW` revalidado no servidor — Req 30.7) e
 *   NUNCA auditam. Por não serem mutações, não passam por `executeAdminMutation`.
 * - As transições de Conversation_Mode (Human_Takeover / Return_To_AI / handoff
 *   automático da IA, Req 31) são MUTAÇÕES: chamam a RPC
 *   `whatsapp_transition_conversation_mode` (migration 109) sob lock
 *   (`SELECT mode FOR UPDATE`) e, em transição válida, gravam o audit
 *   (modo anterior/novo, `instance_id`, conversa) via `executeAdminMutation`
 *   (audit-by-construction). Tratam `_SKIPPED` (idempotência), `STALE_VERSION`
 *   (versionamento otimista) e `INVALID_CONVERSATION_MODE` (ação fora do
 *   domínio fechado). Ver `transitionConversationMode`/`humanTakeover`/
 *   `returnToAi` ao final deste módulo.
 *
 * Anti-enumeração (Req 30.8): um `conversation_id` inexistente ou pertencente a
 * outra instância produz, no servidor, o marker canônico `WHATSAPP_NOT_FOUND`
 * (ERRCODE `P0001`), mapeado aqui para a Canonical_Message pt-BR
 * `Não foi possível concluir a operação.` via `mapInstanceGuardError` (guards.ts)
 * — resposta indistinguível, sem revelar a existência da Conversation.
 *
 * As linhas cruas (snake_case) das RPCs são convertidas para o shape camelCase
 * da camada de serviço.
 *
 * Identifiers/codes em inglês; mensagens user-facing em pt-BR.
 */

import { supabase } from '../../supabase';
import { executeAdminMutation } from '../audit';
import { mapInstanceGuardError, isInstanceGuardError, type SupabaseLikeError } from './guards';
import type { MutationResult } from './dispatch';

/**
 * Conversation_Mode — domínio fechado do responsável único por conversa
 * (Req 31.1). Espelha o domínio `conversation_mode` do SQL (migration 092).
 */
export type ConversationMode = 'AI_MODE' | 'HUMAN_MODE' | 'AI_PAUSED' | 'RETURNED_TO_AI';

/** Direção de uma mensagem do histórico (espelha o domínio `msg_direction`). */
export type MessageDirection = 'INBOUND' | 'OUTBOUND';

/**
 * Item da lista do Conversation_Inbox (Req 30.2): identificador do contato,
 * prévia e horário da última mensagem e o Conversation_Mode atual.
 */
export interface ConversationListItem {
  id: string;
  contactPhone: string;
  mode: ConversationMode;
  responderLock: 'AI' | 'HUMAN' | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mensagem do histórico cronológico de uma Conversation (Req 30.3). */
export interface ConversationMessage {
  id: string;
  direction: MessageDirection;
  body: string | null;
  createdAt: string;
}

/**
 * Detalhe de uma Conversation + histórico completo em ordem cronológica
 * ascendente (Req 30.3).
 */
export interface ConversationDetail {
  id: string;
  contactPhone: string;
  mode: ConversationMode;
  responderLock: 'AI' | 'HUMAN' | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

/** Filtros opcionais da listagem do Conversation_Inbox. */
export interface ListConversationsFilters {
  /** Filtra por Conversation_Mode; omitido/`null` = todas. */
  mode?: ConversationMode | null;
  /** Tamanho da página (default 50 no servidor; hard cap 200). */
  limit?: number;
  /** Deslocamento da página (default 0). */
  offset?: number;
}

/** Forma crua (snake_case) de um item da lista retornado pela RPC. */
interface ConversationListRow {
  id: string;
  contact_phone: string;
  mode: ConversationMode;
  responder_lock: 'AI' | 'HUMAN' | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Forma crua (snake_case) de uma mensagem retornada pela RPC de detalhe. */
interface ConversationMessageRow {
  id: string;
  direction: MessageDirection;
  body: string | null;
  created_at: string;
}

/** Forma crua (snake_case) do detalhe da conversa retornado pela RPC. */
interface ConversationDetailRow extends ConversationListRow {
  messages: ConversationMessageRow[] | null;
}

/** Converte um item cru (snake_case) da lista para o shape camelCase. */
function mapConversationListItem(row: ConversationListRow): ConversationListItem {
  return {
    id: row.id,
    contactPhone: row.contact_phone,
    mode: row.mode,
    responderLock: row.responder_lock,
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Converte uma mensagem crua (snake_case) para o shape camelCase. */
function mapConversationMessage(row: ConversationMessageRow): ConversationMessage {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Converte o detalhe cru (snake_case) da conversa + histórico para camelCase. */
function mapConversationDetail(row: ConversationDetailRow): ConversationDetail {
  return {
    ...mapConversationListItem(row),
    messages: (row.messages ?? []).map(mapConversationMessage),
  };
}

/**
 * Lista as Conversations da Active_Instance (Req 30.1, 30.2, 30.6), em ordem
 * cronológica inversa (a mais recente primeiro), com contato, prévia, horário e
 * Conversation_Mode. Filtro opcional por modo e paginação leve.
 *
 * LEITURA — não audita. O gating `SETTINGS_VIEW` é revalidado no servidor
 * (Req 30.7) e o isolamento por instância é garantido server-side (Req 30.6).
 *
 * @throws `Error` com a mensagem mapeada (anti-enumeração quando aplicável:
 *   instância inexistente/cruzada ⇒ `Não foi possível concluir a operação.`).
 */
export async function listConversations(
  instanceId: string,
  filters?: ListConversationsFilters
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase.rpc('whatsapp_list_conversations', {
    p_instance_id: instanceId,
    p_mode: filters?.mode ?? null,
    p_limit: filters?.limit ?? null,
    p_offset: filters?.offset ?? null,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  const rows = (data as ConversationListRow[] | null) ?? [];
  return rows.map(mapConversationListItem);
}

/**
 * Abre uma Conversation da Active_Instance e retorna o histórico completo de
 * mensagens (recebidas e enviadas) em ordem cronológica (Req 30.3).
 *
 * LEITURA — não audita. O gating `SETTINGS_VIEW` é revalidado no servidor
 * (Req 30.7). Um `conversationId` inexistente ou de OUTRA instância produz a
 * Canonical_Message anti-enumeração, sem revelar existência (Req 30.6, 30.8).
 *
 * @throws `Error` com a mensagem mapeada — `Não foi possível concluir a
 *   operação.` para conversa inexistente/cruzada.
 */
export async function getConversation(
  instanceId: string,
  conversationId: string
): Promise<ConversationDetail> {
  const { data, error } = await supabase.rpc('whatsapp_get_conversation', {
    p_instance_id: instanceId,
    p_conversation_id: conversationId,
  });

  if (error) {
    throw new Error(mapInstanceGuardError(error));
  }

  return mapConversationDetail(data as ConversationDetailRow);
}

/* ========================================================================== *
 * Transições de Conversation_Mode — camada de serviço (I/O via RPC)          *
 *                                                                            *
 * Envolve a RPC `whatsapp_transition_conversation_mode` (migration 109, task *
 * 17.2), contraparte server-side das ações "Assumir Atendimento"             *
 * (Human_Takeover) e "Retornar para IA" (Return_To_AI) do Conversation_Inbox *
 * e do handoff AUTOMÁTICO da IA (AI_Handoff_Message → HUMAN_MODE). A RPC      *
 * aplica a máquina de estados do Conversation_Mode SOB LOCK                  *
 * (`SELECT mode FOR UPDATE`), escopada por `instance_id` + `conversation_id`, *
 * e devolve um de dois formatos:                                             *
 *                                                                            *
 *  - Transição VÁLIDA: `{ ok, id, instance_id, action, previous_mode, mode,  *
 *    updated_at }`. A mutação real já ocorreu no servidor; aqui registramos o *
 *    AUDIT positivo (Req 31.13) via `executeAdminMutation` (audit-by-         *
 *    construction, admin-patterns #1) com `before = previous_mode` e          *
 *    `after = mode`, sempre incluindo o `instance_id` e a conversa.          *
 *                                                                            *
 *  - IDEMPOTÊNCIA (`_SKIPPED`, Req 31.15): `{ skipped, reason }`. A RPC NÃO   *
 *    mutou e JÁ gravou o log `WHATSAPP_CONVERSATION_<ACTION>_SKIPPED` por     *
 *    dentro (admin-patterns #4). NÃO auditamos de novo — apenas propagamos o  *
 *    skip para a UI exibir um toast neutro.                                  *
 *                                                                            *
 * Por isso a RPC é chamada ANTES de `executeAdminMutation`: só após o retorno *
 * sabemos (a) se houve mutação (válida) ou skip, e (b) os valores            *
 * `previous_mode`/`mode` exigidos no before/after do audit.                  *
 *                                                                            *
 * Markers de erro (ERRCODE P0001) mapeados aqui:                            *
 *  - `STALE_VERSION`              → propagado como código inglês (toast        *
 *    "Outro admin atualizou", admin-patterns #3, Req 31.14).                 *
 *  - `INVALID_CONVERSATION_MODE`  → propagado como código inglês (Req 31.20;  *
 *    a UI o reconhece e exibe o aviso adequado).                            *
 *  - `WHATSAPP_NOT_FOUND`         → Canonical_Message anti-enumeração          *
 *    `Não foi possível concluir a operação.` (via guards.ts, Req 30.8,        *
 *    31.18) — conversa inexistente/cruzada entre instâncias.                 *
 * ========================================================================== */

/**
 * Ação de transição de Conversation_Mode (domínio fechado, espelha a RPC):
 * - `HUMAN_TAKEOVER`: "Assumir Atendimento" → `HUMAN_MODE` (Req 31.6).
 * - `RETURN_TO_AI`: "Retornar para IA" → `RETURNED_TO_AI` (Req 31.7).
 * - `AI_HANDOFF`: handoff automático da IA → `HUMAN_MODE`, registrando a
 *   AI_Handoff_Message no histórico (Req 31.4).
 */
export type ConversationModeAction = 'HUMAN_TAKEOVER' | 'RETURN_TO_AI' | 'AI_HANDOFF';

/**
 * Error code (inglês) para uma transição de Conversation_Mode fora do domínio
 * fechado (Req 31.20). Propagado como `Error.message` para a UI reconhecer.
 */
export const WHATSAPP_INVALID_CONVERSATION_MODE = 'INVALID_CONVERSATION_MODE' as const;

/**
 * Resultado de uma transição de Conversation_Mode VÁLIDA, exposto à camada de
 * serviço (camelCase). Carrega o modo anterior e o novo (para o audit e para a
 * UI refletir a mudança) e a nova versão otimista (`updatedAt`).
 */
export interface ConversationModeTransition {
  id: string;
  instanceId: string;
  action: ConversationModeAction;
  /** Conversation_Mode imediatamente anterior à transição (before do audit). */
  previousMode: ConversationMode;
  /** Conversation_Mode resultante da transição (after do audit). */
  mode: ConversationMode;
  /** Nova versão otimista da linha (ISO) para chamadas subsequentes. */
  updatedAt: string;
}

/** Forma crua (snake_case) da transição válida retornada pela RPC. */
interface RawConversationModeTransition {
  ok: true;
  id: string;
  instance_id: string;
  action: ConversationModeAction;
  previous_mode: ConversationMode;
  mode: ConversationMode;
  updated_at: string;
}

/** Forma crua do retorno idempotente (`_SKIPPED`) da RPC. */
interface RawConversationModeSkip {
  skipped: true;
  reason: string;
}

/**
 * Mapa marker (SQL) → mensagem/código propagado pela camada TS. `STALE_VERSION`
 * e `INVALID_CONVERSATION_MODE` são mantidos como códigos em inglês para que os
 * chamadores os reconheçam (admin-patterns #3 / Req 31.20); `WHATSAPP_NOT_FOUND`
 * é tratado à parte pelos helpers de `guards.ts` (Canonical_Message
 * anti-enumeração).
 */
const CONVERSATION_MODE_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CONVERSATION_MODE: 'INVALID_CONVERSATION_MODE',
  STALE_VERSION: 'STALE_VERSION',
};

/** Concatena os campos textuais de um erro Supabase-like para busca de marker. */
function conversationErrorText(error: unknown): string {
  if (error == null || typeof error !== 'object') {
    return typeof error === 'string' ? error : '';
  }
  const err = error as SupabaseLikeError;
  return [err.message, err.details, err.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
}

/**
 * Mapeia um erro da RPC de transição de modo para a mensagem/código apropriado:
 * `WHATSAPP_NOT_FOUND` → Canonical_Message anti-enumeração (precedência);
 * `STALE_VERSION`/`INVALID_CONVERSATION_MODE` → código inglês reconhecível;
 * demais → fallback seguro (mensagem do erro ou Canonical_Message).
 */
function mapTransitionConversationModeError(error: unknown): string {
  // Anti-enumeração (instância/conversa inexistente ou cruzada) tem precedência.
  if (isInstanceGuardError(error)) {
    return mapInstanceGuardError(error);
  }

  const text = conversationErrorText(error);
  for (const [marker, message] of Object.entries(CONVERSATION_MODE_ERROR_MESSAGES)) {
    if (text.includes(marker)) {
      return message;
    }
  }

  return mapInstanceGuardError(error);
}

/**
 * Aplica uma transição de Conversation_Mode a uma Conversation da
 * Active_Instance via RPC `whatsapp_transition_conversation_mode` (Req 31.4,
 * 31.6, 31.7, 31.13–31.20).
 *
 * Fluxo:
 * 1. Chama a RPC com o `expectedUpdatedAt` (versionamento otimista, Req 31.14).
 *    A RPC trava a conversa (`SELECT mode FOR UPDATE`), revalida `SETTINGS_EDIT`
 *    e o isolamento por instância/conversa no servidor.
 * 2. Se a RPC sinalizar idempotência (`_SKIPPED`, Req 31.15), retorna
 *    `{ skipped, reason }` SEM auditar de novo — a própria RPC já gravou o log
 *    `WHATSAPP_CONVERSATION_<ACTION>_SKIPPED`.
 * 3. Em transição válida, registra o audit positivo (Req 31.13) via
 *    `executeAdminMutation` com `before = previous_mode`, `after = mode` e o
 *    `instance_id` + identificador da conversa, e devolve `{ ok, data,
 *    updated_at }`.
 *
 * Erros: `STALE_VERSION` (Req 31.14) e `INVALID_CONVERSATION_MODE` (Req 31.20)
 * são propagados como códigos em inglês; `WHATSAPP_NOT_FOUND` vira a
 * Canonical_Message anti-enumeração `Não foi possível concluir a operação.`
 * (conversa inexistente/cruzada — Req 30.8, 31.18). O histórico de mensagens é
 * sempre preservado pelo servidor (Req 31.19).
 *
 * @param instanceId        Active_Instance alvo (escopo exclusivo).
 * @param conversationId    Conversation a transicionar.
 * @param action            Ação (`HUMAN_TAKEOVER`/`RETURN_TO_AI`/`AI_HANDOFF`).
 * @param expectedUpdatedAt Versão otimista lida antes de acionar a transição.
 * @returns `MutationResult<ConversationModeTransition>` — `{ ok, data,
 *          updated_at }` na transição válida; `{ skipped, reason }` na
 *          idempotência.
 * @throws `Error` com código inglês (`STALE_VERSION`/`INVALID_CONVERSATION_MODE`)
 *         ou Canonical_Message anti-enumeração (`WHATSAPP_NOT_FOUND`).
 */
export async function transitionConversationMode(
  instanceId: string,
  conversationId: string,
  action: ConversationModeAction,
  expectedUpdatedAt: string
): Promise<MutationResult<ConversationModeTransition>> {
  // (1) RPC chamada PRIMEIRO: o retorno distingue skip (idempotência, já
  //     auditada pela RPC) de transição válida e fornece previous_mode/mode
  //     exigidos no before/after do audit positivo.
  const { data, error } = await supabase.rpc('whatsapp_transition_conversation_mode', {
    p_instance_id: instanceId,
    p_conversation_id: conversationId,
    p_action: action,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    throw new Error(mapTransitionConversationModeError(error));
  }

  const result = data as RawConversationModeTransition | RawConversationModeSkip;

  // (2) Idempotência (_SKIPPED, Req 31.15): NÃO há mutação e o log `_SKIPPED` já
  //     foi gravado dentro da RPC — apenas propagamos o skip (não auditar de novo).
  if ('skipped' in result) {
    return { skipped: true, reason: result.reason };
  }

  // (3) Transição válida: materializa o shape camelCase e registra o audit
  //     positivo (Req 31.13) via executeAdminMutation. A mutação real já ocorreu
  //     no servidor; a `fn` apenas expõe o resultado obtido, de modo que o
  //     wrapper grave o log before/after por construção (admin-patterns #1).
  const transition: ConversationModeTransition = {
    id: result.id,
    instanceId: result.instance_id,
    action: result.action,
    previousMode: result.previous_mode,
    mode: result.mode,
    updatedAt: result.updated_at,
  };

  return executeAdminMutation(
    {
      action: 'WHATSAPP_CONVERSATION_MODE_TRANSITION',
      targetType: 'whatsapp_conversations',
      targetId: conversationId,
      // Inclui sempre o instance_id e o identificador da conversa no audit, com
      // o modo anterior/novo (Req 31.13, 30.9).
      before: {
        instance_id: instanceId,
        conversation_id: conversationId,
        mode: transition.previousMode,
      },
      after: {
        instance_id: instanceId,
        conversation_id: conversationId,
        action: transition.action,
        mode: transition.mode,
      },
    },
    async () => ({ ok: true, data: transition, updated_at: transition.updatedAt })
  );
}

/**
 * "Assumir Atendimento" (Human_Takeover, Req 31.6): transiciona a Conversation
 * para `HUMAN_MODE`, travando a IA imediatamente. Conveniência sobre
 * `transitionConversationMode` com a ação `HUMAN_TAKEOVER`.
 *
 * @param instanceId        Active_Instance alvo.
 * @param conversationId    Conversation a assumir.
 * @param expectedUpdatedAt Versão otimista lida antes de acionar a ação.
 */
export async function humanTakeover(
  instanceId: string,
  conversationId: string,
  expectedUpdatedAt: string
): Promise<MutationResult<ConversationModeTransition>> {
  return transitionConversationMode(
    instanceId,
    conversationId,
    'HUMAN_TAKEOVER',
    expectedUpdatedAt
  );
}

/**
 * "Retornar para IA" (Return_To_AI, Req 31.7): devolve a Conversation à IA
 * (`RETURNED_TO_AI`), que volta a responder usando o histórico completo
 * preservado (Req 31.8, 31.19). Conveniência sobre `transitionConversationMode`
 * com a ação `RETURN_TO_AI`.
 *
 * @param instanceId        Active_Instance alvo.
 * @param conversationId    Conversation a devolver à IA.
 * @param expectedUpdatedAt Versão otimista lida antes de acionar a ação.
 */
export async function returnToAi(
  instanceId: string,
  conversationId: string,
  expectedUpdatedAt: string
): Promise<MutationResult<ConversationModeTransition>> {
  return transitionConversationMode(instanceId, conversationId, 'RETURN_TO_AI', expectedUpdatedAt);
}
