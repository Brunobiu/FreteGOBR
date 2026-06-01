// Feature: admin-assistant, Property 25
/**
 * CP-25: WhatsApp_Dispatcher e no-op enquanto o toggle esta desligado
 *
 * Para todo DetectedEvent, whatsappDispatch(event, { whatsappToggle: false })
 * retorna o resultado no-op { sent: false, reason: 'toggle_off' } e nao
 * realiza nenhum envio nem efeito colateral (o evento de entrada nao e
 * mutado).
 *
 * Logica pura (sem Supabase / sem canal real), entao nao ha mocks.
 *
 * Validates: Requirements 13.3, 13.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  whatsappDispatch,
  type DetectedEvent,
  type CriticalEventType,
  type Severity,
} from '../../../services/admin/assistant';

// ----- Geradores -----

const eventTypeGen = fc.constantFrom<CriticalEventType>(
  'page_error_rate',
  'request_failure_rate',
  'unauthorized_access_attempt',
  'failed_login_burst',
  'payment_failure',
  'db_performance_drop'
);

const severityGen = fc.constantFrom<Severity>('info', 'warning', 'critical');

const detectedEventGen: fc.Arbitrary<DetectedEvent> = fc.record({
  type: eventTypeGen,
  severity: severityGen,
  summary: fc.string({ minLength: 0, maxLength: 30 }),
  scope: fc.string({ minLength: 0, maxLength: 20 }),
});

describe('CP-25: WhatsApp_Dispatcher no-op com toggle desligado', () => {
  it('retorna { sent: false, reason: toggle_off } sem realizar envio', () => {
    fc.assert(
      fc.property(detectedEventGen, (event) => {
        const snapshot = { ...event };

        const result = whatsappDispatch(event, { whatsappToggle: false });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('toggle_off');

        // No-op: o evento de entrada nao e tocado.
        expect(event).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});
