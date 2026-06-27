/**
 * services/biometricAuth.ts
 *
 * Wrapper da biometria nativa (spec biometria-app). Acessa o plugin via o
 * BRIDGE do Capacitor (`registerPlugin`) em vez de importar um pacote npm —
 * assim o web compila sem dependência nova e o plugin nativo (instalado no
 * APK/IPA) é resolvido em runtime. Em web ou builds sem o plugin, as chamadas
 * falham e degradamos com segurança (feature detection, CP4).
 *
 * A biometria é uma TRAVA LOCAL: guarda o refresh token da sessão em
 * armazenamento seguro (Keychain/Keystore) e o devolve após a verificação.
 *
 * Plugin nativo esperado: `capacitor-native-biometric` (ou fork compatível com
 * Capacitor 8) — ver docs/BIOMETRIA_APP_BUILD.md.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { credentialToStore } from './biometricGate';

/** Namespace do credential no armazenamento seguro do aparelho. */
const SERVER = 'br.com.fretego.app';
/** Flag (não-secreta) de opt-in da biometria. */
const ENABLED_KEY = 'fretego_biometric_enabled';

interface IsAvailableResult {
  isAvailable: boolean;
  biometryType?: number;
  errorCode?: number;
}
interface Credentials {
  username: string;
  password: string;
}
interface NativeBiometricPlugin {
  isAvailable(): Promise<IsAvailableResult>;
  verifyIdentity(options?: {
    reason?: string;
    title?: string;
    subtitle?: string;
    description?: string;
  }): Promise<void>;
  setCredentials(options: { username: string; password: string; server: string }): Promise<void>;
  getCredentials(options: { server: string }): Promise<Credentials>;
  deleteCredentials(options: { server: string }): Promise<void>;
}

const NativeBiometric = registerPlugin<NativeBiometricPlugin>('NativeBiometric');

/** True quando rodando no app nativo (Android/iOS). */
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Há hardware biométrico disponível e utilizável? Degrada para `false` em web,
 * sem plugin, ou em qualquer erro (CP4 — nunca propaga exceção à UI).
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const result = await NativeBiometric.isAvailable();
    return result?.isAvailable === true;
  } catch {
    return false;
  }
}

/** Opt-in da biometria está ligado? */
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: ENABLED_KEY });
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * Ativa a biometria: pede verificação, guarda o refresh token no armazenamento
 * seguro e liga a flag. Lança em caso de cancelamento/erro (o chamador trata).
 */
export async function enableBiometric(refreshToken: string): Promise<void> {
  if (!refreshToken) throw new Error('Sessão sem refresh token.');
  await NativeBiometric.verifyIdentity({
    reason: 'Confirme para ativar a entrada por biometria',
    title: 'FreteGO',
  });
  const cred = credentialToStore(refreshToken);
  await NativeBiometric.setCredentials({
    username: cred.username,
    password: cred.password,
    server: SERVER,
  });
  await Preferences.set({ key: ENABLED_KEY, value: 'true' });
}

/**
 * Pede a verificação biométrica e, em sucesso, devolve o refresh token guardado.
 * Retorna `null` em falha/cancelamento (o chamador cai no Login_Completo).
 */
export async function unlockAndGetRefreshToken(): Promise<string | null> {
  try {
    await NativeBiometric.verifyIdentity({ reason: 'Desbloqueie o FreteGO', title: 'FreteGO' });
    const cred = await NativeBiometric.getCredentials({ server: SERVER });
    return cred?.password ?? null;
  } catch {
    return null;
  }
}

/** Desativa a biometria: apaga o credential seguro e desliga a flag (idempotente). */
export async function disableBiometric(): Promise<void> {
  try {
    await NativeBiometric.deleteCredentials({ server: SERVER });
  } catch {
    // best-effort
  }
  try {
    await Preferences.set({ key: ENABLED_KEY, value: 'false' });
  } catch {
    // best-effort
  }
}
