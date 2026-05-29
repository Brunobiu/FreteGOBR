/**
 * services/pushNotifications.ts
 *
 * Setup de push notifications nativas via Capacitor + FCM.
 *
 * Ciclo:
 *   1. App carrega.
 *   2. User loga.
 *   3. `registerForPush(userId)` pede permissao (Android 13+),
 *      registra no FCM, recebe token, salva em `device_tokens`
 *      via RPC `register_device_token`.
 *   4. Quando chega push em foreground: hook customizado pode
 *      tratar (ex: refresh badge).
 *   5. Quando user toca na push (em background): listener
 *      `pushNotificationActionPerformed` navega pra notification.link.
 *   6. Logout: `unregisterPush(userId, token)` chama RPC
 *      `unregister_device_token`.
 */

import { isNative, getPlatform } from './platform';
import { supabase } from './supabase';

// Imports dinamicos para nao quebrar build web (plugin so existe no nativo)
type PushPlugin = {
  requestPermissions: () => Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register: () => Promise<void>;
  addListener: (
    eventName: string,
    callback: (payload: unknown) => void
  ) => Promise<{ remove: () => Promise<void> }>;
  removeAllListeners: () => Promise<void>;
};

let cachedToken: string | null = null;

function isPushSupported(): boolean {
  return isNative();
}

/**
 * Registra device para push e salva token no banco.
 * No-op no web (Phase 1; Web Push pode ser adicionado em Phase 2).
 *
 * Chamar apos login bem-sucedido.
 */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string; token?: string }> {
  if (!isPushSupported()) {
    return { ok: false, reason: 'not_native' };
  }

  let PushNotifications: PushPlugin;
  try {
    const mod = await import('@capacitor/push-notifications');
    PushNotifications = mod.PushNotifications as unknown as PushPlugin;
  } catch (err) {
    console.warn('[push] plugin nao disponivel', err);
    return { ok: false, reason: 'plugin_missing' };
  }

  // Pede permissao
  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') {
    return { ok: false, reason: 'permission_denied' };
  }

  // Listener pra quando o token chegar
  return new Promise((resolve) => {
    PushNotifications.addListener('registration', async (data: unknown) => {
      const token = (data as { value?: string })?.value;
      if (!token) {
        resolve({ ok: false, reason: 'empty_token' });
        return;
      }
      cachedToken = token;

      // Persiste no banco via RPC
      try {
        const { error } = await supabase.rpc('register_device_token', {
          p_token: token,
          p_platform: getPlatform(),
          p_app_version: null,
          p_device_model: null,
        });
        if (error) {
          console.warn('[push] erro ao registrar token no banco', error);
          resolve({ ok: false, reason: 'register_failed', token });
          return;
        }
        resolve({ ok: true, token });
      } catch (err) {
        console.warn('[push] excecao ao registrar token', err);
        resolve({ ok: false, reason: 'register_exception', token });
      }
    });

    PushNotifications.addListener('registrationError', (err: unknown) => {
      console.warn('[push] registration error', err);
      resolve({ ok: false, reason: 'registration_error' });
    });

    // Inicia o registro junto ao FCM
    PushNotifications.register().catch((err) => {
      console.warn('[push] register() falhou', err);
      resolve({ ok: false, reason: 'register_call_failed' });
    });
  });
}

/**
 * Remove o token atual do banco. Chamar antes do logout.
 */
export async function unregisterPush(): Promise<void> {
  if (!isPushSupported() || !cachedToken) return;
  try {
    await supabase.rpc('unregister_device_token', { p_token: cachedToken });
  } catch (err) {
    console.warn('[push] erro ao remover token', err);
  }
  cachedToken = null;
}

/**
 * Setup de listeners de push (notificacao recebida em foreground,
 * tap em background). Idempotente — chamar uma unica vez no boot.
 *
 * @param onTap callback quando user toca na push (em background).
 *              Recebe { notification_id, link, type }.
 */
export async function setupPushListeners(opts: {
  onTap?: (data: { notification_id?: string; link?: string; type?: string }) => void;
  onForegroundReceived?: (notification: {
    title?: string;
    body?: string;
    data?: Record<string, string>;
  }) => void;
}): Promise<void> {
  if (!isPushSupported()) return;

  let PushNotifications: PushPlugin;
  try {
    const mod = await import('@capacitor/push-notifications');
    PushNotifications = mod.PushNotifications as unknown as PushPlugin;
  } catch {
    return;
  }

  // Push recebida com app aberto (foreground)
  await PushNotifications.addListener('pushNotificationReceived', (notif: unknown) => {
    const n = notif as {
      title?: string;
      body?: string;
      data?: Record<string, string>;
    };
    opts.onForegroundReceived?.(n);
  });

  // User tocou em uma push (background → app abre)
  await PushNotifications.addListener('pushNotificationActionPerformed', (action: unknown) => {
    const a = action as { notification?: { data?: Record<string, string> } };
    const data = a.notification?.data ?? {};
    opts.onTap?.({
      notification_id: data.notification_id,
      link: data.link,
      type: data.type,
    });
  });
}
