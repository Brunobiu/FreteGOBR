/**
 * Property-Based Tests — Mapeamento puro do webhook do Asaas
 * (`src/utils/asaasWebhook.ts`).
 *
 * Feature: assinaturas-pagamento, Property 4 (parte pura): determinismo do
 * mapeamento evento -> ação e da extração da chave de idempotência.
 * Validates: Requirements 12.4, 12.5 (mapeamento de eventos) e 12.3
 * (idempotência — a parte de banco é coberta por teste de integração).
 *
 * A idempotência REAL (não reprocessar o mesmo asaas_event_id) é validada por
 * teste de integração em `tests/` contra a tabela asaas_webhook_events.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  mapAsaasEventToAction,
  parseAsaasWebhook,
  type AsaasWebhookBody,
  type WebhookAction,
} from '../utils/asaasWebhook';

const PAID = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'];
const PAST_DUE = [
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_DUNNING_REQUESTED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
];
const IGNORED = ['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'SUBSCRIPTION_CREATED', 'FOO_BAR', ''];

// ============================================================================
// Property 4 (pura): mapeamento determinístico evento -> ação
// Validates: Requirements 12.4, 12.5
// ============================================================================
describe('Property 4 (pura): mapAsaasEventToAction — mapeamento determinístico', () => {
  it('eventos de pagamento confirmado mapeiam para mark_paid', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PAID), (e) => {
        expect(mapAsaasEventToAction(e)).toBe<WebhookAction>('mark_paid');
      })
    );
  });

  it('eventos de vencido/estorno/recusa mapeiam para mark_past_due', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PAST_DUE), (e) => {
        expect(mapAsaasEventToAction(e)).toBe<WebhookAction>('mark_past_due');
      })
    );
  });

  it('eventos desconhecidos/sem efeito mapeiam para ignore', () => {
    fc.assert(
      fc.property(fc.constantFrom(...IGNORED), (e) => {
        expect(mapAsaasEventToAction(e)).toBe<WebhookAction>('ignore');
      })
    );
  });

  it('é case-insensitive e tolera espaços (determinístico)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PAID), (e) => {
        const vari1 = mapAsaasEventToAction(`  ${e.toLowerCase()}  `);
        const vari2 = mapAsaasEventToAction(e);
        expect(vari1).toBe(vari2);
        expect(vari1).toBe<WebhookAction>('mark_paid');
      })
    );
  });

  it('null/undefined mapeiam para ignore (total)', () => {
    expect(mapAsaasEventToAction(null)).toBe('ignore');
    expect(mapAsaasEventToAction(undefined)).toBe('ignore');
  });
});

// ============================================================================
// Property 4 (pura): extração da chave de idempotência
// Validates: Requirements 12.3
// ============================================================================
describe('parseAsaasWebhook — extração e chave de idempotência', () => {
  it('usa body.id como eventId quando presente', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('evt_1', 'evt_abc', 'evt_xyz'),
        fc.constantFrom(...PAID, ...PAST_DUE),
        (id, event) => {
          const body: AsaasWebhookBody = { id, event, payment: { id: 'pay_1' } };
          expect(parseAsaasWebhook(body).eventId).toBe(id);
        }
      )
    );
  });

  it('cai para event:paymentId quando body.id ausente', () => {
    const body: AsaasWebhookBody = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_99' } };
    expect(parseAsaasWebhook(body).eventId).toBe('PAYMENT_CONFIRMED:pay_99');
  });

  it('eventId é null quando não há id de evento nem de pagamento', () => {
    expect(parseAsaasWebhook({ event: 'PAYMENT_CONFIRMED' }).eventId).toBeNull();
  });

  it('extrai externalReference (user_id), customer e subscription', () => {
    const body: AsaasWebhookBody = {
      id: 'evt_1',
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_1',
        customer: 'cus_1',
        subscription: 'sub_1',
        externalReference: 'user-uuid-1',
      },
    };
    const parsed = parseAsaasWebhook(body);
    expect(parsed.asaasPaymentId).toBe('pay_1');
    expect(parsed.asaasCustomerId).toBe('cus_1');
    expect(parsed.asaasSubscriptionId).toBe('sub_1');
    expect(parsed.externalReference).toBe('user-uuid-1');
    expect(parsed.action).toBe('mark_paid');
  });

  it('é total: corpo vazio/null não lança e retorna ignore', () => {
    expect(parseAsaasWebhook(null).action).toBe('ignore');
    expect(parseAsaasWebhook({}).action).toBe('ignore');
    expect(parseAsaasWebhook(undefined).eventId).toBeNull();
  });

  it('mesmo corpo => mesma extração (determinismo)', () => {
    const body: AsaasWebhookBody = { id: 'evt_1', event: 'PAYMENT_OVERDUE', payment: { id: 'p1' } };
    expect(parseAsaasWebhook(body)).toEqual(parseAsaasWebhook({ ...body, payment: { id: 'p1' } }));
  });
});
