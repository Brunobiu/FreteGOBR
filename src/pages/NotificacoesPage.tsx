import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type Notification,
} from '../services/notifications';
import AppHeader from '../components/AppHeader';
import MotoristaInteressadoModal from '../components/MotoristaInteressadoModal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Página com a lista completa de notificações do usuário logado.
 * Acessada via "Ver mais notificações" no sino/widget.
 */
export default function NotificacoesPage() {
  useDocumentTitle('Notificações');
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal "Motorista interessado" inline (evita navegar pra /embarcador)
  const [interesseFreteId, setInteresseFreteId] = useState<string | null>(null);
  const [interesseMotoristaId, setInteresseMotoristaId] = useState<string | null>(null);

  const reload = async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      // Mostra muitas — 200 cobre histórico real sem virar paginação ainda.
      const data = await getNotifications(user.id, 200);
      setNotifications(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  const handleClick = async (notif: Notification) => {
    if (!notif.readAt) {
      try {
        await markNotificationAsRead(notif.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, readAt: new Date() } : n))
        );
      } catch {
        /* ignore */
      }
    }
    if (!notif.link) return;

    // Notificação de motorista interessado (curtida): abre o modal
    // dentro desta mesma página em vez de navegar pra /embarcador.
    if (notif.type === 'frete_like') {
      try {
        const url = new URL(notif.link, window.location.origin);
        const frete = url.searchParams.get('frete');
        const motorista = url.searchParams.get('motorista');
        if (frete) {
          setInteresseFreteId(frete);
          setInteresseMotoristaId(motorista);
          return;
        }
      } catch {
        /* fallback pro navigate normal */
      }
    }

    navigate(notif.link);
  };

  const handleMarkAll = async () => {
    if (!user) return;
    try {
      await markAllNotificationsAsRead(user.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date() })));
    } catch {
      /* ignore */
    }
  };

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Notificações</h1>
            <p className="text-sm text-gray-500">
              {notifications.length} no total
              {unreadCount > 0 ? ` · ${unreadCount} não lida${unreadCount > 1 ? 's' : ''}` : ''}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAll}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Marcar todas
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-500">Carregando...</div>
        ) : error ? (
          <div className="py-12 text-center text-red-600">{error}</div>
        ) : notifications.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center shadow-sm">
            <p className="text-gray-500">Você ainda não tem notificações.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            {notifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => handleClick(notif)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors ${
                  !notif.readAt ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  {!notif.readAt && (
                    <span className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{notif.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{notif.message}</p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {new Date(notif.createdAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <MotoristaInteressadoModal
        freteId={interesseFreteId}
        motoristaId={interesseMotoristaId}
        isOpen={!!interesseFreteId}
        onClose={() => {
          setInteresseFreteId(null);
          setInteresseMotoristaId(null);
        }}
      />
    </div>
  );
}
