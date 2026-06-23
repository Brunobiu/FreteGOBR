// Feature: admin-rastreamento-inteligente, Property 9 (CP9): Anti_Spam_Guard —
// invariantes de supressão + idempotência.
//
// (a) dentro do Cooldown (24–72h) ⇒ SUPPRESS WITHIN_COOLDOWN;
// (b) no máximo 1 mensagem automática por evento crítico (excedente ⇒
//     MAX_PER_WINDOW_REACHED ou DUPLICATE_MESSAGE);
// (c) havendo Recovery_Attempt ativa ⇒ SUPPRESS CONCURRENT_RECOVERY_ACTIVE;
// (d) reavaliar o mesmo estado produz a mesma decisão (idempotência).
//
// Validates: Requirements 9.4, 9.5, 9.6, 9.7, 9.11

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  decideRecovery,
  type RecoveryTrigger,
  type RecoveryHistoryItem,
} from '../../../services/admin/rastreamento/recoveryRuleEngine';
import { NOW_MS, antiSpamConfigArb, recoveryHistoryArb } from './_generators';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Gatilho por risco — sempre resolve para USER_INACTIVE (não-welcome). */
function riskTrigger(messageHash: string, isCritical = false): RecoveryTrigger {
  return {
    kind: 'RISK',
    event_type: null,
    user_id: '11111111-1111-4111-8111-111111111111',
    occurred_at: NOW_MS - HOUR,
    is_critical: isCritical,
    message_hash: messageHash,
  };
}

const STD_CFG = {
  now: NOW_MS,
  min_delay_ms: 10 * MIN,
  cooldown_min_ms: 24 * HOUR,
  cooldown_max_ms: 72 * HOUR,
  window_ms: 24 * HOUR,
  max_per_window: 1,
};

describe('CP9 — Anti_Spam_Guard', () => {
  it('(a) dentro do cooldown (24–72h, sem ativa, sem dedup) ⇒ WITHIN_COOLDOWN', () => {
    fc.assert(
      fc.property(fc.integer({ min: 24 * HOUR, max: 72 * HOUR - 1 }), (elapsed) => {
        const history: RecoveryHistoryItem[] = [
          {
            scenario: 'USER_INACTIVE',
            created_at: NOW_MS - elapsed,
            contact_status: 'CONTACTED',
            message_hash: 'h-old',
            trigger_event_id: null,
            active: false,
          },
        ];
        const decision = decideRecovery(riskTrigger('h-new'), history, STD_CFG);
        expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'WITHIN_COOLDOWN' });
      }),
      { numRuns: 200 }
    );
  });

  it('(c) recuperação ativa em curso ⇒ CONCURRENT_RECOVERY_ACTIVE', () => {
    fc.assert(
      fc.property(recoveryHistoryArb(), (history) => {
        const withActive: RecoveryHistoryItem[] = [
          ...history,
          {
            scenario: 'USER_INACTIVE',
            created_at: NOW_MS - 100 * HOUR,
            contact_status: 'CONTACTED',
            message_hash: 'h-active',
            trigger_event_id: null,
            active: true,
          },
        ];
        const decision = decideRecovery(riskTrigger('h-fresh'), withActive, STD_CFG);
        expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'CONCURRENT_RECOVERY_ACTIVE' });
      }),
      { numRuns: 200 }
    );
  });

  it('(b) mensagem idêntica já enviada ⇒ DUPLICATE_MESSAGE', () => {
    const history: RecoveryHistoryItem[] = [
      {
        scenario: 'USER_INACTIVE',
        created_at: NOW_MS - 200 * HOUR, // fora do cooldown
        contact_status: 'CONTACTED',
        message_hash: 'dup',
        trigger_event_id: null,
        active: false,
      },
    ];
    const decision = decideRecovery(riskTrigger('dup', true), history, STD_CFG);
    expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'DUPLICATE_MESSAGE' });
  });

  it('(b) evento crítico com 1 disparo na janela (fora do cooldown) ⇒ MAX_PER_WINDOW_REACHED', () => {
    // window > cooldown_max para isolar o limite por janela do cooldown.
    const cfg = { ...STD_CFG, window_ms: 96 * HOUR, max_per_window: 1 };
    fc.assert(
      fc.property(fc.integer({ min: 72 * HOUR, max: 96 * HOUR }), (elapsed) => {
        const history: RecoveryHistoryItem[] = [
          {
            scenario: 'USER_INACTIVE',
            created_at: NOW_MS - elapsed, // fora do cooldown, dentro da janela
            contact_status: 'CONTACTED',
            message_hash: 'h-old',
            trigger_event_id: null,
            active: false,
          },
        ];
        const decision = decideRecovery(riskTrigger('h-new', true), history, cfg);
        expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'MAX_PER_WINDOW_REACHED' });
      }),
      { numRuns: 200 }
    );
  });

  it('(b) garantia central: havendo disparo recente para evento crítico, NÃO há DISPATCH', () => {
    const history: RecoveryHistoryItem[] = [
      {
        scenario: 'USER_INACTIVE',
        created_at: NOW_MS - 1 * HOUR,
        contact_status: 'CONTACTED',
        message_hash: 'h-old',
        trigger_event_id: null,
        active: false,
      },
    ];
    const decision = decideRecovery(riskTrigger('h-new', true), history, STD_CFG);
    expect(decision.kind).toBe('SUPPRESS');
  });

  it('(d) idempotência: reavaliar o mesmo estado dá a mesma decisão', () => {
    fc.assert(
      fc.property(recoveryHistoryArb(), antiSpamConfigArb(), (history, cfg) => {
        const t = riskTrigger('h-x');
        const a = decideRecovery(t, history, cfg);
        const b = decideRecovery(t, history, cfg);
        expect(b).toEqual(a);
      }),
      { numRuns: 200 }
    );
  });

  it('estado limpo (sem histórico) ⇒ DISPATCH com cenário do domínio', () => {
    const decision = decideRecovery(riskTrigger('h-new'), [], STD_CFG);
    expect(decision).toEqual({
      kind: 'DISPATCH',
      scenario: 'USER_INACTIVE',
      template_key: 'USER_INACTIVE',
    });
  });
});
