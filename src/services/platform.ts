/**
 * services/platform.ts
 *
 * Helper de detecção de plataforma. Wrapping do Capacitor para que o
 * código React possa decidir entre comportamento nativo e web sem
 * depender direto de `Capacitor` em todo lugar.
 *
 * Quando a app roda no browser (Vercel direto), `isNative()` retorna
 * `false` e tudo cai no fallback web. Quando roda dentro do app
 * Android/iOS via Capacitor, `isNative()` retorna `true` e podemos
 * usar plugins nativos (GPS preciso, câmera nativa, push real, etc.).
 */

import { Capacitor } from '@capacitor/core';

/** True se rodando dentro do Capacitor (Android ou iOS). */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** True se rodando especificamente no Android nativo. */
export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** True se rodando especificamente no iOS nativo. */
export function isIOS(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

/** True se rodando no browser (web ou PWA). */
export function isWeb(): boolean {
  return Capacitor.getPlatform() === 'web';
}

/**
 * Plataforma como string. Útil pra envio em `device_tokens.platform`
 * quando registrar push.
 */
export function getPlatform(): 'android' | 'ios' | 'web' {
  const p = Capacitor.getPlatform();
  if (p === 'android' || p === 'ios') return p;
  return 'web';
}
