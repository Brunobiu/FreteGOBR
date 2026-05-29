import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupPushListeners } from '../services/pushNotifications';
import { isNative } from '../services/platform';

/**
 * Bootstrap dos listeners de push notification do Capacitor.
 *
 * - Em foreground: dispara evento global `fretego-notifications-refresh`
 *   pra forcar refresh do badge no AppHeader.
 * - Em background (tap na push): navega pro link da notification.
 *
 * No web nao faz nada.
 */
export default function NativePushBootstrap() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;

    setupPushListeners({
      onForegroundReceived: () => {
        if (cancelled) return;
        // Forca refetch do badge
        window.dispatchEvent(new Event('fretego-notifications-refresh'));
      },
      onTap: ({ link }) => {
        if (cancelled) return;
        if (link) {
          navigate(link);
        }
      },
    }).catch((err) => {
      console.warn('[push] setupPushListeners falhou', err);
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
