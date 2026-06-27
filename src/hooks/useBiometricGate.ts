/**
 * useBiometricGate — orquestra a trava biométrica (spec biometria-app).
 *
 * Decide quando exibir a trava (só app nativo + hardware disponível + opt-in +
 * sessão autenticada), reavalia ao retornar do background, e expõe ações de
 * desbloqueio e fallback. A lógica de transição é a função PURA `nextGateState`
 * (testada por property tests); os efeitos aqui apenas a acionam.
 */

import { useState, useEffect, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useAuth } from './useAuth';
import {
  isNativePlatform,
  isBiometricAvailable,
  isBiometricEnabled,
} from '../services/biometricAuth';
import { nextGateState, shouldShowLock, type GateState } from '../services/biometricGate';

export interface BiometricGateApi {
  state: GateState;
  /** Dispara a verificação biométrica e restaura a sessão em caso de sucesso. */
  tryUnlock: () => Promise<void>;
  /** Sai da trava para o Login_Completo (senha/código) — desloga a sessão. */
  useFallback: () => void;
}

export function useBiometricGate(): BiometricGateApi {
  const { isAuthenticated, unlockWithBiometric, logout } = useAuth();
  // Web começa 'unlocked' (sem trava, sem flash). Nativo começa 'idle' e decide.
  const [state, setState] = useState<GateState>(() => (isNativePlatform() ? 'idle' : 'unlocked'));

  const runCheck = useCallback(async () => {
    if (!isNativePlatform() || !isAuthenticated) {
      setState('unlocked');
      return;
    }
    const [available, enabled] = await Promise.all([isBiometricAvailable(), isBiometricEnabled()]);
    setState(
      shouldShowLock({ isNative: true, isAvailable: available, isEnabled: enabled })
        ? 'locked'
        : 'unlocked'
    );
  }, [isAuthenticated]);

  // Checagem inicial + a cada mudança de autenticação.
  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  // Reavalia (re-trava) ao retornar do background — comportamento de cadeado.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void runCheck();
    }).then((h) => {
      handle = h;
    });
    return () => handle?.remove();
  }, [runCheck]);

  const tryUnlock = useCallback(async () => {
    setState((s) => nextGateState(s, { type: 'BIOMETRIC_SUCCESS' })); // locked → unlocking
    const ok = await unlockWithBiometric();
    setState((s) =>
      nextGateState(s, ok ? { type: 'SESSION_RESTORED' } : { type: 'BIOMETRIC_FAILED' })
    );
  }, [unlockWithBiometric]);

  const useFallback = useCallback(() => {
    setState((s) => nextGateState(s, { type: 'USE_PASSWORD' }));
  }, []);

  // Auto-prompt: ao travar, pede a biometria de imediato (estilo banco).
  useEffect(() => {
    if (state === 'locked') void tryUnlock();
  }, [state, tryUnlock]);

  // Fallback ⇒ desloga; o roteador (ProtectedRoute) leva ao /login.
  useEffect(() => {
    if (state === 'fallback') void logout();
  }, [state, logout]);

  return { state, tryUnlock, useFallback };
}
