/**
 * services/nativeStorage.ts
 *
 * Wrapper sobre `localStorage` (web) e `@capacitor/preferences` (nativo).
 *
 * Por que existe: localStorage em Capacitor WebView funciona, mas em
 * casos específicos (limpeza de cache do sistema, troca de WebView)
 * pode ser apagado. `Preferences` do Capacitor escreve em armazenamento
 * nativo persistente (SharedPreferences no Android, UserDefaults no iOS),
 * sobrevive a esses cenários.
 *
 * Uso recomendado:
 * - Tokens de autenticação críticos.
 * - Preferências importantes (ex: opt-out de GPS).
 *
 * Para preferências triviais (ex: tema da UI, último filtro), continuar
 * usando localStorage direto está OK.
 */

import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';

export async function nativeGet(key: string): Promise<string | null> {
  if (isNative()) {
    const { value } = await Preferences.get({ key });
    return value;
  }
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

export async function nativeSet(key: string, value: string): Promise<void> {
  if (isNative()) {
    await Preferences.set({ key, value });
    return;
  }
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
}

export async function nativeRemove(key: string): Promise<void> {
  if (isNative()) {
    await Preferences.remove({ key });
    return;
  }
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key);
}
