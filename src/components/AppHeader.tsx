import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useState, useRef, useEffect, useCallback } from 'react';
import FreteCalculator from './FreteCalculator';
import BadgeEmpresa from './BadgeEmpresa';
import { getEmbarcadorProfile } from '../services/embarcador';
import { resolveProfilePhotoUrl } from '../services/documents';
import { capitalizeName } from '../utils/textCase';
import { getTotalUnreadCount } from '../services/chatFrete';
import { getUnreadNotificationCount } from '../services/notifications';
import { NEW_NOTIFICATION_EVENT } from '../hooks/useNotificationsRealtime';
import {
  getNotifications,
  markNotificationAsRead,
  type Notification,
} from '../services/notifications';

export default function AppHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  const profileLink = user?.userType === 'embarcador' ? '/perfil/embarcador' : '/perfil/motorista';
  const planLink = user?.userType === 'embarcador' ? '/embarcador/plano' : '/motorista/plano';
  const displayName = user?.name ? capitalizeName(user.name) : '';
  const totalUnread = chatUnread + notifUnread;

  // Carrega o nome da empresa quando o usuário é embarcador
  useEffect(() => {
    let cancelled = false;
    if (user?.userType !== 'embarcador') {
      setCompanyName(null);
      return;
    }
    getEmbarcadorProfile(user.id)
      .then((profile) => {
        if (!cancelled)
          setCompanyName(profile?.companyName ? capitalizeName(profile.companyName) : null);
      })
      .catch(() => {
        if (!cancelled) setCompanyName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.userType]);

  // Resolve a URL da foto
  useEffect(() => {
    let cancelled = false;
    if (!user?.profilePhotoUrl) {
      setPhotoUrl(null);
      return;
    }
    resolveProfilePhotoUrl(user.profilePhotoUrl)
      .then((url) => {
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.profilePhotoUrl]);

  // Click outside fecha dropdown do perfil
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Carrega contagens de não-lidas
  const refreshCounts = useCallback(async () => {
    if (!user) return;
    try {
      const [chat, notif] = await Promise.all([
        getTotalUnreadCount(user.id),
        getUnreadNotificationCount(user.id),
      ]);
      setChatUnread(chat);
      setNotifUnread(notif);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    refreshCounts();
  }, [isAuthenticated, user, refreshCounts]);

  // Reage aos eventos globais
  useEffect(() => {
    if (!isAuthenticated) return;
    const handleChat = (e: Event) => {
      const ce = e as CustomEvent<number>;
      if (typeof ce.detail === 'number') setChatUnread(ce.detail);
    };
    const handleNotif = () => {
      setNotifUnread((c) => c + 1);
    };
    const handleRefresh = () => {
      refreshCounts();
    };
    window.addEventListener('fretego-chat-unread-count', handleChat);
    window.addEventListener(NEW_NOTIFICATION_EVENT, handleNotif);
    window.addEventListener('fretego-notifications-refresh', handleRefresh);
    return () => {
      window.removeEventListener('fretego-chat-unread-count', handleChat);
      window.removeEventListener(NEW_NOTIFICATION_EVENT, handleNotif);
      window.removeEventListener('fretego-notifications-refresh', handleRefresh);
    };
  }, [isAuthenticated, refreshCounts]);

  const handleLogout = async () => {
    setProfileOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
          <div className="relative flex items-center h-12 sm:h-14">
            {/* Esquerda: hambúrguer */}
            <div className="flex items-center gap-2 min-w-0 z-10">
              {isAuthenticated && (
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="relative p-1.5 -ml-1 text-gray-600 hover:text-gray-900"
                  aria-label="Abrir menu"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                  {totalUnread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                  )}
                </button>
              )}
              {isAuthenticated && user?.userType === 'embarcador' && companyName && (
                <BadgeEmpresa companyName={companyName} />
              )}
            </div>

            {/* Centro: logo */}
            <Link
              to={user?.userType === 'embarcador' ? '/embarcador' : '/'}
              aria-label="FreteGO"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center"
            >
              <img
                src="/logo.png"
                alt="FreteGO"
                className="h-9 sm:h-11 w-auto object-contain select-none"
                draggable={false}
              />
            </Link>

            {/* Direita: avatar + dropdown */}
            <div className="flex items-center gap-2 ml-auto z-10">
              {isAuthenticated && user ? (
                <div className="relative" ref={profileRef}>
                  <button
                    onClick={() => setProfileOpen(!profileOpen)}
                    className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                    aria-label="Menu do perfil"
                  >
                    <span className="text-sm text-gray-700 hidden md:block max-w-[140px] truncate">
                      {displayName}
                    </span>
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-300">
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt="Foto"
                          className="w-full h-full object-cover"
                          onError={() => setPhotoUrl(null)}
                        />
                      ) : (
                        <svg
                          className="w-4 h-4 text-gray-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-500 transition-transform ${profileOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {profileOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50">
                      <Link
                        to={profileLink}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <ProfileIcon />
                        Meu Perfil
                      </Link>
                      <Link
                        to="/configuracoes"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <CogIcon />
                        Configurações
                      </Link>
                      <Link
                        to={planLink}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <ShieldIcon />
                        Planos
                      </Link>
                      <div className="border-t border-gray-200 my-1" />
                      <button
                        onClick={handleLogout}
                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                      >
                        <LogoutIcon />
                        Sair
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Entrar
                  </Link>
                  <Link
                    to="/register"
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Cadastrar
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <FreteCalculator isOpen={calcOpen} onClose={() => setCalcOpen(false)} />

      {drawerOpen && (
        <SideDrawer
          onClose={() => setDrawerOpen(false)}
          chatUnread={chatUnread}
          notifUnread={notifUnread}
          onOpenCalc={() => {
            setDrawerOpen(false);
            setCalcOpen(true);
          }}
          isMotorista={user?.userType === 'motorista'}
        />
      )}
    </>
  );
}

// ─── Drawer lateral ─────────────────────────────────────────────────────────

interface SideDrawerProps {
  onClose: () => void;
  chatUnread: number;
  notifUnread: number;
  onOpenCalc: () => void;
  isMotorista: boolean;
}

function SideDrawer({ onClose, chatUnread, notifUnread, onOpenCalc, isMotorista }: SideDrawerProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<'menu' | 'notif'>('menu');
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  // Trava o scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Carrega notificações ao abrir a aba
  useEffect(() => {
    if (tab !== 'notif' || !user) return;
    setLoadingNotifs(true);
    getNotifications(user.id, 20)
      .then(setNotifs)
      .catch(() => {})
      .finally(() => setLoadingNotifs(false));
  }, [tab, user]);

  const handleChat = () => {
    onClose();
    const isMobile = window.innerWidth < 768;
    const onMensagens = location.pathname === '/mensagens';
    if (isMobile || onMensagens) {
      navigate('/mensagens');
      return;
    }
    window.dispatchEvent(new CustomEvent('fretego-toggle-chat'));
  };

  const handleNotifClick = async (n: Notification) => {
    if (!n.readAt) {
      try {
        await markNotificationAsRead(n.id);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event('fretego-notifications-refresh'));
    }
    onClose();
    if (n.link) navigate(n.link);
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <aside className="fixed top-0 left-0 h-full w-[85%] max-w-sm bg-white shadow-2xl flex flex-col animate-slide-in-left">
        {/* Topo */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <img src="/logo.png" alt="FreteGO" className="h-8 w-auto object-contain" />
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700"
            aria-label="Fechar menu"
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

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('menu')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === 'menu'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Atalhos
          </button>
          <button
            onClick={() => setTab('notif')}
            className={`flex-1 py-2 text-sm font-medium transition-colors relative ${
              tab === 'notif'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Notificações
            {notifUnread > 0 && (
              <span className="absolute top-1 right-2 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {notifUnread > 9 ? '9+' : notifUnread}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'menu' ? (
            <div className="py-2">
              <DrawerItem
                icon={<MsgIcon />}
                label="Mensagens"
                badge={chatUnread}
                onClick={handleChat}
              />
              <DrawerItem
                icon={<BellIcon />}
                label="Notificações"
                badge={notifUnread}
                onClick={() => setTab('notif')}
              />
              {isMotorista && (
                <DrawerItem
                  icon={<CalcIcon />}
                  label="Calculadora de frete"
                  onClick={onOpenCalc}
                />
              )}
            </div>
          ) : (
            <div>
              {loadingNotifs ? (
                <p className="text-center text-sm text-gray-500 py-8">Carregando...</p>
              ) : notifs.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-8">Nenhuma notificação.</p>
              ) : (
                notifs.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNotifClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                      !n.readAt ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <span className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{n.title}</p>
                        <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {new Date(n.createdAt).toLocaleString('pt-BR', {
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
                  onClose();
                  navigate('/notificacoes');
                }}
                className="w-full px-4 py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-blue-50 border-t border-gray-200"
              >
                Ver todas as notificações →
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerItem({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <span className="text-gray-500 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {!!badge && badge > 0 && (
        <span className="min-w-[18px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ─── Ícones ─────────────────────────────────────────────────────────────────

const MsgIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);

const BellIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
    />
  </svg>
);

const CalcIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
    />
  </svg>
);

const ProfileIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

const CogIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
    />
  </svg>
);
