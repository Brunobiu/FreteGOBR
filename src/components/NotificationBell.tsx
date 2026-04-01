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

export default function NotificationBell() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated && user) {
      getUnreadNotificationCount(user.id)
        .then(setUnreadCount)
        .catch(() => {});
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpen = async () => {
    if (!user) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
      try {
        const data = await getNotifications(user.id);
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
    <div className="relative" ref={menuRef}>
      <button
        onClick={handleOpen}
        className="p-2 text-gray-400 hover:text-white transition-colors relative"
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
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
            <span className="text-sm font-medium text-white">Notificações</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAll} className="text-xs text-blue-400 hover:text-blue-300">
                Marcar todas
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Nenhuma notificação</p>
          ) : (
            notifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => handleClick(notif)}
                className={`w-full text-left px-4 py-3 border-b border-gray-700/50 hover:bg-gray-700 transition-colors ${!notif.readAt ? 'bg-gray-750' : ''}`}
              >
                <p className="text-sm text-white">{notif.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{notif.message}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {new Date(notif.createdAt).toLocaleDateString('pt-BR')}
                </p>
                {!notif.readAt && (
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-1" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
