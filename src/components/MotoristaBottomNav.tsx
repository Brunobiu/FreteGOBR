/**
 * MotoristaBottomNav - barra de navegacao inferior fixa para motorista.
 *
 * Layout visual conforme spec:
 *  - 4 itens (Inicio, Negociar, Chat com badge, Menu)
 *  - Botao central circular verde flutuante (megafone) sobrepondo a barra
 *  - Fixo no rodape, nao some no scroll
 *
 * Navegacao:
 *  - "Início" sempre volta para a home (`/`). Se ja estiver na home, apenas
 *    rola a pagina de volta ao topo.
 */

import { useNavigate, useLocation } from 'react-router-dom';

interface Props {
  /** Quantidade de mensagens nao lidas no chat (badge). Default 0. */
  chatBadge?: number;
}

export default function MotoristaBottomNav({ chatBadge = 0 }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const goHome = () => {
    if (location.pathname === '/') {
      // Ja na home: garante o retorno ao topo.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate('/');
    }
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
      aria-label="Navegação inferior"
    >
      <div className="relative max-w-md mx-auto h-16 grid grid-cols-4 items-center px-2">
        {/* 1 - Inicio (esquerda) */}
        <button
          type="button"
          onClick={goHome}
          className="flex flex-col items-center justify-center gap-0.5 py-1 text-green-600"
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
          <span className="text-[10px] font-bold">Início</span>
        </button>

        {/* 2 - Negociar */}
        <button
          type="button"
          className="flex flex-col items-center justify-center gap-0.5 py-1 text-gray-600"
          aria-label="Negociar"
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
          <span className="text-[10px] font-medium">Negociar</span>
        </button>

        {/* 3 - Chat (com badge) */}
        <button
          type="button"
          className="flex flex-col items-center justify-center gap-0.5 py-1 text-gray-600"
          aria-label="Chat"
        >
          <span className="relative">
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
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
            {chatBadge > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-green-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                {chatBadge > 9 ? '9+' : chatBadge}
              </span>
            )}
          </span>
          <span className="text-[10px] font-medium">Chat</span>
        </button>

        {/* 4 - Menu */}
        <button
          type="button"
          className="flex flex-col items-center justify-center gap-0.5 py-1 text-gray-600"
          aria-label="Menu"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-[10px] font-medium">Menu</span>
        </button>

        {/* Botao central flutuante (megafone) */}
        <button
          type="button"
          aria-label="Anunciar"
          className="absolute left-1/2 -translate-x-1/2 -top-7 z-50 w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 active:scale-95 transition-all shadow-lg shadow-green-500/40 flex items-center justify-center border-4 border-white"
        >
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
            />
          </svg>
        </button>
      </div>
    </nav>
  );
}
