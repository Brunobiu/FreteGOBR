/**
 * MotoristaBottomNav - barra de navegacao inferior FLUTUANTE para motorista.
 *
 * Layout visual:
 *  - 5 itens: Inicio, Mapa, Marketplace (placeholder), Tabela ANTT, Menu
 *  - Barra flutuante com bordas arredondadas (estilo "pill"), descolada do
 *    rodape (margens laterais + inferior).
 *  - Auto-hide: desce (some) ao rolar a pagina para baixo e reaparece ao
 *    rolar para cima ou ao chegar no topo.
 *  - O slot "Menu" exibe a FOTO do motorista (em vez de icone) com as tres
 *    barrinhas sobrepostas no canto, espelhando o padrao de redes sociais.
 *  - "Marketplace" ainda nao tem tela: mostra um aviso "Em breve" e nao navega.
 *
 * O slot "Menu" navega para `/motorista/menu`.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMotoristaCompletude } from '../hooks/useMotoristaCompletude';
import { resolveProfilePhotoUrl } from '../services/documents';

export default function MotoristaBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { groups } = useMotoristaCompletude();

  // ─── Auto-hide ao rolar ──────────────────────────────────────────────
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const THRESHOLD = 8;
    lastScrollY.current = window.scrollY;

    const onScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;
      if (Math.abs(delta) < THRESHOLD) return;
      if (currentY < 64) {
        setHidden(false);
      } else if (delta > 0) {
        setHidden(true);
      } else {
        setHidden(false);
      }
      lastScrollY.current = currentY;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ─── Foto do motorista (exibida no slot Menu) ─────────────────────────
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
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

  // ─── Aviso "Em breve" do Marketplace ──────────────────────────────────
  const [marketSoon, setMarketSoon] = useState(false);
  useEffect(() => {
    if (!marketSoon) return;
    const t = setTimeout(() => setMarketSoon(false), 2500);
    return () => clearTimeout(t);
  }, [marketSoon]);

  const hasIncomplete =
    user?.userType === 'motorista' &&
    (groups.perfil ||
      groups.tracao ||
      groups.carroceria ||
      groups.complemento ||
      groups.referencias);

  const goHome = () => {
    if (location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate('/');
    }
  };

  const goMapa = () => navigate('/motorista/mapa');
  const goMenu = () => navigate('/motorista/menu');

  const isHomeActive = location.pathname === '/';
  const isMapaActive = location.pathname === '/motorista/mapa';
  const isTabelaActive = location.pathname === '/motorista/tabela-antt';
  const isMenuActive =
    location.pathname.startsWith('/motorista/menu') ||
    location.pathname.startsWith('/motorista/perfil') ||
    location.pathname.startsWith('/motorista/veiculo') ||
    location.pathname.startsWith('/motorista/tracao') ||
    location.pathname.startsWith('/motorista/carroceria') ||
    location.pathname.startsWith('/motorista/complemento') ||
    location.pathname.startsWith('/motorista/referencias') ||
    location.pathname.startsWith('/motorista/contrato');

  return (
    <>
      {/* Aviso flutuante "Em breve" do Marketplace */}
      {marketSoon && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-3 py-2 rounded-full shadow-lg"
          role="status"
        >
          Marketplace em breve
        </div>
      )}

      <nav
        className={`fixed bottom-3 left-3 right-3 z-40 transition-transform duration-300 ease-in-out ${
          hidden ? 'translate-y-[150%]' : 'translate-y-0'
        }`}
        aria-label="Navegação inferior"
      >
        <div className="relative max-w-md mx-auto h-16 grid grid-cols-5 items-center px-1 bg-gray-900 rounded-3xl border border-gray-700 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
          {/* 1 - Inicio */}
          <button
            type="button"
            onClick={goHome}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
              isHomeActive ? 'text-green-400' : 'text-gray-300'
            }`}
            aria-label="Início"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            <span className={`text-[10px] ${isHomeActive ? 'font-bold' : 'font-medium'}`}>
              Início
            </span>
          </button>

          {/* 2 - Mapa */}
          <button
            type="button"
            onClick={goMapa}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
              isMapaActive ? 'text-green-400' : 'text-gray-300'
            }`}
            aria-label="Mapa"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className={`text-[10px] ${isMapaActive ? 'font-bold' : 'font-medium'}`}>
              Mapa
            </span>
          </button>

          {/* 3 - Tabela ANTT */}
          <button
            type="button"
            className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
              isTabelaActive ? 'text-green-400' : 'text-gray-300'
            }`}
            aria-label="Tabela ANTT"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 10h18M3 6h18M3 14h18M3 18h18M9 6v12M15 6v12"
              />
            </svg>
            <span className={`text-[10px] ${isTabelaActive ? 'font-bold' : 'font-medium'}`}>
              Tabela ANTT
            </span>
          </button>

          {/* 4 - Marketplace (placeholder, sem tela ainda) */}
          <button
            type="button"
            onClick={() => setMarketSoon(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1 text-gray-300"
            aria-label="Marketplace (em breve)"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span className="text-[10px] font-medium">Marketplace</span>
          </button>

          {/* 5 - Menu (foto do motorista + 3 barrinhas sobrepostas) */}
          <button
            type="button"
            onClick={goMenu}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
              isMenuActive ? 'text-green-400' : 'text-gray-300'
            }`}
            aria-label={hasIncomplete ? 'Menu - dados pendentes' : 'Menu'}
          >
            <span className="relative">
              {/* Avatar do motorista */}
              <span
                className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center bg-gray-800 border ${
                  isMenuActive ? 'border-green-500' : 'border-gray-600'
                }`}
              >
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Menu"
                    className="w-full h-full object-cover"
                    onError={() => setPhotoUrl(null)}
                  />
                ) : (
                  <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </span>
              {/* 3 barrinhas sobrepostas no canto inferior direito */}
              <span className="absolute -bottom-0.5 -right-1 w-3.5 h-3.5 rounded-full bg-gray-900 border border-gray-600 flex items-center justify-center">
                <svg
                  className="w-2.5 h-2.5 text-gray-200"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </span>
              {hasIncomplete && (
                <span
                  className="absolute -top-1 -right-1.5 w-2.5 h-2.5 rounded-full bg-orange-500 border border-gray-900"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className={`text-[10px] ${isMenuActive ? 'font-bold' : 'font-medium'}`}>
              Menu
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
