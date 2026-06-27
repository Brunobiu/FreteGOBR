/**
 * Unit — biometria-app, CP4: degradação segura fora do nativo.
 *
 * Feature: biometria-app
 * Validates: CP4 (sem plataforma nativa / sem plugin ⇒ indisponível, sem lançar).
 *
 * No ambiente de teste (jsdom), `Capacitor.isNativePlatform()` é falso (web),
 * então o wrapper deve reportar biometria indisponível e desabilitada SEM
 * propagar exceção — garantindo que o app web nunca trave por causa da feature.
 */
import { describe, it, expect } from 'vitest';
import {
  isNativePlatform,
  isBiometricAvailable,
  isBiometricEnabled,
} from '../../../services/biometricAuth';

describe('CP4 — degradação segura (web / sem plugin)', () => {
  it('isNativePlatform() é falso no ambiente web de teste', () => {
    expect(isNativePlatform()).toBe(false);
  });

  it('isBiometricAvailable() ⇒ false sem lançar', async () => {
    await expect(isBiometricAvailable()).resolves.toBe(false);
  });

  it('isBiometricEnabled() ⇒ false sem lançar', async () => {
    await expect(isBiometricEnabled()).resolves.toBe(false);
  });
});
