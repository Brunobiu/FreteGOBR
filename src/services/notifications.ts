/**
 * Notification Service
 */

import { supabase } from './supabase';

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Buscar notificações do usuário
 */
export async function getNotifications(userId: string, limit = 20): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erro ao buscar notificações: ${error.message}`);
  return data.map(mapNotification);
}

/**
 * Contar não lidas
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) return 0;
  return data.length;
}

/**
 * Marcar como lida
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) throw new Error(`Erro ao marcar notificação: ${error.message}`);
}

/**
 * Marcar todas como lidas
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw new Error(`Erro: ${error.message}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNotification(data: any): Notification {
  return {
    id: data.id,
    userId: data.user_id,
    type: data.type,
    title: data.title,
    message: data.message,
    link: data.link,
    readAt: data.read_at ? new Date(data.read_at) : null,
    createdAt: new Date(data.created_at),
  };
}
