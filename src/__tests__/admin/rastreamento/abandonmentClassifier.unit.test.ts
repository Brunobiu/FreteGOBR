// Feature: admin-rastreamento-inteligente — Abandonment_Cause_Classifier (unit).
//
// Casos concretos das acceptance criteria 5.4–5.7 e da precedência entre
// causas concorrentes (falha posterior vence cadastro abandonado; pagamento
// recusado vence inatividade).
//
// Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.9

import { describe, it, expect } from 'vitest';

import {
  classifyAbandonmentCause,
  FREIGHTS_IGNORED_THRESHOLD,
} from '../../../services/admin/rastreamento/abandonmentClassifier';
import { type JourneySummary } from '../../../services/admin/rastreamento/journeySummary';

const INACTIVITY_DAYS = 14;

function summary(partial: Partial<JourneySummary>): JourneySummary {
  return {
    current_stage: 'VISITOR',
    days_since_last_access: 0,
    recent_failures: 0,
    frustrated_attempts: 0,
    freight_refusals: 0,
    no_conversion: true,
    last_relevant_event: null,
    signup_started: false,
    signup_completed: false,
    ...partial,
  };
}

describe('classifyAbandonmentCause', () => {
  it('5.4 cadastro iniciado e não concluído sem outra falha ⇒ SIGNUP_ABANDONED', () => {
    expect(
      classifyAbandonmentCause(
        summary({ signup_started: true, signup_completed: false }),
        INACTIVITY_DAYS
      )
    ).toBe('SIGNUP_ABANDONED');
  });

  it('5.5 falha de upload como evento mais recente ⇒ UPLOAD_ERROR', () => {
    expect(
      classifyAbandonmentCause(
        summary({ last_relevant_event: 'DOCUMENT_UPLOAD_FAILED' }),
        INACTIVITY_DAYS
      )
    ).toBe('UPLOAD_ERROR');
  });

  it('5.6 pagamento recusado como evento mais recente ⇒ PAYMENT_DECLINED', () => {
    expect(
      classifyAbandonmentCause(summary({ last_relevant_event: 'PAYMENT_FAILED' }), INACTIVITY_DAYS)
    ).toBe('PAYMENT_DECLINED');
  });

  it('5.7 inatividade acima do limite ⇒ PROLONGED_INACTIVITY', () => {
    expect(
      classifyAbandonmentCause(
        summary({ days_since_last_access: INACTIVITY_DAYS + 1 }),
        INACTIVITY_DAYS
      )
    ).toBe('PROLONGED_INACTIVITY');
  });

  it('nada se aplica ⇒ UNKNOWN (totalidade)', () => {
    expect(classifyAbandonmentCause(summary({}), INACTIVITY_DAYS)).toBe('UNKNOWN');
  });

  it('5.9 precedência: falha posterior (PAYMENT_FAILED) vence cadastro abandonado', () => {
    expect(
      classifyAbandonmentCause(
        summary({
          signup_started: true,
          signup_completed: false,
          last_relevant_event: 'PAYMENT_FAILED',
        }),
        INACTIVITY_DAYS
      )
    ).toBe('PAYMENT_DECLINED');
  });

  it('5.9 precedência: APP_CRASH vence inatividade simultânea', () => {
    expect(
      classifyAbandonmentCause(
        summary({ last_relevant_event: 'APP_CRASH', days_since_last_access: 999 }),
        INACTIVITY_DAYS
      )
    ).toBe('APP_CRASH');
  });

  it('recusas de frete acima do limite ⇒ FREIGHTS_IGNORED (quando nada mais grave)', () => {
    expect(
      classifyAbandonmentCause(
        summary({ freight_refusals: FREIGHTS_IGNORED_THRESHOLD }),
        INACTIVITY_DAYS
      )
    ).toBe('FREIGHTS_IGNORED');
  });
});
