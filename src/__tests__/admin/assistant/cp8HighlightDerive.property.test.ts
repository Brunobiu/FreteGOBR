// Feature: admin-assistant, Property 8
/**
 * CP-8: Derivacao de Highlight a partir de Critical_Event
 *
 * Para todo CriticalEvent, o Highlight derivado por summarizeHighlight
 * contem `category`, `summary`, `severity` e `timestamp` NAO vazios; quando
 * a conversa referenciada e nula/vazia, a view resultante NAO possui link de
 * navegacao (`conversationId === null`). A funcao e total: nunca lanca.
 *
 * Logica pura (sem Supabase), entao nao ha mocks.
 *
 * Validates: Requirements 4.4, 6.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  summarizeHighlight,
  type CriticalEvent,
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

const isoTimestampGen = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

// Campos textuais que podem vir vazios/em-branco para exercitar os fallbacks
// deterministicos do derivador (categoria/resumo/timestamp nunca vazios).
const maybeBlankGen = fc.oneof(
  fc.string({ minLength: 0, maxLength: 30 }),
  fc.constantFrom('', '   ', '\t')
);

// conversationId as vezes null/vazio (conversa ausente => sem link).
const conversationIdGen = fc.oneof(fc.uuid(), fc.constantFrom<string | null>('', '   ', null));

const criticalEventGen: fc.Arbitrary<CriticalEvent> = fc.record({
  id: fc.oneof(fc.uuid(), fc.constant('')),
  eventType: eventTypeGen,
  severity: severityGen,
  summary: maybeBlankGen,
  scope: maybeBlankGen,
  dedupKey: fc.string({ minLength: 0, maxLength: 20 }),
  conversationId: conversationIdGen,
  detectedAt: fc.oneof(isoTimestampGen, fc.constant('')),
  notifiedAt: fc.oneof(isoTimestampGen, fc.constant(''), fc.constant<null>(null)),
});

const VALID_SEVERITIES: ReadonlySet<string> = new Set<string>(['info', 'warning', 'critical']);

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

describe('CP-8: Derivacao de Highlight a partir de Critical_Event', () => {
  it('produz category/summary/severity/timestamp nao vazios e nunca lanca', () => {
    fc.assert(
      fc.property(criticalEventGen, (ev) => {
        const highlight = summarizeHighlight(ev);

        // Campos nao vazios (com fallback deterministico).
        expect(highlight.category.trim().length).toBeGreaterThan(0);
        expect(highlight.summary.trim().length).toBeGreaterThan(0);
        expect(highlight.timestamp.trim().length).toBeGreaterThan(0);
        expect(VALID_SEVERITIES.has(highlight.severity)).toBe(true);
        expect(highlight.severity.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('conversa ausente/vazia => sem link de navegacao (conversationId null)', () => {
    fc.assert(
      fc.property(criticalEventGen, (ev) => {
        const highlight = summarizeHighlight(ev);
        if (isBlank(ev.conversationId)) {
          expect(highlight.conversationId).toBeNull();
        } else {
          // Conversa presente => link preservado (string nao vazia).
          expect(highlight.conversationId).toBe(ev.conversationId);
        }
      }),
      { numRuns: 100 }
    );
  });
});
