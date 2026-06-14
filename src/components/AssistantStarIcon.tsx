/**
 * AssistantStarIcon — Versão ampliada do AiFab com animação de pulso e
 * brilho externo púrpura/azul. Usado na tela inicial do assistente.
 */

interface AssistantStarIconProps {
  size?: number;
  className?: string;
}

export default function AssistantStarIcon({ size = 96, className = '' }: AssistantStarIconProps) {
  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Glow externo púrpura/azul animado */}
      <span
        className="absolute inset-0 rounded-full animate-pulse"
        style={{
          background:
            'radial-gradient(circle, rgba(147,51,234,0.3) 0%, rgba(59,130,246,0.15) 50%, transparent 70%)',
          filter: 'blur(12px)',
        }}
      />

      {/* Anel giratório azul */}
      <span className="absolute inset-0 rounded-full animate-[spin_4s_linear_infinite]">
        <svg className="w-full h-full" viewBox="0 0 96 96" fill="none">
          <circle
            cx="48"
            cy="48"
            r="44"
            stroke="url(#star-icon-gradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="60 200"
          />
          <defs>
            <linearGradient id="star-icon-gradient" x1="0" y1="0" x2="96" y2="96">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </span>

      {/* Círculo amarelo com estrela */}
      <span
        className="relative rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/40 flex items-center justify-center animate-[pulse_3s_ease-in-out_infinite]"
        style={{ width: size * 0.75, height: size * 0.75 }}
      >
        <svg
          className="text-blue-900"
          style={{ width: size * 0.38, height: size * 0.38 }}
          viewBox="0 0 24 24"
          fill="none"
        >
          {/* Estrela grande de 4 pontas */}
          <path
            d="M12 2l1.8 6.2L20 12l-6.2 1.8L12 22l-1.8-6.2L4 12l6.2-1.8L12 2z"
            fill="currentColor"
          />
          {/* Estrela pequena (canto superior direito) */}
          <path
            d="M18.5 3l0.6 2.1L21.2 5.7l-2.1 0.6L18.5 8.4l-0.6-2.1L15.8 5.7l2.1-0.6L18.5 3z"
            fill="currentColor"
            opacity="0.6"
          />
        </svg>
      </span>
    </div>
  );
}
