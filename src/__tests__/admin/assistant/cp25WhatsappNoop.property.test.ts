// Feature: admin-assistant, Property 25: WhatsApp_Dispatcher é no-op
/**
 * CP-25 — WhatsApp_Dispatcher (seam) é NO-OP enquanto o canal real não existe
 * (obrigatório).
 *
 * Spec:
 *   - design.md §Correctness Properties — Property 25
 *   - requirements.md §Padrões de Sucesso (CP-25) e Requirements 13.3, 13.4
 *
 * Função sob teste:
 *   whatsappDispatch(event, { whatsappToggle })  (src/services/admin/assistant.ts)
 *
 * Invariantes verificadas para QUALQUER `DetectedEvent` arbitrário e para
 * AMBOS os estados do toggle (Req 13.3 / 13.4):
 *
 *   1. `whatsappToggle === false` ⇒ `{ sent: false, reason: 'toggle_off' }`.
 *      Nenhum envio ocorre quando o toggle está desligado (Req 13.3).
 *   2. `whatsappToggle === true`  ⇒ `{ sent: false, reason: 'not_implemented' }`.
 *      Nesta entrega, o canal real (Evolution API — Req 13.6) ainda não existe;
 *      o seam está pronto mas NUNCA envia (Req 13.4).
 *   3. `sent` é SEMPRE `false` (qualquer combinação de input).
 *   4. Pureza: o `event` não é mutado. Evento clonado antes da chamada deve
 *      permanecer igual depois da chamada.
 *   5. Função total: não lança para nenhum input válido do domínio fechado.
 *
 * Convenções de PBT do projeto:
 *   - Domínio fechado de tipos via `fc.constantFrom(...)` para
 *     `CriticalEventType` e `Severity`. Sem `fc.stringOf`.
 *
 * Lógica determinística (sem Supabase, sem rede). Ambiente jsdom.
 *
 * Validates: Requirements 13.3, 13.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  whatsappDispatch,
  type CriticalEventType,
  type DetectedEvent,
  type Severity,
} from '../../../services/admin/assistant';

// ----- Geradores (domínios fechados) -----

const eventTypeArb = fc.constantFrom<CriticalEventType>(
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop'
);

const severityArb = fc.constantFrom<Severity>('info', 'warning', 'critical');

const detectedEventArb: fc.Arbitrary<DetectedEvent> = fc.record({
  type: eventTypeArb,
  severity: severityArb,
  summary: fc.string({ minLength: 0, maxLength: 60 }),
  scope: fc.string({ minLength: 0, maxLength: 30 }),
});

describe('CP-25: whatsappDispatch — no-op em ambos os estados do toggle (Req 13.3, 13.4)', () => {
  it('toggle off ⇒ { sent: false, reason: "toggle_off" }', () => {
    fc.assert(
      fc.property(detectedEventArb, (event) => {
        const result = whatsappDispatch(event, { whatsappToggle: false });
        expect(result).toEqual({ sent: false, reason: 'toggle_off' });
      }),
      { numRuns: 100 }
    );
  });

  it('toggle on ⇒ { sent: false, reason: "not_implemented" } (canal real ainda não existe)', () => {
    fc.assert(
      fc.property(detectedEventArb, (event) => {
        const result = whatsappDispatch(event, { whatsappToggle: true });
        expect(result).toEqual({ sent: false, reason: 'not_implemented' });
      }),
      { numRuns: 100 }
    );
  });

  it('sent é sempre false, qualquer combinação de input', () => {
    fc.assert(
      fc.property(detectedEventArb, fc.boolean(), (event, toggle) => {
        const result = whatsappDispatch(event, { whatsappToggle: toggle });
        expect(result.sent).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('pureza: o event de entrada não é mutado', () => {
    fc.assert(
      fc.property(detectedEventArb, fc.boolean(), (event, toggle) => {
        const snapshot: DetectedEvent = { ...event };
        whatsappDispatch(event, { whatsappToggle: toggle });
        expect(event).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});
