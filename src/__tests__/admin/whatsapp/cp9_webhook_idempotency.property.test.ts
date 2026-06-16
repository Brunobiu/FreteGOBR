/**
 * Property-Based Test — WhatsApp Automation, Property 9:
 * Idempotência do auto-reply por evento de webhook.
 *
 * Feature: whatsapp-automation, Property 9: Idempotência do auto-reply por evento de webhook
 * Validates: Requirements 16.6, 31.12
 *
 * Invariante verificada (≥100 runs) sobre o modelo de servidor em memória
 * (`_model/store.ts`), que espelha a Edge Function `whatsapp-webhook`:
 *
 *   Para QUALQUER evento inbound identificado por `providerEventId` e QUALQUER
 *   número de reentregas (redeliveries) do MESMO evento — possivelmente
 *   intercaladas com eventos distintos — o modelo gera NO MÁXIMO um auto-reply
 *   para aquele evento (Req 16.6, 31.12), e somente quando o modo é AI-allowed.
 *
 * Como é exercitado:
 *   - A instância é criada com IA habilitada + `hasApiKey` ⇒ conversas novas
 *     nascem em `AI_MODE` (AI-allowed), então a 1ª entrega de cada evento envia
 *     exatamente um auto-reply (`SENT`).
 *   - Um schedule arbitrário reprocessa eventos (mesmos `providerEventId`) e
 *     intercala eventos distintos. Para cada entrega:
 *       • 1ª vez do evento  ⇒ `{ duplicate: false }`, `replied === true`;
 *       • reentregas         ⇒ `{ duplicate: true }`, `replied === false` (sem
 *         novo reply).
 *   - Em todo instante: `countAutoReplies(state, instanceId, providerEventId) <= 1`.
 *   - Ao final: o total de auto-replies enviados (`listOutboundMessages`) é
 *     exatamente o nº de eventos DISTINTOS processados — nunca multiplicado
 *     pelas reentregas.
 *
 * Convenções do projeto (project-conventions / testing-governance):
 *   - Telefones via `fc.constantFrom` de templates fixos; corpos via
 *     `fc.constantFrom`. Ids derivados de inteiros estáveis. NUNCA `fc.stringOf`.
 *   - Reducers do modelo são PUROS — sem mocks.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  createInstance,
  createInitialState,
  processWebhookEvent,
  countAutoReplies,
  listOutboundMessages,
  type ModelState,
} from './_model/store';

/** Telefones de contato (templates fixos válidos — nunca dígitos aleatórios). */
const PHONE_TEMPLATES = [
  '5562999998888',
  '5511987654321',
  '552133334444',
  '5548988887777',
] as const;

/** Corpos de mensagem inbound (fixos — sem `fc.stringOf`). */
const BODY_TEMPLATES = [
  'Olá, tudo bem?',
  'Quero saber sobre o frete.',
  'Bom dia!',
  'Preciso de ajuda.',
] as const;

/** Id de instância estável, derivado de um inteiro. */
const instanceIdArb = fc.integer({ min: 0, max: 50 }).map((n) => `wa-inst-${n}`);

/** Um evento distinto: telefone + corpo. O `providerEventId` é o índice estável. */
const eventArb = fc.record({
  phone: fc.constantFrom(...PHONE_TEMPLATES),
  body: fc.constantFrom(...BODY_TEMPLATES),
});

interface ResolvedEvent {
  providerEventId: string;
  phone: string;
  body: string;
}

/**
 * Cenário: uma instância, uma lista de eventos DISTINTOS e um schedule de
 * entregas (índices nos eventos) que repete e intercala — modelando reentregas.
 */
const scenarioArb = fc
  .record({
    instanceId: instanceIdArb,
    events: fc.array(eventArb, { minLength: 1, maxLength: 6 }),
  })
  .chain(({ instanceId, events }) =>
    fc.record({
      instanceId: fc.constant(instanceId),
      events: fc.constant(
        events.map(
          (e, i): ResolvedEvent => ({ providerEventId: `evt-${i}`, phone: e.phone, body: e.body })
        )
      ),
      // Schedule de entregas: cada item é um índice em `events` (reentregas e
      // intercalações surgem naturalmente da repetição de índices).
      deliveries: fc.array(fc.nat({ max: events.length - 1 }), {
        minLength: 1,
        maxLength: 40,
      }),
    })
  );

describe('WhatsApp Automation — Property 9: idempotência do auto-reply por evento de webhook', () => {
  it('reentregas do mesmo evento geram no máximo um auto-reply (Req 16.6, 31.12)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ instanceId, events, deliveries }) => {
        // Instância com IA habilitada + chave ⇒ conversa nova em AI_MODE (AI-allowed).
        let state: ModelState = createInstance(createInitialState(), {
          instanceId,
          enabled: true,
          aiConfig: { enabled: true, hasApiKey: true },
        });

        const seen = new Set<string>();

        deliveries.forEach((idx, step) => {
          const ev = events[idx];
          const result = processWebhookEvent(state, {
            instanceId,
            providerEventId: ev.providerEventId,
            contactPhone: ev.phone,
            body: ev.body,
            now: step, // relógio virtual determinístico
          });
          state = result.state;

          if (seen.has(ev.providerEventId)) {
            // Reentrega: no-op idempotente — duplicate, sem novo reply.
            expect(result.duplicate).toBe(true);
            expect(result.replied).toBe(false);
            expect(result.replyStatus).toBeNull();
          } else {
            // 1ª vez: modo AI-allowed ⇒ exatamente um auto-reply enviado.
            expect(result.duplicate).toBe(false);
            expect(result.replied).toBe(true);
            expect(result.replyStatus).toBe('SENT');
            seen.add(ev.providerEventId);
          }

          // Invariante central (P9): nunca mais de um auto-reply por evento.
          expect(countAutoReplies(state, instanceId, ev.providerEventId)).toBeLessThanOrEqual(1);
        });

        // Para cada evento DISTINTO processado: exatamente um auto-reply.
        for (const pid of seen) {
          expect(countAutoReplies(state, instanceId, pid)).toBe(1);
        }

        // O total de auto-replies enviados == nº de eventos distintos processados,
        // independentemente de quantas reentregas ocorreram.
        expect(listOutboundMessages(state, instanceId).length).toBe(seen.size);
      }),
      { numRuns: 100 }
    );
  });

  it('uma única entrega seguida de N reentregas idênticas ⇒ apenas 1 reply (Req 16.6)', () => {
    fc.assert(
      fc.property(
        instanceIdArb,
        fc.constantFrom(...PHONE_TEMPLATES),
        fc.constantFrom(...BODY_TEMPLATES),
        fc.integer({ min: 0, max: 20 }), // nº de reentregas extras
        (instanceId, phone, body, redeliveries) => {
          let state: ModelState = createInstance(createInitialState(), {
            instanceId,
            enabled: true,
            aiConfig: { enabled: true, hasApiKey: true },
          });

          const providerEventId = 'evt-single';

          // 1ª entrega: envia o auto-reply.
          const first = processWebhookEvent(state, {
            instanceId,
            providerEventId,
            contactPhone: phone,
            body,
            now: 0,
          });
          state = first.state;
          expect(first.duplicate).toBe(false);
          expect(first.replied).toBe(true);

          // N reentregas idênticas: todas no-op idempotente.
          for (let i = 0; i < redeliveries; i++) {
            const again = processWebhookEvent(state, {
              instanceId,
              providerEventId,
              contactPhone: phone,
              body,
              now: i + 1,
            });
            state = again.state;
            expect(again.duplicate).toBe(true);
            expect(again.replied).toBe(false);
          }

          // Exatamente um auto-reply, qualquer que seja o nº de reentregas.
          expect(countAutoReplies(state, instanceId, providerEventId)).toBe(1);
          expect(listOutboundMessages(state, instanceId).length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
