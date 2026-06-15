import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useState, useRef, useEffect, useCallback } from 'react';
import FreteCalculator from './FreteCalculator';
import { getEmbarcadorProfile } from '../services/embarcador';
import { resolveProfilePhotoUrl } from '../services/documents';
import { capitalizeName } from '../utils/textCase';
import { getTotalUnreadCount } from '../services/chatFrete';
import { getUnreadNotificationCount } from '../services/notifications';
import { NEW_NOTIFICATION_EVENT } from '../hooks/useNotificationsRealtime';
import { useGeolocation } from '../hooks/useGeolocation';
import { useTheme } from '../hooks/useTheme';
import NotificationsModal from './NotificationsModal';
import LocationOverrideModal from './LocationOverrideModal';
import {
  LOCATION_OVERRIDE_EVENT,
  clearLocationOverride,
  readLocationOverride,
  type LocationOverride,
} from '../utils/locationOverride';

export default function AppHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [gpsMenuOpen, setGpsMenuOpen] = useState(false);
  const [locOverrideOpen, setLocOverrideOpen] = useState(false);
  const [locOverride, setLocOverride] = useState<LocationOverride | null>(() =>
    typeof window === 'undefined' ? null : readLocationOverride()
  );
  const [gpsDisabled, setGpsDisabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('fretego-gps-disabled') === '1';
  });
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [temperature, setTemperature] = useState<number | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  const profileLink = user?.userType === 'embarcador' ? '/perfil/embarcador' : '/perfil/motorista';
  const planLink = user?.userType === 'embarcador' ? '/embarcador/plano' : '/motorista/plano';
  const displayName = user?.name ? capitalizeName(user.name) : '';

  // Home do motorista usa o "hero" com degrade (header transparente para o
  // degrade do fundo aparecer atras da barra). Demais telas: fundo neutro.
  const isMotoristaHome = user?.userType === 'motorista' && location.pathname === '/';

  // No topo da home, o header fica transparente (deixa o degrade aparecer).
  // Ao rolar, ganha um fundo solido claro para o texto continuar legivel
  // sobre o feed escuro.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!isMotoristaHome) {
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isMotoristaHome]);

  // Localizacao do usuario
  const geo = useGeolocation();
  const isLocated = geo.status === 'success' && !!geo.point;
  const cityName = isLocated && geo.address ? geo.address.split(',')[0].trim().slice(0, 20) : null;
  const overrideCity = locOverride ? locOverride.label.split(',')[0].trim().slice(0, 20) : null;
  const locationLabel = locOverride
    ? `Manual: ${overrideCity || locOverride.label.slice(0, 20)}`
    : gpsDisabled
      ? 'GPS off'
      : isLocated
        ? `${cityName || 'Localizado'}${temperature != null ? ` · ${Math.round(temperature)}°C` : ''}`
        : geo.status === 'denied' || geo.status === 'error' || geo.status === 'insecure'
          ? 'Erro'
          : 'Sem GPS';

  // Busca temperatura atual via Open-Meteo (free, sem chave)
  useEffect(() => {
    if (!isLocated || !geo.point) {
      setTemperature(null);
      return;
    }
    let cancelled = false;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.point.latitude}&longitude=${geo.point.longitude}&current=temperature_2m&timezone=auto`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const temp = data?.current?.temperature_2m;
        if (typeof temp === 'number') setTemperature(temp);
      })
      .catch(() => {
        if (!cancelled) setTemperature(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isLocated, geo.point?.latitude, geo.point?.longitude]);

  // Solicita localizacao automaticamente quando usuario logado
  // Respeita o toggle gpsDisabled (persistido em localStorage).
  useEffect(() => {
    if (gpsDisabled) {
      // Se foi desativada explicitamente, limpa qualquer localizacao em memoria
      geo.clearLocation();
      return;
    }
    if (isAuthenticated && geo.status === 'idle') {
      geo.requestLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, gpsDisabled]);

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

  // Carrega a URL da foto
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

  // Sincroniza override quando muda em outro componente/aba
  useEffect(() => {
    const sync = () => setLocOverride(readLocationOverride());
    window.addEventListener(LOCATION_OVERRIDE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LOCATION_OVERRIDE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
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
      <header
        className={`sticky top-0 z-40 transition-colors duration-200 ${
          isMotoristaHome ? (scrolled ? 'bg-[#e9edcb] shadow-sm' : 'bg-transparent') : 'bg-gray-100'
        }`}
      >
        <div className="max-w-7xl md:max-w-2xl mx-auto px-3 sm:px-4 lg:px-6">
          <div className="relative flex items-center h-14 sm:h-16 gap-3">
            {/* Esquerda-centro: motorista vê a logo; embarcador vê foto+nome */}
            {isAuthenticated && user ? (
              user.userType === 'motorista' ? (
                /* Motorista: a identidade (foto) foi movida para o slot "Menu"
                   do MotoristaBottomNav. O topo agora exibe a logo do FreteGO. */
                <Link to="/" aria-label="FreteGO" className="flex-1 flex items-center min-w-0">
                  <img
                    src="/logo.png"
                    alt="FreteGO"
                    className="h-9 sm:h-11 w-auto object-contain select-none"
                    draggable={false}
                  />
                </Link>
              ) : (
                <div className="relative flex-1 min-w-0" ref={profileRef}>
                  <button
                    onClick={() => setProfileOpen(!profileOpen)}
                    className="flex items-center gap-2.5 w-full hover:opacity-80 transition-opacity"
                    aria-label="Menu do perfil"
                  >
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-300 flex-shrink-0">
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={displayName}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                          onError={() => setPhotoUrl(null)}
                        />
                      ) : (
                        <svg
                          className="w-5 h-5 text-gray-400"
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
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm sm:text-base text-gray-700 leading-tight truncate">
                        Olá, {displayName.split(' ').slice(0, 2).join(' ')}
                      </p>
                      <p className="text-[11px] sm:text-xs text-gray-600 leading-tight truncate">
                        {companyName || 'Embarcador'}
                      </p>
                    </div>
                  </button>

                  {profileOpen && (
                    <div className="absolute left-0 mt-2 w-52 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50">
                      <Link
                        to={profileLink}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <ProfileIcon />
                        Meu Perfil
                      </Link>
                      <Link
                        to="/tutorial"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <TutorialMenuIcon />
                        Tutorial
                      </Link>
                      <Link
                        to="/configuracoes"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <CogIcon />
                        Configurações
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          toggleTheme();
                        }}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                        {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
                      </button>
                      <Link
                        to={planLink}
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <ShieldIcon />
                        <span className="flex-1">Planos</span>
                      </Link>
                      <div className="border-t border-gray-200 my-1" />
                      <button
                        onClick={handleLogout}
                        className="flex items-center w-full px-4 py-2.5 text-sm text-red-600 hover:bg-gray-100"
                      >
                        <LogoutIcon />
                        Sair
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : (
              <Link to="/" aria-label="FreteGO" className="flex-1 flex items-center">
                <img
                  src="/logo.png"
                  alt="FreteGO"
                  className="h-9 sm:h-11 w-auto object-contain select-none"
                  draggable={false}
                />
              </Link>
            )}

            {/* Direita: localizacao + sino + entrar */}
            <div className="flex items-center gap-2 ml-auto z-10 flex-shrink-0">
              {isAuthenticated && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setGpsMenuOpen((v) => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                    title={
                      gpsDisabled
                        ? 'Localização desativada'
                        : isLocated
                          ? 'GPS ativo'
                          : 'Localização indisponível'
                    }
                    aria-haspopup="menu"
                    aria-expanded={gpsMenuOpen}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        locOverride
                          ? 'bg-blue-500 animate-pulse'
                          : gpsDisabled
                            ? 'bg-gray-400'
                            : isLocated
                              ? 'bg-green-500 animate-pulse'
                              : 'bg-red-500 animate-pulse-slow'
                      }`}
                    />
                    <span
                      className={`text-[11px] font-medium ${
                        locOverride
                          ? 'text-blue-700'
                          : gpsDisabled
                            ? 'text-gray-500'
                            : isLocated
                              ? 'text-green-700'
                              : 'text-red-600'
                      }`}
                    >
                      {locationLabel}
                    </span>
                  </button>

                  {gpsMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setGpsMenuOpen(false)} />
                      <div
                        className="absolute right-0 mt-2 w-60 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50"
                        role="menu"
                      >
                        <div className="px-3 py-2 border-b border-gray-100">
                          <p className="text-[10px] uppercase tracking-wider text-gray-500">
                            Localização
                          </p>
                          <p className="text-xs text-gray-800 font-medium mt-0.5">
                            {locOverride
                              ? `Manual · ${locOverride.label}`
                              : gpsDisabled
                                ? 'Desativada'
                                : isLocated
                                  ? `${cityName || 'Localizado'}${
                                      temperature != null ? ` · ${Math.round(temperature)}°C` : ''
                                    }`
                                  : geo.status === 'denied'
                                    ? 'Bloqueada pelo navegador'
                                    : geo.status === 'insecure'
                                      ? 'Requer HTTPS'
                                      : geo.status === 'loading'
                                        ? 'Localizando...'
                                        : 'Indisponível'}
                          </p>
                        </div>

                        {/* Mudar localizacao manualmente — disponivel sempre */}
                        <button
                          onClick={() => {
                            setGpsMenuOpen(false);
                            setLocOverrideOpen(true);
                          }}
                          className="flex items-center w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-100"
                          role="menuitem"
                        >
                          <svg
                            className="w-4 h-4 mr-2 text-blue-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                            />
                          </svg>
                          {locOverride ? 'Trocar localização manual' : 'Mudar localização'}
                        </button>

                        {locOverride && (
                          <button
                            onClick={() => {
                              clearLocationOverride();
                              setLocOverride(null);
                              setGpsMenuOpen(false);
                            }}
                            className="flex items-center w-full px-3 py-2 text-xs text-blue-700 hover:bg-gray-50 border-b border-gray-100"
                            role="menuitem"
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
                                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                              />
                            </svg>
                            Voltar ao GPS automático
                          </button>
                        )}

                        {gpsDisabled ? (
                          <button
                            onClick={() => {
                              localStorage.removeItem('fretego-gps-disabled');
                              setGpsDisabled(false);
                              setGpsMenuOpen(false);
                            }}
                            className="flex items-center w-full px-3 py-2 text-xs text-green-700 hover:bg-gray-50"
                            role="menuitem"
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
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            Ativar localização
                          </button>
                        ) : (
                          <>
                            {!isLocated && (
                              <button
                                onClick={() => {
                                  setGpsMenuOpen(false);
                                  geo.requestLocation();
                                }}
                                className="flex items-center w-full px-3 py-2 text-xs text-blue-700 hover:bg-gray-50"
                                role="menuitem"
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
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                  />
                                </svg>
                                Tentar novamente
                              </button>
                            )}
                            <button
                              onClick={() => {
                                localStorage.setItem('fretego-gps-disabled', '1');
                                setGpsDisabled(true);
                                setGpsMenuOpen(false);
                              }}
                              className="flex items-center w-full px-3 py-2 text-xs text-red-600 hover:bg-gray-50"
                              role="menuitem"
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
                                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L21 21M5.636 5.636L3 3"
                                />
                              </svg>
                              Desativar localização
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {isAuthenticated && user ? (
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="relative p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                  aria-label="Notificações"
                >
                  <svg
                    className={`w-6 h-6 ${isMotoristaHome ? 'text-black' : 'text-gray-700'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  {notifUnread + chatUnread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-green-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                      {notifUnread + chatUnread > 9 ? '9+' : notifUnread + chatUnread}
                    </span>
                  )}
                </button>
              ) : (
                <Link
                  to="/login"
                  className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                >
                  Entrar
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <FreteCalculator isOpen={calcOpen} onClose={() => setCalcOpen(false)} />

      {drawerOpen && user && (
        <NotificationsModal
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          userId={user.id}
        />
      )}

      <LocationOverrideModal
        open={locOverrideOpen}
        onClose={() => setLocOverrideOpen(false)}
        onSelected={(o) => setLocOverride(o)}
      />
    </>
  );
}

// ─── Drawer lateral ─────────────────────────────────────────────────────────

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

const TutorialMenuIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" strokeWidth={2} />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9l5 3-5 3V9z" />
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
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
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

const MoonIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
    />
  </svg>
);

const SunIcon = () => (
  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
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
