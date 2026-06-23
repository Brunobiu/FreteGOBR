// Feature: admin-rastreamento-inteligente — Journey_Summary builder (unit).
//
// Casos concretos e bordas (sem eventos, falhas múltiplas, conversão parcial)
// + determinismo de reexecução. O "agora" é injetado (sem Date.now() interno).
//
// Validates: Requirements 5.1, 6.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { buildJourneySummary } from '../../../services/admin/rastreamento/journeySummary';
import { journeyEventsArb, NOW_MS } from './_generators';

const DAY = 24 * 60 * 60 * 1000;

describe('buildJourneySummary', () => {
  it('estado vazio: sem eventos retorna VISITOR e zeros, sem erro', () => {
    const s = buildJourneySummary([], NOW_MS);
    expect(s.current_stage).toBe('VISITOR');
    expect(s.days_since_last_access).toBe(0);
    expect(s.recent_failures).toBe(0);
    expect(s.frustrated_attempts).toBe(0);
    expect(s.freight_refusals).toBe(0);
    expect(s.no_conversion).toBe(true);
    expect(s.last_relevant_event).toBeNull();
    expect(s.signup_started).toBe(false);
    expect(s.signup_completed).toBe(false);
  });

  it('conta falhas recentes e tentativas frustradas dentro da janela de 7 dias', () => {
    const s = buildJourneySummary(
      [
        { event_type: 'LOGIN_FAILED', occurred_at: NOW_MS - 1 * DAY },
        { event_type: 'DOCUMENT_UPLOAD_FAILED', occurred_at: NOW_MS - 2 * DAY },
        { event_type: 'PAYMENT_FAILED', occurred_at: NOW_MS - 3 * DAY },
        // Fora da janela recente (10 dias) — não conta como falha recente.
        { event_type: 'LOGIN_FAILED', occurred_at: NOW_MS - 10 * DAY },
      ],
      NOW_MS
    );
    expect(s.recent_failures).toBe(3);
    expect(s.frustrated_attempts).toBe(2); // login + upload (payment não é frustrated)
  });

  it('detecta conversão (no_conversion=false) e recusas de frete', () => {
    const s = buildJourneySummary(
      [
        { event_type: 'PAYMENT_SUCCEEDED', occurred_at: NOW_MS - 5 * DAY },
        { event_type: 'FREIGHT_IGNORED', occurred_at: NOW_MS - 4 * DAY },
        { event_type: 'FREIGHT_IGNORED', occurred_at: NOW_MS - 3 * DAY },
      ],
      NOW_MS
    );
    expect(s.no_conversion).toBe(false);
    expect(s.freight_refusals).toBe(2);
  });

  it('cadastro iniciado e não concluído reflete signup_started=true, completed=false', () => {
    const s = buildJourneySummary(
      [{ event_type: 'SIGNUP_STARTED', occurred_at: NOW_MS - 2 * DAY }],
      NOW_MS
    );
    expect(s.signup_started).toBe(true);
    expect(s.signup_completed).toBe(false);
  });

  it('last_relevant_event é o evento problemático mais recente', () => {
    const s = buildJourneySummary(
      [
        { event_type: 'LOGIN_FAILED', occurred_at: NOW_MS - 5 * DAY },
        { event_type: 'PAYMENT_FAILED', occurred_at: NOW_MS - 1 * DAY },
        { event_type: 'SITE_VISIT', occurred_at: NOW_MS }, // não-relevante, mais recente
      ],
      NOW_MS
    );
    expect(s.last_relevant_event).toBe('PAYMENT_FAILED');
  });

  it('days_since_last_access usa o evento mais recente (qualquer tipo)', () => {
    const s = buildJourneySummary(
      [{ event_type: 'SITE_VISIT', occurred_at: NOW_MS - 9 * DAY }],
      NOW_MS
    );
    expect(s.days_since_last_access).toBe(9);
  });

  it('é determinístico e invariante à ordem de entrada', () => {
    fc.assert(
      fc.property(journeyEventsArb(), (events) => {
        const a = buildJourneySummary(events, NOW_MS);
        const b = buildJourneySummary([...events].reverse(), NOW_MS);
        expect(b).toEqual(a);
      }),
      { numRuns: 200 }
    );
  });
});
