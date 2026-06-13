import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  markNotificationAsRead,
  type Notification,
} from '../services/notifications';

type CategoryKey = 'anuncios' | 'chat' | 'tickets' | 'atividades';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

const SOUND_KEY = 'fretego-notif-sound';

/**
 * Triagem automatica do campo Notification.type para cada categoria.
 * Contrato versionado (Requirement 3 da spec notifications-hub):
 * prefixos mais especificos vencem prefixos mais genericos.
 *
 *   - broadcast_*           -> anuncios
 *   - anuncio_*             -> anuncios
 *   - frete_like_*          -> atividades  (mais especifico que frete_)
 *   - frete_*               -> anuncios
 *   - chat_support_*        -> mensagens   (mais especifico que chat_)
 *   - chat_*                -> mensagens   (legacy: 'chat_message')
 *   - message_*, msg_*      -> mensagens
 *   - new_message           -> mensagens   (legacy chat de frete via 023)
 *   - ticket_*              -> tickets
 *   - support_*, suporte_*  -> tickets
 *   - qualquer outro        -> atividades  (fallback: rating_, plan_,
 *                                            system_, etc.)
 */
function categorize(type: string | null | undefined): CategoryKey {
  const t = (type ?? '').toLowerCase();

  // Anuncios
  if (t.startsWith('broadcast_') || t.startsWith('anuncio_')) return 'anuncios';

  // Atividades especificas (devem vir antes do fallback frete_)
  if (t.startsWith('frete_like_')) return 'atividades';

  // Anuncios (fallback frete_)
  if (t.startsWith('frete_')) return 'anuncios';

  // Mensagens (mais especifico antes de chat_)
  if (t.startsWith('chat_support_')) return 'chat';
  if (t.startsWith('chat_') || t.startsWith('message_') || t.startsWith('msg_')) return 'chat';
  if (t === 'new_message') return 'chat';

  // Tickets
  if (t.startsWith('ticket_') || t.startsWith('support_') || t.startsWith('suporte_'))
    return 'tickets';

  return 'atividades';
}

/**
 * Helper export para uso em testes property-based (CP-1).
 */
export const categorizeNotification = categorize;

function timeAgoBR(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s atrás`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${min === 1 ? 'minuto' : 'minutos'} atrás`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h atrás`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ${day === 1 ? 'dia' : 'dias'} atrás`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function NotificationsModal({ open, onClose, userId }: NotificationsModalProps) {
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<CategoryKey>('anuncios');
  const [soundOn, setSoundOn] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(SOUND_KEY) !== '0';
  });

  // Trava scroll do body
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Carrega notificacoes ao abrir
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getNotifications(userId, 50)
      .then(setNotifs)
      .catch(() => setNotifs([]))
      .finally(() => setLoading(false));
  }, [open, userId]);

  // Agrupa por categoria + conta nao lidas
  const grouped = useMemo(() => {
    const acc: Record<CategoryKey, Notification[]> = {
      anuncios: [],
      chat: [],
      tickets: [],
      atividades: [],
    };
    for (const n of notifs) acc[categorize(n.type)].push(n);
    return acc;
  }, [notifs]);

  const unreadCounts = useMemo(() => {
    const counts: Record<CategoryKey, number> = {
      anuncios: 0,
      chat: 0,
      tickets: 0,
      atividades: 0,
    };
    for (const n of notifs) {
      if (!n.readAt) counts[categorize(n.type)]++;
    }
    return counts;
  }, [notifs]);

  // Define categoria inicial: primeira que tem nao lidas, senao 'anuncios'
  useEffect(() => {
    if (!open) return;
    const firstWithUnread = (['anuncios', 'chat', 'tickets', 'atividades'] as CategoryKey[]).find(
      (k) => unreadCounts[k] > 0
    );
    if (firstWithUnread) setActive(firstWithUnread);
  }, [open, unreadCounts]);

  const handleMarkRead = async (n: Notification) => {
    if (n.readAt) return;
    // optimista
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date() } : x)));
    try {
      await markNotificationAsRead(n.id);
      window.dispatchEvent(new Event('fretego-notifications-refresh'));
    } catch {
      /* ignore: rollback nao critico aqui */
    }
  };

  const handleOpenNotification = async (n: Notification) => {
    await handleMarkRead(n);
    if (n.link) {
      onClose();
      navigate(n.link);
    }
  };

  const toggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      return next;
    });
  };

  if (!open) return null;

  const categories: Array<{
    key: CategoryKey;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: 'anuncios', label: 'Anúncios', icon: <IconAnuncio /> },
    { key: 'chat', label: 'Mensagens', icon: <IconChat /> },
    { key: 'tickets', label: 'Tickets', icon: <IconTicket /> },
    { key: 'atividades', label: 'Atividades', icon: <IconActivity /> },
  ];

  const list = grouped[active];

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Card central no desktop, modal compacto em mobile (nao tela cheia) */}
      <div
        className="fixed top-16 left-3 right-3 sm:left-auto sm:w-[560px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[80vh] max-h-[75vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
        style={{
          // Em desktop largo, ancora o modal no mesmo limite direito do conteudo (max-w-2xl = 42rem no md+).
          // O CSS usa max() pra cair em 0.75rem quando a tela eh menor.
          right: 'max(0.75rem, calc((100vw - 42rem) / 2 + 1rem))',
        }}
      >
        {/* Cabecalho */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <BellIcon />
            <h2 className="text-sm font-semibold text-gray-800">Notificações</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body: sidebar + lista */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar de categorias */}
          <nav
            className="w-14 sm:w-16 border-r border-gray-200 bg-gray-50 flex flex-col items-center py-3 gap-1"
            aria-label="Categorias de notificações"
          >
            {categories.map((c) => {
              const isActive = active === c.key;
              const count = unreadCounts[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => setActive(c.key)}
                  title={c.label}
                  aria-label={c.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-100 text-blue-600'
                      : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                  }`}
                >
                  {c.icon}
                  {count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-gray-50">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Toggle sound no rodape do sidebar */}
            <div className="mt-auto pt-2">
              <button
                onClick={toggleSound}
                title={soundOn ? 'Desativar som' : 'Ativar som'}
                aria-label={soundOn ? 'Desativar som' : 'Ativar som'}
                className={`w-10 h-10 flex items-center justify-center rounded-lg ${
                  soundOn ? 'text-gray-600 hover:bg-gray-200' : 'text-gray-400 hover:bg-gray-200'
                }`}
              >
                {soundOn ? <IconSoundOn /> : <IconSoundOff />}
              </button>
            </div>
          </nav>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* Cabecalho contextual com acao por categoria */}
            <CategoryHeader
              active={active}
              onOpenSupport={() => {
                onClose();
                navigate('/suporte/chat');
              }}
              onOpenNewTicket={() => {
                onClose();
                navigate('/tickets/novo');
              }}
            />

            {loading ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-500">
                Carregando...
              </div>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-sm text-gray-500 px-4 text-center">
                <p className="font-medium">Nenhuma notificação aqui</p>
                <p className="text-xs text-gray-400 mt-1">
                  As {categories.find((c) => c.key === active)?.label.toLowerCase()} aparecerão
                  nesta área.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {list.map((n) => (
                  <li
                    key={n.id}
                    className={`px-4 py-3 hover:bg-gray-50 transition-colors ${
                      !n.readAt ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {!n.readAt && (
                        <span
                          className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0"
                          aria-label="Não lida"
                        />
                      )}
                      <button
                        onClick={() => handleOpenNotification(n)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="text-sm font-semibold text-gray-800 line-clamp-2">
                          {n.title}
                        </p>
                        {n.message && (
                          <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.message}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1">
                          {timeAgoBR(new Date(n.createdAt))}
                        </p>
                      </button>
                      {!n.readAt && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkRead(n);
                          }}
                          className="shrink-0 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Marcar como lida"
                          aria-label="Marcar como lida"
                        >
                          <IconEye />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Rodape */}
        <div className="border-t border-gray-200 bg-white">
          <button
            onClick={() => {
              onClose();
              navigate('/notificacoes');
            }}
            className="w-full px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            Ver central de notificações
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CategoryHeader: barra de acao contextual no topo da lista ────────────

function CategoryHeader({
  active,
  onOpenSupport,
  onOpenNewTicket,
}: {
  active: CategoryKey;
  onOpenSupport: () => void;
  onOpenNewTicket: () => void;
}) {
  if (active === 'chat') {
    return (
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
          Mensagens
        </span>
        <button
          type="button"
          onClick={onOpenSupport}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-md"
        >
          <IconSupport />
          Falar com suporte
        </button>
      </div>
    );
  }

  if (active === 'tickets') {
    return (
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
          Tickets
        </span>
        <button
          type="button"
          onClick={onOpenNewTicket}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md"
        >
          <IconPlus />
          Abrir ticket
        </button>
      </div>
    );
  }

  return null;
}

// ─── Icones ──────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

function IconAnuncio() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function IconTicket() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}

function IconEye() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function IconSoundOn() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
      />
    </svg>
  );
}

function IconSoundOff() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
      />
    </svg>
  );
}

function IconSupport() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}
