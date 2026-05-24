import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useState, useRef, useEffect } from 'react';
import FreteCalculator from './FreteCalculator';
import NotificationBell from './NotificationBell';
import BadgeEmpresa from './BadgeEmpresa';
import { getEmbarcadorProfile } from '../services/embarcador';
import { resolveProfilePhotoUrl } from '../services/documents';
import { capitalizeName } from '../utils/textCase';
import { getTotalUnreadCount } from '../services/chatFrete';

export default function AppHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const profileLink = user?.userType === 'embarcador' ? '/perfil/embarcador' : '/perfil/motorista';
  const planLink = user?.userType === 'embarcador' ? '/embarcador/plano' : '/motorista/plano';
  const userTypeLabel = user?.userType === 'embarcador' ? 'Embarcador' : 'Motorista';
  const displayName = user?.name ? capitalizeName(user.name) : '';

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

  // Resolve a URL da foto (signed URL se for path privado)
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

  // Fecha menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            {/* Logo + tipo de usuário */}
            <div className="flex items-center space-x-3">
              <Link
                to={user?.userType === 'embarcador' ? '/embarcador' : '/'}
                className="text-2xl font-bold text-blue-500"
              >
                FreteGO
              </Link>
              {isAuthenticated && user && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                  {userTypeLabel}
                </span>
              )}
              {isAuthenticated && user?.userType === 'embarcador' && companyName && (
                <BadgeEmpresa companyName={companyName} />
              )}
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-3">
              {isAuthenticated && user ? (
                <>
                  {/* Notificações */}
                  <NotificationBell />

                  {/* Mensagens */}
                  <ChatHeaderButton />

                  {/* Calculadora - só motorista */}
                  {user.userType === 'motorista' && (
                    <button
                      onClick={() => setCalcOpen(true)}
                      title="Calculadora de Frete"
                      className="p-2 text-gray-500 hover:text-gray-800 transition-colors"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                  )}
                  <div className="relative" ref={menuRef}>
                    {/* Botão do perfil (foto + nome) */}
                    <button
                      onClick={() => setMenuOpen(!menuOpen)}
                      className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
                    >
                      <span className="text-sm text-gray-700 hidden sm:block">{displayName}</span>
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
                        className={`w-4 h-4 text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
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

                    {/* Dropdown menu */}
                    {menuOpen && (
                      <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50">
                        <Link
                          to={profileLink}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                        >
                          <svg
                            className="w-4 h-4 mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                          </svg>
                          Meu Perfil
                        </Link>
                        <Link
                          to="/configuracoes"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                        >
                          <svg
                            className="w-4 h-4 mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          Configurações
                        </Link>
                        <Link
                          to={planLink}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                        >
                          <svg
                            className="w-4 h-4 mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                            />
                          </svg>
                          Planos
                        </Link>
                        <div className="border-t border-gray-200 my-1" />
                        <button
                          onClick={handleLogout}
                          className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-100 hover:text-red-700 transition-colors"
                        >
                          <svg
                            className="w-4 h-4 mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                          </svg>
                          Sair
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    Entrar
                  </Link>
                  <Link
                    to="/register"
                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
    </>
  );
}


/**
 * Botão de mensagens no header. No celular ou na página /mensagens,
 * navega para a página completa. No desktop fora dela, abre o widget
 * flutuante via evento `fretego-toggle-chat`. Mostra badge de não-lidas
 * sincronizado com o widget.
 */
function ChatHeaderButton() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    getTotalUnreadCount(user.id)
      .then(setUnread)
      .catch(() => {});
    const handler = (e: Event) => {
      const ce = e as CustomEvent<number>;
      setUnread(ce.detail ?? 0);
    };
    window.addEventListener('fretego-chat-unread-count', handler);
    return () => window.removeEventListener('fretego-chat-unread-count', handler);
  }, [isAuthenticated, user]);

  const handleClick = () => {
    const isMobile = window.innerWidth < 768;
    const onMensagens = location.pathname === '/mensagens';
    if (isMobile || onMensagens) {
      navigate('/mensagens');
      return;
    }
    window.dispatchEvent(new CustomEvent('fretego-toggle-chat'));
  };

  return (
    <button
      onClick={handleClick}
      title="Mensagens"
      aria-label="Mensagens"
      className="p-2 text-gray-500 hover:text-gray-800 transition-colors relative"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
