import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  getUnreadNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type Notification,
} from '../services/notifications';
import { NEW_NOTIFICATION_EVENT } from '../hooks/useNotificationsRealtime';

/**
 * Sino do header. Mostra apenas as 3 notificações NÃO LIDAS mais
 * recentes. Quando o usuário clica numa notificação ela é marcada
 * como lida e somem do sino (continuando visível em /notificacoes).
 *
 * Reage a INSERTs em tempo real: o `NotificationToast` global cuida
 * da subscription via `useNotificationsRealtime`; aqui apenas
 * escutamos o evento `fretego:new-notification`.
 */
export default function NotificationBell() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshUnread = useCallback(async () => {
    if (!user) return;
    try {
      const [list, count] = await Promise.all([
        getUnreadNotifications(user.id, 3),
        getUnreadNotificationCount(user.id),
      ]);
      setNotifications(list);
      setUnreadCount(count);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      refreshUnread();
    }
  }, [isAuthenticated, user, refreshUnread]);

  // Realtime: novas notificações entram no topo da lista local.
  useEffect(() => {
    if (!isAuthenticated) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<Notification>;
      const notif = ce.detail;
      setNotifications((prev) => [notif, ...prev].slice(0, 3));
      setUnreadCount((c) => c + 1);
    };
    window.addEventListener(NEW_NOTIFICATION_EVENT, handler);
    return () => window.removeEventListener(NEW_NOTIFICATION_EVENT, handler);
  }, [isAuthenticated]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpen = async () => {
    if (!user) return;
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      await refreshUnread();
    }
  };

  const handleClick = async (notif: Notification) => {
    try {
      await markNotificationAsRead(notif.id);
    } catch {
      /* ignore */
    }
    // Some do sino (já lida), mas continua em /notificacoes
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    setUnreadCount((c) => Math.max(0, c - 1));
    setIsOpen(false);
    if (notif.link) navigate(notif.link);
  };

  const handleMarkAll = async () => {
    if (!user) return;
    try {
      await markAllNotificationsAsRead(user.id);
    } catch {
      /* ignore */
    }
    setNotifications([]);
    setUnreadCount(0);
  };

  if (!isAuthenticated) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={handleOpen}
        className="p-2 text-gray-500 hover:text-gray-800 transition-colors relative"
        aria-label="Notificações"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
            <span className="text-sm font-semibold text-gray-800">Não lidas</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAll}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Marcar todas
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">
              Você está em dia! Nenhuma não lida.
            </p>
          ) : (
            notifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => handleClick(notif)}
                className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50/60 transition-colors bg-blue-50"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{notif.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{notif.message}</p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {new Date(notif.createdAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/notificacoes');
            }}
            className="w-full px-4 py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors border-t border-gray-200"
          >
            Ver todas as notificações →
          </button>
        </div>
      )}
    </div>
  );
}
