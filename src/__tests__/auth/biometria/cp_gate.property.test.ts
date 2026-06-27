/**
 * Property-Based Test — biometria-app: máquina de estados da trava (pura).
 *
 * Feature: biometria-app
 * Validates: CP1 (gate condicional), CP2 (segredo mínimo), CP3 (fallback sem
 * lockout), CP5 (desbloqueio só após sucesso+restauração).
 *
 * `biometricGate.ts` é o núcleo PURO (sem plugin nativo). O hook/serviço só o
 * acionam — assim a lógica de segurança é testável de forma determinística.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  shouldShowLock,
  nextGateState,
  credentialToStore,
  BIOMETRIC_CREDENTIAL_USERNAME,
  type GateState,
  type GateEvent,
} from '../../../services/biometricGate';

const STATES: GateState[] = ['idle', 'locked', 'unlocking', 'unlocked', 'fallback'];

describe('CP1 — shouldShowLock', () => {
  it('verdadeiro só quando nativo E disponível E habilitado', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (isNative, isAvailable, isEnabled) => {
        expect(shouldShowLock({ isNative, isAvailable, isEnabled })).toBe(
          isNative && isAvailable && isEnabled
        );
      })
    );
  });
});

describe('CP5 — desbloqueio só após biometria + restauração', () => {
  it("nenhum evento isolado leva 'locked' direto a 'unlocked'", () => {
    const events: GateEvent['type'][] = [
      'BIOMETRIC_SUCCESS',
      'BIOMETRIC_FAILED',
      'BIOMETRIC_CANCELLED',
      'USE_PASSWORD',
      'SESSION_RESTORED',
      'SESSION_RESTORE_FAILED',
      'RESET',
    ];
    for (const t of events) {
      expect(nextGateState('locked', { type: t } as GateEvent)).not.toBe('unlocked');
    }
  });

  it("a sequência correta (BIOMETRIC_SUCCESS → SESSION_RESTORED) chega a 'unlocked'", () => {
    const s1 = nextGateState('locked', { type: 'BIOMETRIC_SUCCESS' });
    expect(s1).toBe('unlocking');
    expect(nextGateState(s1, { type: 'SESSION_RESTORED' })).toBe('unlocked');
  });
});

describe('CP3 — sem lockout terminal: fallback sempre alcançável', () => {
  it('USE_PASSWORD de locked/unlocking ⇒ fallback', () => {
    expect(nextGateState('locked', { type: 'USE_PASSWORD' })).toBe('fallback');
    expect(nextGateState('unlocking', { type: 'USE_PASSWORD' })).toBe('fallback');
  });

  it('falha/cancelamento ⇒ volta a locked (não desloga sozinho, permite tentar de novo)', () => {
    expect(nextGateState('locked', { type: 'BIOMETRIC_FAILED' })).toBe('locked');
    expect(nextGateState('unlocking', { type: 'BIOMETRIC_CANCELLED' })).toBe('locked');
  });

  it('token revogado (SESSION_RESTORE_FAILED) ⇒ fallback', () => {
    expect(nextGateState('unlocking', { type: 'SESSION_RESTORE_FAILED' })).toBe('fallback');
  });
});

describe('reducer — determinismo e RESET', () => {
  const EVENTS: GateEvent[] = [
    { type: 'CHECK', env: { isNative: true, isAvailable: true, isEnabled: true } },
    { type: 'CHECK', env: { isNative: false, isAvailable: false, isEnabled: false } },
    { type: 'BIOMETRIC_SUCCESS' },
    { type: 'SESSION_RESTORED' },
    { type: 'SESSION_RESTORE_FAILED' },
    { type: 'BIOMETRIC_FAILED' },
    { type: 'BIOMETRIC_CANCELLED' },
    { type: 'USE_PASSWORD' },
    { type: 'RESET' },
  ];

  it('determinístico: mesma (estado,evento) ⇒ mesmo resultado', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATES), fc.constantFrom(...EVENTS), (s, e) => {
        expect(nextGateState(s, e)).toBe(nextGateState(s, e));
      })
    );
  });

  it('RESET sempre leva a idle', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATES), (s) => {
        expect(nextGateState(s, { type: 'RESET' })).toBe('idle');
      })
    );
  });

  it('CHECK só decide a partir de idle (não reabre após desbloqueio)', () => {
    const lockEnv = { isNative: true, isAvailable: true, isEnabled: true };
    expect(nextGateState('idle', { type: 'CHECK', env: lockEnv })).toBe('locked');
    expect(nextGateState('unlocked', { type: 'CHECK', env: lockEnv })).toBe('unlocked');
  });
});

describe('CP2 — credentialToStore guarda só o refresh token', () => {
  it('password === refreshToken; username constante (senha do usuário nunca entra)', () => {
    fc.assert(
      fc.property(fc.string(), (token) => {
        const c = credentialToStore(token);
        expect(c.password).toBe(token);
        expect(c.username).toBe(BIOMETRIC_CREDENTIAL_USERNAME);
      })
    );
  });
});
