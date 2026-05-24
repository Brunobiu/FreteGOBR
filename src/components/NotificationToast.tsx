import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  NEW_NOTIFICATION_EVENT,
  useNotificationsRealtime,
} from '../hooks/useNotificationsRealtime';
import { useAuth } from '../hooks/useAuth';
import { markNotificationAsRead, type Notification } from '../services/notifications';

/**
 * Toast efêmero exibido no canto inferior direito ao chegar uma
 * notificação nova via realtime. Ao clicar, marca como lida e navega
 * pro link da notificação. Some sozinho após 5 segundos.
 *
 * Múltiplos toasts podem se empilhar; cada um tem seu timer.
 */

interface ToastItem {
  notif: Notification;
  expiresAt: number;
  /** Quando definido, o timer está pausado (mouse em cima). */
  pausedAt: number | null;
}

const TOAST_DURATION_MS = 5000;

export default function NotificationToast() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ToastItem[]>([]);

  // Liga o canal realtime quando o usuário está logado.
  useNotificationsRealtime(isAuthenticated ? user?.id : undefined);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<Notification>;
      const notif = ce.detail;
      setItems((prev) => [
        ...prev,
        { notif, expiresAt: Date.now() + TOAST_DURATION_MS, pausedAt: null },
      ]);
    };
    window.addEventListener(NEW_NOTIFICATION_EVENT, handler);
    return () => window.removeEventListener(NEW_NOTIFICATION_EVENT, handler);
  }, []);

  // Limpa toasts expirados periodicamente (ignora os pausados).
  useEffect(() => {
    if (items.length === 0) return;
    const interval = setInterval(() => {
      setItems((prev) =>
        prev.filter((t) => t.pausedAt !== null || t.expiresAt > Date.now())
      );
    }, 500);
    return () => clearInterval(interval);
  }, [items.length]);

  const pause = (id: string) => {
    setItems((prev) =>
      prev.map((t) => (t.notif.id === id && t.pausedAt === null ? { ...t, pausedAt: Date.now() } : t))
    );
  };

  const resume = (id: string) => {
    setItems((prev) =>
      prev.map((t) => {
        if (t.notif.id !== id || t.pausedAt === null) return t;
        // Estende a expiração pelo tempo que ficou pausado.
        const pausedFor = Date.now() - t.pausedAt;
        return { ...t, expiresAt: t.expiresAt + pausedFor, pausedAt: null };
      })
    );
  };

  const dismiss = (id: string) => {
    setItems((prev) => prev.filter((t) => t.notif.id !== id));
  };

  const handleClick = async (notif: Notification) => {
    dismiss(notif.id);
    try {
      await markNotificationAsRead(notif.id);
    } catch {
      /* ignore */
    }
    if (notif.link) navigate(notif.link);
  };

  if (!isAuthenticated || items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
      {items.map(({ notif }) => (
        <button
          key={notif.id}
          onClick={() => handleClick(notif)}
          onMouseEnter={() => pause(notif.id)}
          onMouseLeave={() => resume(notif.id)}
          onFocus={() => pause(notif.id)}
          onBlur={() => resume(notif.id)}
          className="pointer-events-auto bg-white border border-blue-200 rounded-lg shadow-xl px-3 py-2.5 max-w-xs text-left hover:shadow-2xl transition-all hover:border-blue-400"
          style={{ animation: 'slide-in-right 0.3s ease-out' }}
        >
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{notif.title}</p>
              <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{notif.message}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismiss(notif.id);
              }}
              className="text-gray-400 hover:text-gray-600 p-0.5"
              aria-label="Fechar"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </button>
      ))}
    </div>
  );
}
