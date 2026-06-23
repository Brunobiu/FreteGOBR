// Feature: admin-rastreamento-inteligente — Recovery_Rule_Engine helpers (unit).
//
// Cobre resolveRecoveryScenario (mapeamento evento→cenário + RISK default +
// EVENT inelegível ⇒ null) e defaultAntiSpamConfig (10min/24h/72h/1).
//
// Validates: Requirements 9.1, 9.3, 9.4

import { describe, it, expect } from 'vitest';

import {
  resolveRecoveryScenario,
  defaultAntiSpamConfig,
  decideRecovery,
  type RecoveryTrigger,
} from '../../../services/admin/rastreamento/recoveryRuleEngine';

function trigger(over: Partial<RecoveryTrigger>): RecoveryTrigger {
  return {
    kind: 'EVENT',
    event_type: null,
    user_id: 'u1',
    occurred_at: 0,
    is_critical: false,
    message_hash: 'h',
    ...over,
  };
}

describe('resolveRecoveryScenario', () => {
  it('mapeia eventos conhecidos ao cenário', () => {
    expect(resolveRecoveryScenario(trigger({ event_type: 'SIGNUP_COMPLETED' }))).toBe('NEW_SIGNUP_WELCOME');
    expect(resolveRecoveryScenario(trigger({ event_type: 'SIGNUP_ABANDONED' }))).toBe('SIGNUP_ABANDONED');
    expect(resolveRecoveryScenario(trigger({ event_type: 'CHECKOUT_ABANDONED' }))).toBe('SIGNUP_ABANDONED');
    expect(resolveRecoveryScenario(trigger({ event_type: 'PAYMENT_FAILED' }))).toBe('PAYMENT_FAILED');
    expect(resolveRecoveryScenario(trigger({ event_type: 'INACTIVITY_DETECTED' }))).toBe('USER_INACTIVE');
    expect(resolveRecoveryScenario(trigger({ event_type: 'FREIGHT_IGNORED' }))).toBe('COLD_DRIVER');
  });

  it('gatilho RISK sem evento mapeável ⇒ USER_INACTIVE', () => {
    expect(resolveRecoveryScenario(trigger({ kind: 'RISK', event_type: null }))).toBe('USER_INACTIVE');
  });

  it('EVENT com tipo não mapeável ⇒ null (NO_ELIGIBLE_SCENARIO)', () => {
    expect(resolveRecoveryScenario(trigger({ kind: 'EVENT', event_type: 'SITE_VISIT' }))).toBeNull();
    const decision = decideRecovery(trigger({ kind: 'EVENT', event_type: 'SITE_VISIT' }), [], defaultAntiSpamConfig(1000));
    expect(decision).toEqual({ kind: 'SUPPRESS', reason: 'NO_ELIGIBLE_SCENARIO' });
  });
});

describe('defaultAntiSpamConfig', () => {
  it('usa 10min / 24h / 72h / janela 24h / 1 por janela', () => {
    const cfg = defaultAntiSpamConfig(123456);
    expect(cfg.now).toBe(123456);
    expect(cfg.min_delay_ms).toBe(10 * 60 * 1000);
    expect(cfg.cooldown_min_ms).toBe(24 * 60 * 60 * 1000);
    expect(cfg.cooldown_max_ms).toBe(72 * 60 * 60 * 1000);
    expect(cfg.window_ms).toBe(24 * 60 * 60 * 1000);
    expect(cfg.max_per_window).toBe(1);
  });
});
