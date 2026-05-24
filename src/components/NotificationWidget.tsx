import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type Notification,
} from '../services/notifications';

/**
 * Widget de notificações flutuante no canto inferior esquerdo.
 * Botão com badge de não lidas; ao abrir, mostra um painel com a lista.
 */
export default function NotificationWidget() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated && user) {
      getUnreadNotificationCount(user.id)
        .then(setUnreadCount)
        .catch(() => {});
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleOpen = async () => {
    if (!user) return;
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      try {
        const data = await getNotifications(user.id, 3);
        setNotifications(data);
      } catch {
        /* ignore */
      }
    }
  };

  const handleClick = async (notif: Notification) => {
    await markNotificationAsRead(notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, readAt: new Date() } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    setIsOpen(false);
    if (notif.link) navigate(notif.link);
  };

  const handleMarkAll = async () => {
    if (!user) return;
    await markAllNotificationsAsRead(user.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date() })));
    setUnreadCount(0);
  };

  if (!isAuthenticated) return null;

  return (
    <div ref={panelRef} className="fixed bottom-6 left-6 z-50">
      {/* Botão flutuante */}
      <button
        onClick={handleOpen}
        title="Notificações"
        className="relative w-14 h-14 bg-white border border-gray-200 hover:border-blue-500 text-gray-700 hover:text-blue-600 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[11px] rounded-full flex items-center justify-center font-semibold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Painel */}
      {isOpen && (
        <div className="absolute bottom-16 left-0 w-80 bg-white border border-gray-200 rounded-lg shadow-xl max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <span className="text-sm font-semibold text-gray-800">Notificações</span>
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
            <p className="px-4 py-8 text-sm text-gray-500 text-center">Nenhuma notificação</p>
          ) : (
            <>
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    !notif.readAt ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!notif.readAt && (
                      <span className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{notif.title}</p>
                      <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{notif.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(notif.createdAt).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/notificacoes');
                }}
                className="w-full px-4 py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors border-t border-gray-200"
              >
                Ver mais notificações →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
