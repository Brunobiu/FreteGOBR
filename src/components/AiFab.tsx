/**
 * AiFab — Botão flutuante (FAB) de acesso ao assistente IA.
 *
 * Visual: círculo amarelo com estrela de 4 pontas azul no centro.
 * Borda azul brilhante girando continuamente ao redor do botão.
 * Posicionado no canto inferior direito, acima da MotoristaBottomNav.
 */

import { useNavigate } from 'react-router-dom';

export default function AiFab() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate('/assistente?new=1')}
      title="Pergunte à IA"
      aria-label="Pergunte à IA"
      className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform"
    >
      {/* Anel giratório azul */}
      <span className="absolute inset-0 rounded-full animate-[spin_3s_linear_infinite]">
        <svg className="w-full h-full" viewBox="0 0 56 56" fill="none">
          <circle
            cx="28"
            cy="28"
            r="26"
            stroke="url(#ai-fab-gradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="40 120"
          />
          <defs>
            <linearGradient id="ai-fab-gradient" x1="0" y1="0" x2="56" y2="56">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </span>

      {/* Círculo amarelo */}
      <span className="relative w-12 h-12 rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/40 flex items-center justify-center">
        {/* Estrela de 4 pontas (sparkle) azul */}
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
          {/* Estrela grande */}
          <path d="M12 2l1.8 6.2L20 12l-6.2 1.8L12 22l-1.8-6.2L4 12l6.2-1.8L12 2z" fill="#1e3a8a" />
          {/* Estrela pequena (canto superior direito) */}
          <path
            d="M18.5 3l0.6 2.1L21.2 5.7l-2.1 0.6L18.5 8.4l-0.6-2.1L15.8 5.7l2.1-0.6L18.5 3z"
            fill="#1e3a8a"
            opacity="0.7"
          />
        </svg>
      </span>
    </button>
  );
}
