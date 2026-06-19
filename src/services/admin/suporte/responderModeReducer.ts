/**
 * responderModeReducer.ts — modelo testável da exclusão mútua IA×humano.
 *
 * Reducer puro (sem I/O) que modela, em memória, o efeito das operações sobre
 * `{ responderMode, status, messages[] }`, espelhando a semântica das RPCs
 * `support_*` (migration 115b). Permite verificar, por property testing
 * (model-based), o invariante de exclusão mútua (CP1) e a idempotência de
 * Handoff/Return_To_AI (CP4) sem tocar o banco.
 *
 * Regra de ouro (CP1): nenhuma mensagem `author_kind='ai'` é persistida
 * enquanto `responderMode === 'human'`; toda resposta humana iniciada em `ai`
 * faz o flip atômico para `human` ANTES de aceitar a mensagem.
 *
 * Validates: Requirements 7.1, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 9.2, 9.4
 */

import type { TicketStatus } from './statusMachine';

export type ResponderMode = 'ai' | 'human';
export type AuthorKind = 'user' | 'admin' | 'ai';

export interface TicketMessage {
  readonly authorKind: AuthorKind;
  /** Modo vigente no instante em que a mensagem foi persistida (auditoria do invariante). */
  readonly modeAtInsert: ResponderMode;
}

/** Resultado da última operação aplicada (espelha os retornos das RPCs). */
export type OpResult =
  | 'applied'
  | 'ai_locked' // ai_reply_attempt sob responderMode='human' (Req 8.3)
  | 'skipped_already_human' // handoff quando já 'human' (Req 7.5)
  | 'skipped_already_ai'; // return_to_ai quando já 'ai' (Req 9.4)

export interface TicketModel {
  readonly responderMode: ResponderMode;
  readonly status: TicketStatus;
  readonly messages: readonly TicketMessage[];
  readonly handoffAt: number | null;
  readonly returnedToAiAt: number | null;
  /** Contador monotônico de operações aplicadas (ordenação determinística). */
  readonly clock: number;
  readonly lastResult: OpResult;
}

export type Op =
  | { kind: 'customer_message' }
  | { kind: 'ai_reply_attempt' }
  | { kind: 'human_reply' }
  | { kind: 'handoff' }
  | { kind: 'return_to_ai' };

/** Estado inicial de um atendimento (default: modo IA, status open). */
export function initialTicket(partial?: Partial<TicketModel>): TicketModel {
  return {
    responderMode: 'ai',
    status: 'open',
    messages: [],
    handoffAt: null,
    returnedToAiAt: null,
    clock: 0,
    lastResult: 'applied',
    ...partial,
  };
}

function append(messages: readonly TicketMessage[], msg: TicketMessage): TicketMessage[] {
  return [...messages, msg];
}

/** Reabre waiting_customer/resolved → in_progress; nunca toca `closed` (Req 3.10). */
function reopenOnUserMessage(status: TicketStatus): TicketStatus {
  return status === 'waiting_customer' || status === 'resolved' ? 'in_progress' : status;
}

/** Handoff transiciona para in_progress, salvo terminal `closed` (Req 7.3). */
function statusOnHandoff(status: TicketStatus): TicketStatus {
  return status === 'closed' ? 'closed' : 'in_progress';
}

/**
 * Aplica uma operação ao estado, retornando o novo estado. Puro e determinístico.
 */
export function applyOp(state: TicketModel, op: Op): TicketModel {
  const clock = state.clock + 1;

  switch (op.kind) {
    // Cliente envia mensagem: sempre persiste; reabre se waiting_customer/resolved.
    case 'customer_message':
      return {
        ...state,
        clock,
        messages: append(state.messages, { authorKind: 'user', modeAtInsert: state.responderMode }),
        status: reopenOnUserMessage(state.status),
        lastResult: 'applied',
      };

    // IA tenta responder: só persiste sob modo 'ai'; sob 'human' => AI_LOCKED.
    case 'ai_reply_attempt':
      if (state.responderMode === 'human') {
        return { ...state, clock, lastResult: 'ai_locked' };
      }
      return {
        ...state,
        clock,
        messages: append(state.messages, { authorKind: 'ai', modeAtInsert: 'ai' }),
        status: state.status === 'closed' ? 'closed' : 'resolved',
        lastResult: 'applied',
      };

    // Resposta humana: se modo 'ai', faz flip atômico p/ 'human' ANTES de aceitar.
    case 'human_reply': {
      const flipped = state.responderMode === 'ai';
      return {
        ...state,
        clock,
        responderMode: 'human',
        handoffAt: flipped ? clock : state.handoffAt,
        status: flipped ? statusOnHandoff(state.status) : state.status,
        messages: append(state.messages, { authorKind: 'admin', modeAtInsert: 'human' }),
        lastResult: 'applied',
      };
    }

    // Handoff explícito: ai→human idempotente (já 'human' => _SKIPPED).
    case 'handoff':
      if (state.responderMode === 'human') {
        return { ...state, clock, lastResult: 'skipped_already_human' };
      }
      return {
        ...state,
        clock,
        responderMode: 'human',
        handoffAt: clock,
        status: statusOnHandoff(state.status),
        lastResult: 'applied',
      };

    // Return_To_AI: human→ai idempotente (já 'ai' => _SKIPPED).
    case 'return_to_ai':
      if (state.responderMode === 'ai') {
        return { ...state, clock, lastResult: 'skipped_already_ai' };
      }
      return {
        ...state,
        clock,
        responderMode: 'ai',
        returnedToAiAt: clock,
        lastResult: 'applied',
      };
  }
}

/** Projeção substantiva do estado (ignora clock/lastResult), p/ asserções de idempotência. */
export function projectState(s: TicketModel): {
  responderMode: ResponderMode;
  status: TicketStatus;
  messages: AuthorKind[];
  handoffAt: number | null;
  returnedToAiAt: number | null;
} {
  return {
    responderMode: s.responderMode,
    status: s.status,
    messages: s.messages.map((m) => m.authorKind),
    handoffAt: s.handoffAt,
    returnedToAiAt: s.returnedToAiAt,
  };
}
