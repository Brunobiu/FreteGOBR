/**
 * Mascote oficial do FreteGO — "Fred", o caminhãozinho mensageiro.
 *
 * Um mini-truck azul com olhos sorridentes e bochechinhas. Renderizado
 * 100% em SVG inline pra escalar bem em qualquer tamanho e não ter
 * dependência de assets externos.
 */
interface MascoteProps {
  size?: number;
  className?: string;
  /** Adiciona um leve balanço (animação CSS .mascote-bounce). */
  animated?: boolean;
}

export default function Mascote({ size = 64, className = '', animated = false }: MascoteProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${animated ? 'mascote-bounce' : ''}`}
      role="img"
      aria-label="Fred, o mascote do FreteGO"
    >
      <defs>
        <linearGradient id="mascoteBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="mascoteCabin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      {/* Sombra debaixo */}
      <ellipse cx="60" cy="108" rx="38" ry="4" fill="#0f172a" opacity="0.15" />

      {/* Carroceria (atrás) */}
      <rect x="16" y="50" width="58" height="42" rx="6" fill="url(#mascoteBody)" />
      <rect x="22" y="56" width="46" height="6" rx="2" fill="#dbeafe" opacity="0.85" />
      <rect x="22" y="68" width="20" height="14" rx="2" fill="#1e3a8a" opacity="0.5" />
      <rect x="46" y="68" width="20" height="14" rx="2" fill="#1e3a8a" opacity="0.5" />

      {/* Cabine (frente) com janela */}
      <path d="M74 60 Q78 50 88 50 H100 Q106 50 106 56 V92 H74 Z" fill="url(#mascoteCabin)" />
      <path
        d="M82 60 Q86 56 92 56 H100 V72 H80 Z"
        fill="#bfdbfe"
        opacity="0.92"
      />
      {/* Reflexo da janela */}
      <path d="M83 58 L88 58 L84 71 L81 71 Z" fill="white" opacity="0.45" />

      {/* Olhos sorridentes */}
      <circle cx="89" cy="64" r="2.2" fill="#0f172a" />
      <circle cx="97" cy="64" r="2.2" fill="#0f172a" />
      <circle cx="89.7" cy="63.4" r="0.7" fill="white" />
      <circle cx="97.7" cy="63.4" r="0.7" fill="white" />

      {/* Bochechas */}
      <circle cx="84" cy="69" r="2.5" fill="#fb7185" opacity="0.55" />
      <circle cx="102" cy="69" r="2.5" fill="#fb7185" opacity="0.55" />

      {/* Sorriso */}
      <path
        d="M91 71 Q93 73.5 95 71"
        stroke="#0f172a"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />

      {/* Para-choque */}
      <rect x="70" y="86" width="40" height="6" rx="2" fill="#0f172a" opacity="0.7" />

      {/* Rodas */}
      <circle cx="32" cy="94" r="9" fill="#0f172a" />
      <circle cx="32" cy="94" r="4" fill="#475569" />
      <circle cx="86" cy="94" r="9" fill="#0f172a" />
      <circle cx="86" cy="94" r="4" fill="#475569" />

      {/* Faróis */}
      <circle cx="106" cy="80" r="2" fill="#fef3c7" />
      <circle cx="106" cy="86" r="1.5" fill="#fde68a" opacity="0.7" />

      {/* Antena com bandeirinha */}
      <line x1="20" y1="50" x2="20" y2="36" stroke="#0f172a" strokeWidth="1.5" />
      <path d="M20 36 L30 38 L20 42 Z" fill="#22c55e" />
    </svg>
  );
}
