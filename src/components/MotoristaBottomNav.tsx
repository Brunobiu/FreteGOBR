/**
 * MotoristaBottomNav - barra de navegacao inferior fixa para motorista.
 *
 * Layout visual:
 *  - 4 itens (Inicio, Mapa, Tabela ANTT, Menu)
 *  - Fixo no rodape
 *  - Auto-hide: desce (some) ao rolar a pagina para baixo e reaparece
 *    ao rolar para cima ou ao chegar no topo. Da mais area de tela para
 *    o conteudo enquanto o usuario explora a lista.
 *
 * O slot 4 ("Menu") navega para `/motorista/menu` — uma pagina dedicada
 * com tiles em grid (Perfil, Veiculo, Referencias, Contrato, Tema,
 * Configuracoes, Planos) e botao Sair em destaque no rodape.
 *
 * O botao central flutuante (megafone) foi removido — nao tinha
 * funcionalidade ainda atribuida e poluia visualmente.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMotoristaCompletude } from '../hooks/useMotoristaCompletude';

export default function MotoristaBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { groups } = useMotoristaCompletude();

  // ─── Auto-hide ao rolar ──────────────────────────────────────────────
  // Esconde a barra quando o usuario rola para baixo (para ver mais
  // conteudo) e mostra de volta quando rola para cima ou chega no topo.
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    // Limiar para evitar tremedeira em micro-rolagens.
    const THRESHOLD = 8;
    lastScrollY.current = window.scrollY;

    const onScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;

      if (Math.abs(delta) < THRESHOLD) return;

      // Perto do topo: sempre visivel.
      if (currentY < 64) {
        setHidden(false);
      } else if (delta > 0) {
        // Rolando para baixo → esconde.
        setHidden(true);
      } else {
        // Rolando para cima → mostra.
        setHidden(false);
      }

      lastScrollY.current = currentY;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // So mostra alerta no botao Menu se for motorista logado e algum
  // grupo estiver incompleto.
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
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] transition-transform duration-300 ease-in-out ${
        hidden ? 'translate-y-full' : 'translate-y-0'
      }`}
      aria-label="Navegação inferior"
    >
      <div className="relative max-w-md mx-auto h-16 grid grid-cols-4 items-center px-2">
        {/* 1 - Inicio */}
        <button
          type="button"
          onClick={goHome}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
            isHomeActive ? 'text-green-600' : 'text-gray-600'
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
            isMapaActive ? 'text-green-600' : 'text-gray-600'
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
          <span className={`text-[10px] ${isMapaActive ? 'font-bold' : 'font-medium'}`}>Mapa</span>
        </button>

        {/* 3 - Tabela ANTT */}
        <button
          type="button"
          className={`flex flex-col items-center justify-center gap-0.5 py-1 ${
            isTabelaActive ? 'text-green-600' : 'text-gray-600'
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

        {/* 4 - Menu (rota /motorista/menu) */}
        <button
          type="button"
          onClick={goMenu}
          className={`relative flex flex-col items-center justify-center gap-0.5 py-1 ${
            isMenuActive ? 'text-green-600' : 'text-gray-600'
          }`}
          aria-label={hasIncomplete ? 'Menu - dados pendentes' : 'Menu'}
        >
          <span className="relative">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {hasIncomplete && (
              <span
                className="absolute -top-1 -right-1.5 w-2.5 h-2.5 rounded-full bg-orange-500 border border-white"
                aria-hidden="true"
              />
            )}
          </span>
          <span className={`text-[10px] ${isMenuActive ? 'font-bold' : 'font-medium'}`}>Menu</span>
        </button>
      </div>
    </nav>
  );
}
