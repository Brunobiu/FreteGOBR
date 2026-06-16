// Feature: whatsapp-automation, Property 2: Single responder — no AI auto-reply outside AI-allowed modes
/**
 * Property-Based Tests — Responsável único / guarda de Conversation_Mode (Req 16, 31)
 *
 * Property 2: ao processar um evento inbound de webhook, o modelo de servidor em
 * memória (src/__tests__/admin/whatsapp/_model/store.ts) só emite um auto-reply da
 * IA QUANDO, e SOMENTE QUANDO, as três condições valem simultaneamente:
 *   1. Conversation_Mode ∈ {AI_MODE, RETURNED_TO_AI} (AI-allowed — Req 31.2)
 *   2. aiConfig.enabled (IA habilitada na instância — Req 16.7, 31.5)
 *   3. aiConfig.hasApiKey (chave configurada — Req 31.10, 31.11)
 *
 * Em HUMAN_MODE ou AI_PAUSED nenhum auto-reply é enviado, mesmo com a IA habilitada
 * e com chave — o responsável passa a ser o humano (responsável único). Nesses casos
 * o registro de idempotência é `BLOCKED` (decisão tomada, porém sem envio).
 *
 * Validates: Requirements 16.7, 31.2, 31.5, 31.10, 31.11
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createInitialState,
  createInstance,
  setAiConfig,
  upsertConversation,
  applyConversationTransition,
  processWebhookEvent,
  getConversation,
  AI_ALLOWED_MODES,
  type ConversationMode,
} from './_model/store';

// ─── Geradores canônicos (sem fc.stringOf; PII via fc.constantFrom) ──────────

/** Instâncias fixas válidas. */
const instanceIdArb = fc.constantFrom('inst-a', 'inst-b', 'inst-c');

/** Telefones E.164 fixos válidos (nunca aleatórios). */
const phoneArb = fc.constantFrom(
  '+5511999990001',
  '+5511999990002',
  '+5521988887777',
  '+5531977776666',
  '+5541966665555'
);

/** Todos os Conversation_Mode possíveis (AI-allowed e não-AI-allowed). */
const modeArb = fc.constantFrom<ConversationMode>(
  'AI_MODE',
  'HUMAN_MODE',
  'AI_PAUSED',
  'RETURNED_TO_AI'
);

/** Identificador de evento estável e único por execução. */
const eventArb = fc.integer({ min: 0, max: 100000 }).map((n) => `evt-${n}`);

const enabledArb = fc.boolean();
const hasApiKeyArb = fc.boolean();

describe('processWebhookEvent — Property 2 (responsável único / guarda de modo)', () => {
  it('emite auto-reply SSE modo é AI-allowed E IA habilitada E com chave; senão BLOCKED', () => {
    fc.assert(
      fc.property(
        instanceIdArb,
        phoneArb,
        modeArb,
        enabledArb,
        hasApiKeyArb,
        eventArb,
        (instanceId, phone, mode, enabled, hasApiKey, providerEventId) => {
          // Cenário: instância com aiConfig variável + conversa no modo sorteado.
          let state = createInitialState();
          state = createInstance(state, { instanceId, aiConfig: { enabled, hasApiKey } });
          // Reforça a config via setAiConfig (exercita a API do modelo).
          state = setAiConfig(state, instanceId, { enabled, hasApiKey });
          state = upsertConversation(state, instanceId, phone);

          const conv = getConversation(state, instanceId, phone);
          expect(conv).toBeDefined();
          state = applyConversationTransition(state, instanceId, conv!.id, mode);

          const result = processWebhookEvent(state, {
            instanceId,
            providerEventId,
            contactPhone: phone,
            body: 'mensagem inbound',
          });

          const modeAllowed = AI_ALLOWED_MODES.includes(mode);
          const shouldReply = modeAllowed && enabled && hasApiKey;

          // IFF: auto-reply ocorre exatamente quando as três condições valem.
          expect(result.replied).toBe(shouldReply);

          if (shouldReply) {
            expect(result.replyStatus).toBe('SENT');
          } else {
            // Fora das condições: nunca envia e a decisão é BLOCKED.
            expect(result.replied).toBe(false);
            expect(result.replyStatus).toBe('BLOCKED');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('HUMAN_MODE/AI_PAUSED nunca respondem, mesmo com IA habilitada e com chave', () => {
    const nonAiModeArb = fc.constantFrom<ConversationMode>('HUMAN_MODE', 'AI_PAUSED');

    fc.assert(
      fc.property(
        instanceIdArb,
        phoneArb,
        nonAiModeArb,
        eventArb,
        (instanceId, phone, mode, providerEventId) => {
          // IA totalmente habilitada e com chave — só o modo deve bloquear.
          let state = createInitialState();
          state = createInstance(state, {
            instanceId,
            aiConfig: { enabled: true, hasApiKey: true },
          });
          state = upsertConversation(state, instanceId, phone);

          const conv = getConversation(state, instanceId, phone);
          expect(conv).toBeDefined();
          state = applyConversationTransition(state, instanceId, conv!.id, mode);

          const result = processWebhookEvent(state, {
            instanceId,
            providerEventId,
            contactPhone: phone,
            body: 'mensagem inbound em modo humano',
          });

          // Responsável único: o humano detém a conversa, IA não responde.
          expect(result.replied).toBe(false);
          expect(result.replyStatus).toBe('BLOCKED');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('modo AI-allowed só responde com IA habilitada E chave configurada', () => {
    const aiModeArb = fc.constantFrom<ConversationMode>(...AI_ALLOWED_MODES);

    fc.assert(
      fc.property(
        instanceIdArb,
        phoneArb,
        aiModeArb,
        enabledArb,
        hasApiKeyArb,
        eventArb,
        (instanceId, phone, mode, enabled, hasApiKey, providerEventId) => {
          let state = createInitialState();
          state = createInstance(state, { instanceId, aiConfig: { enabled, hasApiKey } });
          state = upsertConversation(state, instanceId, phone);

          const conv = getConversation(state, instanceId, phone);
          expect(conv).toBeDefined();
          state = applyConversationTransition(state, instanceId, conv!.id, mode);

          const result = processWebhookEvent(state, {
            instanceId,
            providerEventId,
            contactPhone: phone,
            body: 'mensagem inbound em modo IA',
          });

          // Em modo AI-allowed, a resposta depende apenas de enabled E hasApiKey.
          expect(result.replied).toBe(enabled && hasApiKey);
          expect(result.replyStatus).toBe(enabled && hasApiKey ? 'SENT' : 'BLOCKED');
        }
      ),
      { numRuns: 100 }
    );
  });
});
