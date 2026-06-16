/**
 * Testes unitários (exemplos + edge cases) — Edge Function `whatsapp-webhook`
 * (auto-resposta idempotente com guarda de modo), exercitados sobre o MODELO
 * EM MEMÓRIA dos reducers (`_model/store.ts`), que espelha a lógica das RPCs
 * `whatsapp_ingest_inbound_message` (migration 098) e
 * `whatsapp_claim_ai_reply` / `whatsapp_finalize_ai_reply` (migration 102).
 *
 * Edge Functions Deno NÃO rodam no vitest do projeto; a forma canônica de testar
 * essa lógica é via o modelo em memória (mesma abordagem dos property tests
 * `cp9_webhook_idempotency` e `cp2_single_responder`).
 *
 * Estes testes são COMPLEMENTARES aos property tests P9/P2: cobrem, com exemplos
 * concretos e casos de borda, os quatro pontos exigidos pela tarefa 16.3:
 *   1. Idempotência por `provider_event_id` (replay → no-op, no máximo 1 reply).
 *   2. Guarda de modo (HUMAN_MODE / AI_PAUSED / IA desabilitada / sem chave →
 *      BLOCKED, sem reply).
 *   3. `AI_PROVIDER_ERROR` (erro do provedor → status `AI_PROVIDER_ERROR`, sem
 *      enviar resposta).
 *   4. Isolamento de config de IA por `instance_id` (a decisão de responder usa
 *      sempre a config da PRÓPRIA instância que recebeu a mensagem).
 *
 * Validates: Requirements 16.4, 16.6, 31.11, 26.4
 *
 * Convenções (project-conventions / testing-governance):
 *   - Telefones via `fc.constantFrom` de templates fixos; NUNCA `fc.stringOf`.
 *   - Reducers do modelo são PUROS — sem mocks, sem I/O.
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
  countAutoReplies,
  listOutboundMessages,
  type ModelState,
  type ConversationMode,
} from './_model/store';

/** Telefones E.164 fixos válidos (nunca dígitos aleatórios). */
const PHONE = '+5562999998888';
const PHONE_B = '+5511987654321';

/** Cria uma instância com IA habilitada + chave configurada (auto-reply possível). */
function instanceWithAi(
  instanceId: string,
  cfg: { enabled?: boolean; hasApiKey?: boolean } = {}
): ModelState {
  return createInstance(createInitialState(), {
    instanceId,
    enabled: true,
    aiConfig: { enabled: cfg.enabled ?? true, hasApiKey: cfg.hasApiKey ?? true },
  });
}

describe('whatsapp-webhook — idempotência por provider_event_id (Req 16.6)', () => {
  it('replay do mesmo provider_event_id é no-op: no máximo um auto-reply', () => {
    let state = instanceWithAi('inst-1');
    const providerEventId = 'evt-1';

    // 1ª entrega: conversa nova nasce em AI_MODE ⇒ envia o auto-reply.
    const first = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'Olá, tudo bem?',
      now: 0,
    });
    state = first.state;

    expect(first.duplicate).toBe(false);
    expect(first.replied).toBe(true);
    expect(first.replyStatus).toBe('SENT');

    // Replay (reentrega): no-op idempotente — sem novo reply.
    const replay = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'Olá, tudo bem?',
      now: 1,
    });
    state = replay.state;

    expect(replay.duplicate).toBe(true);
    expect(replay.replied).toBe(false);
    expect(replay.replyStatus).toBeNull();

    // Exatamente um auto-reply registrado e enviado.
    expect(countAutoReplies(state, 'inst-1', providerEventId)).toBe(1);
    expect(listOutboundMessages(state, 'inst-1').length).toBe(1);
  });

  it('múltiplos replays consecutivos nunca geram um segundo reply', () => {
    let state = instanceWithAi('inst-1');
    const providerEventId = 'evt-2';

    processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'Bom dia!',
      now: 0,
    });
    // Reatribui o estado a partir da 1ª entrega.
    state = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'Bom dia!',
      now: 0,
    }).state;

    for (let i = 0; i < 5; i++) {
      const r = processWebhookEvent(state, {
        instanceId: 'inst-1',
        providerEventId,
        contactPhone: PHONE,
        body: 'Bom dia!',
        now: i + 1,
      });
      state = r.state;
      expect(r.duplicate).toBe(true);
      expect(r.replied).toBe(false);
    }

    expect(countAutoReplies(state, 'inst-1', providerEventId)).toBe(1);
    expect(listOutboundMessages(state, 'inst-1').length).toBe(1);
  });

  it('idempotência também se aplica quando a 1ª decisão foi BLOCKED (sem envio)', () => {
    // IA desabilitada ⇒ 1ª decisão BLOCKED; replay continua no-op.
    let state = instanceWithAi('inst-1', { enabled: false });
    const providerEventId = 'evt-blocked';

    const first = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'mensagem',
      now: 0,
    });
    state = first.state;
    expect(first.duplicate).toBe(false);
    expect(first.replyStatus).toBe('BLOCKED');

    const replay = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'mensagem',
      now: 1,
    });
    state = replay.state;
    expect(replay.duplicate).toBe(true);
    expect(replay.replied).toBe(false);

    // Nenhum envio ocorreu (BLOCKED), e o registro é único.
    expect(countAutoReplies(state, 'inst-1', providerEventId)).toBe(1);
    expect(listOutboundMessages(state, 'inst-1').length).toBe(0);
  });
});

describe('whatsapp-webhook — guarda de modo (Req 31.11)', () => {
  /** Helper: prepara uma conversa em `mode` e processa um evento inbound. */
  function processInMode(mode: ConversationMode, cfg: { enabled: boolean; hasApiKey: boolean }) {
    let state = instanceWithAi('inst-1', cfg);
    state = upsertConversation(state, 'inst-1', PHONE);
    const conv = getConversation(state, 'inst-1', PHONE);
    expect(conv).toBeDefined();
    state = applyConversationTransition(state, 'inst-1', conv!.id, mode);

    return processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId: `evt-${mode}`,
      contactPhone: PHONE,
      body: 'mensagem inbound',
      now: 0,
    });
  }

  it('HUMAN_MODE → BLOCKED, sem reply (mesmo com IA habilitada e com chave)', () => {
    const r = processInMode('HUMAN_MODE', { enabled: true, hasApiKey: true });
    expect(r.replied).toBe(false);
    expect(r.replyStatus).toBe('BLOCKED');
  });

  it('AI_PAUSED → BLOCKED, sem reply (mesmo com IA habilitada e com chave)', () => {
    const r = processInMode('AI_PAUSED', { enabled: true, hasApiKey: true });
    expect(r.replied).toBe(false);
    expect(r.replyStatus).toBe('BLOCKED');
  });

  it('IA desabilitada em modo AI-allowed → BLOCKED, sem reply', () => {
    const r = processInMode('AI_MODE', { enabled: false, hasApiKey: true });
    expect(r.replied).toBe(false);
    expect(r.replyStatus).toBe('BLOCKED');
  });

  it('sem chave de API configurada em modo AI-allowed → BLOCKED, sem reply (Req 31.11)', () => {
    const r = processInMode('RETURNED_TO_AI', { enabled: true, hasApiKey: false });
    expect(r.replied).toBe(false);
    expect(r.replyStatus).toBe('BLOCKED');
  });

  it('AI_MODE com IA habilitada e com chave → SENT (caso de controle positivo)', () => {
    const r = processInMode('AI_MODE', { enabled: true, hasApiKey: true });
    expect(r.replied).toBe(true);
    expect(r.replyStatus).toBe('SENT');
  });

  it('RETURNED_TO_AI com IA habilitada e com chave → SENT (caso de controle positivo)', () => {
    const r = processInMode('RETURNED_TO_AI', { enabled: true, hasApiKey: true });
    expect(r.replied).toBe(true);
    expect(r.replyStatus).toBe('SENT');
  });
});

describe('whatsapp-webhook — AI_PROVIDER_ERROR (Req 16.4)', () => {
  it('erro do provedor de IA → status AI_PROVIDER_ERROR e nenhuma resposta enviada', () => {
    let state = instanceWithAi('inst-1');
    const providerEventId = 'evt-provider-error';

    const r = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'Quero saber sobre o frete.',
      now: 0,
      aiProviderError: true,
    });
    state = r.state;

    // Erro do provedor: decisão tomada, mas SEM envio (Req 16.4).
    expect(r.replied).toBe(false);
    expect(r.replyStatus).toBe('AI_PROVIDER_ERROR');
    expect(listOutboundMessages(state, 'inst-1').length).toBe(0);

    // Mesmo com erro do provedor, o registro de idempotência foi gravado:
    // um replay subsequente é no-op (não tenta reenviar).
    expect(countAutoReplies(state, 'inst-1', providerEventId)).toBe(1);

    const replay = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId,
      contactPhone: PHONE,
      body: 'Quero saber sobre o frete.',
      now: 1,
      aiProviderError: true,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.replied).toBe(false);
    expect(listOutboundMessages(replay.state, 'inst-1').length).toBe(0);
  });

  it('o erro do provedor só é registrado quando o modo permite IA (caso contrário BLOCKED)', () => {
    // Em HUMAN_MODE a guarda de modo precede a chamada ao provedor:
    // a decisão é BLOCKED, nunca AI_PROVIDER_ERROR.
    let state = instanceWithAi('inst-1');
    state = upsertConversation(state, 'inst-1', PHONE);
    const conv = getConversation(state, 'inst-1', PHONE);
    state = applyConversationTransition(state, 'inst-1', conv!.id, 'HUMAN_MODE');

    const r = processWebhookEvent(state, {
      instanceId: 'inst-1',
      providerEventId: 'evt-human-provider-error',
      contactPhone: PHONE,
      body: 'mensagem',
      now: 0,
      aiProviderError: true,
    });

    expect(r.replyStatus).toBe('BLOCKED');
    expect(r.replied).toBe(false);
  });
});

describe('whatsapp-webhook — isolamento de config de IA por instance_id (Req 26.4)', () => {
  it('a decisão de responder usa a config da PRÓPRIA instância que recebeu a mensagem', () => {
    // inst-a: IA habilitada + chave; inst-b: IA desabilitada.
    let state = createInstance(createInitialState(), {
      instanceId: 'inst-a',
      enabled: true,
      aiConfig: { enabled: true, hasApiKey: true },
    });
    state = createInstance(state, {
      instanceId: 'inst-b',
      enabled: true,
      aiConfig: { enabled: false, hasApiKey: false },
    });

    // Mesmo provider_event_id e mesmo telefone, em instâncias distintas:
    // cada uma decide pela sua própria config.
    const ra = processWebhookEvent(state, {
      instanceId: 'inst-a',
      providerEventId: 'evt-shared',
      contactPhone: PHONE,
      body: 'mensagem',
      now: 0,
    });
    state = ra.state;

    const rb = processWebhookEvent(state, {
      instanceId: 'inst-b',
      providerEventId: 'evt-shared',
      contactPhone: PHONE,
      body: 'mensagem',
      now: 0,
    });
    state = rb.state;

    // inst-a responde (config própria habilitada); inst-b não (config própria desabilitada).
    expect(ra.replied).toBe(true);
    expect(ra.replyStatus).toBe('SENT');
    expect(rb.replied).toBe(false);
    expect(rb.replyStatus).toBe('BLOCKED');

    // Isolamento total: cada instância tem seu próprio registro e seus próprios envios.
    expect(countAutoReplies(state, 'inst-a', 'evt-shared')).toBe(1);
    expect(countAutoReplies(state, 'inst-b', 'evt-shared')).toBe(1);
    expect(listOutboundMessages(state, 'inst-a').length).toBe(1);
    expect(listOutboundMessages(state, 'inst-b').length).toBe(0);
  });

  it('alterar a config de uma instância não afeta a decisão da outra', () => {
    let state = createInstance(createInitialState(), {
      instanceId: 'inst-a',
      aiConfig: { enabled: true, hasApiKey: true },
    });
    state = createInstance(state, {
      instanceId: 'inst-b',
      aiConfig: { enabled: true, hasApiKey: true },
    });

    // Desabilita SOMENTE inst-b.
    state = setAiConfig(state, 'inst-b', { enabled: false });

    const ra = processWebhookEvent(state, {
      instanceId: 'inst-a',
      providerEventId: 'evt-a',
      contactPhone: PHONE,
      body: 'mensagem',
      now: 0,
    });
    const rb = processWebhookEvent(ra.state, {
      instanceId: 'inst-b',
      providerEventId: 'evt-b',
      contactPhone: PHONE_B,
      body: 'mensagem',
      now: 0,
    });

    expect(ra.replied).toBe(true);
    expect(rb.replied).toBe(false);
    expect(rb.replyStatus).toBe('BLOCKED');
  });

  it('property: cada instância decide independentemente pela sua própria aiConfig', () => {
    const cfgArb = fc.record({ enabled: fc.boolean(), hasApiKey: fc.boolean() });

    fc.assert(
      fc.property(cfgArb, cfgArb, (cfgA, cfgB) => {
        let state = createInstance(createInitialState(), {
          instanceId: 'inst-a',
          aiConfig: cfgA,
        });
        state = createInstance(state, { instanceId: 'inst-b', aiConfig: cfgB });

        const ra = processWebhookEvent(state, {
          instanceId: 'inst-a',
          providerEventId: 'evt-a',
          contactPhone: PHONE,
          body: 'mensagem',
          now: 0,
        });
        const rb = processWebhookEvent(ra.state, {
          instanceId: 'inst-b',
          providerEventId: 'evt-b',
          contactPhone: PHONE_B,
          body: 'mensagem',
          now: 0,
        });

        // Conversa nova nasce em AI_MODE (AI-allowed) ⇒ resposta depende só da config própria.
        expect(ra.replied).toBe(cfgA.enabled && cfgA.hasApiKey);
        expect(rb.replied).toBe(cfgB.enabled && cfgB.hasApiKey);
      }),
      { numRuns: 100 }
    );
  });
});
