// Feature: whatsapp-automation, Property 1: Total instance isolation (instance A operations never read/return/mutate instance B)
/**
 * Property-Based Tests — Isolamento total entre instâncias (Req 2)
 *
 * Property 1: para qualquer coleção de entidades distribuída entre instâncias
 * arbitrárias (≥ 2) e para todo par de instâncias distintas A e B, qualquer
 * operação de leitura/escrita escopada a `instance_id = A` depende EXCLUSIVAMENTE
 * de linhas com `instance_id = A` e NUNCA lê, retorna ou altera qualquer entidade
 * de B. O modelo em memória (`_model/store.ts`) particiona todo o estado por
 * `instanceId`, espelhando as RPCs `SECURITY DEFINER` parametrizadas por
 * `p_instance_id` e o Job_Worker durável.
 *
 * Estratégia:
 *   1. Constrói um cenário aleatório: N (≥2) instâncias, cada uma com
 *      sessão/config de IA, jobs+recipients, conversas e eventos de webhook.
 *   2. Escolhe um par (A, B) distinto e tira um snapshot profundo da partição de
 *      B (deep clone).
 *   3. Aplica uma sequência arbitrária de operações (ticks, webhooks, transições
 *      de modo, conexão/desconexão) escopadas SOMENTE a A.
 *   4. Assere que a partição de B é byte-a-byte idêntica ao snapshot e que toda
 *      leitura escopada a A jamais inclui ids de B.
 *
 * Validates: Requirements 2.6, 2.7, 26.5, 30.6, 31.18, 29.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createInitialState,
  createInstance,
  setAiConfig,
  connectSession,
  disconnectSession,
  addDispatchJob,
  tickWorker,
  processWebhookEvent,
  upsertConversation,
  getConversation,
  applyConversationTransition,
  getInstance,
  getJob,
  listRecipients,
  type ModelState,
  type InstanceState,
  type SessionStatus,
  type ConversationMode,
} from './_model/store';
import type { DistributionMode } from '../../../services/admin/whatsapp/distribution';

// ─── Geradores canônicos (telefones via constantFrom; nunca fc.stringOf) ─────

/** Telefones E.164 fixos (templates válidos) — convenção do projeto. */
const phoneArb = fc.constantFrom(
  '+5562999998888',
  '+5511987654321',
  '+5521991234567',
  '+5548988887777'
);

/** Pool fixo de ids de instância; o cenário usa um subconjunto distinto (≥2). */
const INSTANCE_POOL = ['inst-a', 'inst-b', 'inst-c', 'inst-d'] as const;
const instanceIdsArb = fc.uniqueArray(fc.constantFrom(...INSTANCE_POOL), {
  minLength: 2,
  maxLength: INSTANCE_POOL.length,
});

const modeArb = fc.constantFrom<DistributionMode>('BLOCK', 'INTERLEAVED');
const sessionStatusArb = fc.constantFrom<SessionStatus>(
  'DISCONNECTED',
  'CONNECTING',
  'QR_PENDING',
  'CONNECTED'
);
const conversationModeArb = fc.constantFrom<ConversationMode>(
  'AI_MODE',
  'HUMAN_MODE',
  'AI_PAUSED',
  'RETURNED_TO_AI'
);

/** Especificação de um Dispatch_Job a ser semeado numa instância. */
const jobSpecArb = fc.record({
  recipientCount: fc.integer({ min: 1, max: 6 }),
  contentCount: fc.integer({ min: 1, max: 3 }),
  mode: modeArb,
  blockSize: fc.integer({ min: 1, max: 4 }),
  sendIntervalSec: fc.integer({ min: 1, max: 10 }),
  executionQuota: fc.integer({ min: 1, max: 8 }),
  phones: fc.array(phoneArb, { minLength: 1, maxLength: 6 }),
});

/** Configuração inicial completa de uma instância. */
const instanceConfigArb = fc.record({
  aiEnabled: fc.boolean(),
  hasApiKey: fc.boolean(),
  sessionStatus: sessionStatusArb,
  jobs: fc.array(jobSpecArb, { maxLength: 3 }),
  conversationPhones: fc.uniqueArray(phoneArb, { maxLength: 4 }),
});
type InstanceConfig = {
  aiEnabled: boolean;
  hasApiKey: boolean;
  sessionStatus: SessionStatus;
  jobs: Array<{
    recipientCount: number;
    contentCount: number;
    mode: DistributionMode;
    blockSize: number;
    sendIntervalSec: number;
    executionQuota: number;
    phones: string[];
  }>;
  conversationPhones: string[];
};

/** Uma operação escopada a UMA instância (sempre aplicada à instância A). */
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('tickAll' as const) }),
  fc.record({
    kind: fc.constant('webhook' as const),
    phone: phoneArb,
    eventId: fc.integer({ min: 0, max: 50 }),
    aiError: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant('transition' as const),
    phone: phoneArb,
    mode: conversationModeArb,
  }),
  fc.record({ kind: fc.constant('connect' as const), status: sessionStatusArb }),
  fc.record({ kind: fc.constant('disconnect' as const) })
);
type Op = {
  kind: 'tickAll' | 'webhook' | 'transition' | 'connect' | 'disconnect';
  phone?: string;
  eventId?: number;
  aiError?: boolean;
  status?: SessionStatus;
  mode?: ConversationMode;
};
const opsArb = fc.array(opArb, { minLength: 1, maxLength: 10 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deep clone determinístico (o estado é JSON-serializável por construção). */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Semeia uma instância completa (sessão, IA, jobs+recipients, conversas). */
function seedInstance(
  state: ModelState,
  instanceId: string,
  displayOrder: number,
  config: InstanceConfig
): ModelState {
  let working = createInstance(state, { instanceId, displayOrder });
  working = setAiConfig(working, instanceId, {
    enabled: config.aiEnabled,
    hasApiKey: config.hasApiKey,
  });
  working = connectSession(working, instanceId, config.sessionStatus, 0);

  config.jobs.forEach((job, jobIdx) => {
    // jobId namespaced por instância ⇒ todos os ids derivados são globalmente
    // únicos, permitindo afirmar que ids de B nunca surgem em leituras de A.
    const jobId = `${instanceId}:job${jobIdx}`;
    const recipients = Array.from({ length: job.recipientCount }, (_unused, i) => ({
      phone: job.phones[i % job.phones.length],
    }));
    const contentIds = Array.from({ length: job.contentCount }, (_unused, i) => `${jobId}:c${i}`);
    working = addDispatchJob(working, instanceId, {
      jobId,
      recipients,
      contentIds,
      mode: job.mode,
      blockSize: job.blockSize,
      sendIntervalSec: job.sendIntervalSec,
      executionQuota: job.executionQuota,
    });
  });

  config.conversationPhones.forEach((phone) => {
    working = upsertConversation(working, instanceId, phone, 0);
  });

  return working;
}

/** Aplica uma operação escopada SOMENTE à instância `target`. */
function applyOp(state: ModelState, target: string, op: Op): ModelState {
  switch (op.kind) {
    case 'tickAll': {
      const inst = getInstance(state, target);
      if (!inst) {
        return state;
      }
      let working = state;
      for (const jobId of Object.keys(inst.jobs)) {
        working = tickWorker(working, target, jobId, { shouldFail: () => false }).state;
      }
      return working;
    }
    case 'webhook': {
      return processWebhookEvent(state, {
        instanceId: target,
        providerEventId: `${target}:evt:${op.eventId}`,
        contactPhone: op.phone as string,
        body: 'mensagem de teste',
        now: 1,
        aiProviderError: op.aiError,
      }).state;
    }
    case 'transition': {
      const working = upsertConversation(state, target, op.phone as string, 1);
      const conv = getConversation(working, target, op.phone as string);
      if (!conv) {
        return working;
      }
      return applyConversationTransition(working, target, conv.id, op.mode as ConversationMode, 2);
    }
    case 'connect': {
      return connectSession(state, target, op.status as SessionStatus, 3);
    }
    case 'disconnect': {
      return disconnectSession(state, target);
    }
    default:
      return state;
  }
}

/** Coleta todos os ids/identificadores presentes na partição de uma instância. */
function collectIds(inst: InstanceState): Set<string> {
  const ids = new Set<string>();
  Object.values(inst.jobs).forEach((j) => ids.add(j.id));
  Object.values(inst.recipients).forEach((r) => ids.add(r.id));
  Object.values(inst.conversations).forEach((c) => ids.add(c.id));
  Object.values(inst.messages).forEach((m) => ids.add(m.id));
  Object.values(inst.aiReplies).forEach((a) => ids.add(a.providerEventId));
  return ids;
}

/** Assere que toda entidade da partição carrega o `instanceId` esperado. */
function expectAllScopedTo(inst: InstanceState, instanceId: string): void {
  expect(inst.instanceId).toBe(instanceId);
  Object.values(inst.jobs).forEach((j) => expect(j.instanceId).toBe(instanceId));
  Object.values(inst.recipients).forEach((r) => expect(r.instanceId).toBe(instanceId));
  Object.values(inst.conversations).forEach((c) => expect(c.instanceId).toBe(instanceId));
  Object.values(inst.messages).forEach((m) => expect(m.instanceId).toBe(instanceId));
  Object.values(inst.aiReplies).forEach((a) => expect(a.instanceId).toBe(instanceId));
}

// ─── Property ────────────────────────────────────────────────────────────────

describe('cp1 — Property 1 (isolamento total entre instâncias)', () => {
  it('operar a instância A nunca lê, retorna ou altera entidades da instância B', () => {
    fc.assert(
      fc.property(
        instanceIdsArb,
        fc.array(instanceConfigArb, { minLength: 2, maxLength: INSTANCE_POOL.length }),
        opsArb,
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (instanceIds, configs, ops, aPick, bPick) => {
          // Constrói o estado com todas as instâncias do cenário.
          let state = createInitialState();
          instanceIds.forEach((id, idx) => {
            state = seedInstance(state, id, idx, configs[idx % configs.length] as InstanceConfig);
          });

          // Par (A, B) distinto.
          const a = instanceIds[aPick % instanceIds.length];
          let bIndex = bPick % instanceIds.length;
          if (instanceIds[bIndex] === a) {
            bIndex = (bIndex + 1) % instanceIds.length;
          }
          const b = instanceIds[bIndex];

          // Snapshot profundo da partição de B ANTES de operar em A.
          const beforeB = snapshot(getInstance(state, b) as InstanceState);
          const bIds = collectIds(beforeB);

          // Aplica todas as operações escopadas SOMENTE a A.
          for (const op of ops) {
            state = applyOp(state, a, op as Op);
          }

          // (1) A partição de B é byte-a-byte idêntica (nenhuma mutação cruzada).
          const afterB = getInstance(state, b) as InstanceState;
          expect(afterB).toEqual(beforeB);

          // (2) Toda entidade lida da partição de A pertence exclusivamente a A.
          const afterA = getInstance(state, a) as InstanceState;
          expectAllScopedTo(afterA, a);

          // (3) Nenhum id de B aparece na partição/leituras escopadas a A.
          const aIds = collectIds(afterA);
          for (const id of aIds) {
            expect(bIds.has(id)).toBe(false);
          }

          // (4) Leituras de A parametrizadas por ids de B não retornam nada.
          for (const jobId of Object.keys(beforeB.jobs)) {
            expect(getJob(state, a, jobId)).toBeUndefined();
            expect(listRecipients(state, a, jobId)).toEqual([]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
