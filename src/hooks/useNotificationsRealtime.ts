import { useEffect } from 'react';
import { supabase } from '../services/supabase';
import type { Notification } from '../services/notifications';

/**
 * Evento global emitido quando chega uma notificação nova via realtime.
 * Componentes podem escutar com:
 *   window.addEventListener('fretego:new-notification', (e) => ...)
 *
 * O `detail` é a notificação no formato canônico (camelCase).
 */
export const NEW_NOTIFICATION_EVENT = 'fretego:new-notification';

interface RawNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

function mapRaw(raw: RawNotification): Notification {
  return {
    id: raw.id,
    userId: raw.user_id,
    type: raw.type,
    title: raw.title,
    message: raw.message,
    link: raw.link,
    readAt: raw.read_at ? new Date(raw.read_at) : null,
    createdAt: new Date(raw.created_at),
  };
}

/**
 * Assina o canal realtime de `notifications` filtrado pelo usuário
 * logado. Cada INSERT dispara um CustomEvent global pra que múltiplos
 * consumidores (sino + toast) reajam sem precisar duplicar a
 * subscription.
 */
export function useNotificationsRealtime(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const raw = payload.new as RawNotification;
          const notif = mapRaw(raw);
          window.dispatchEvent(
            new CustomEvent<Notification>(NEW_NOTIFICATION_EVENT, { detail: notif })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
