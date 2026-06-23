/**
 * AssistantRobot — Mascote robô do Assistente IA (substitui o antigo
 * AssistantStarIcon amarelo).
 *
 * Desenhado 100% em SVG inline (sem libs, seguindo a convenção do projeto).
 * Animações sutis via CSS keyframes (definidas em src/index.css):
 *   - corpo flutua de leve (sobe/desce)
 *   - cabeça olha de um lado para o outro
 *   - olhos mexem na horizontal e piscam de vez em quando
 *   - braço esquerdo acena de tempos em tempos
 *   - braço direito balança suave
 *   - halo roxo pulsa
 *
 * Mascote decorativo: anima sempre (não desliga com "reduzir movimento").
 *
 * Mantém a mesma interface do AssistantStarIcon (size, className) para
 * ser um drop-in replacement.
 */

import { useId } from 'react';

interface AssistantRobotProps {
  /** Largura em px. A altura acompanha a proporção (~1.125x). Default 150. */
  size?: number;
  className?: string;
}

export default function AssistantRobot({ size = 150, className = '' }: AssistantRobotProps) {
  // IDs únicos por instância (evita colisão de gradientes/filtros se
  // o componente for montado mais de uma vez na mesma página).
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `airobot-${name}-${uid}`;

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size * 1.125 }}
    >
      {/* Brilho ambiente roxo/azul atrás do robô */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: size * 0.8,
          height: size * 0.8,
          background:
            'radial-gradient(circle, rgba(168,85,247,0.35) 0%, rgba(99,102,241,0.18) 50%, transparent 72%)',
          filter: 'blur(14px)',
        }}
      />

      <svg
        className="ai-robot-float relative"
        width="100%"
        height="100%"
        viewBox="0 0 160 180"
        fill="none"
        role="img"
        aria-label="Assistente robô"
      >
        <defs>
          <radialGradient id={id('head')} cx="38%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#eef3f9" />
            <stop offset="100%" stopColor="#d2dde9" />
          </radialGradient>
          <linearGradient id={id('body')} x1="0" y1="86" x2="0" y2="158" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#cdd9e8" />
          </linearGradient>
          <linearGradient id={id('arm')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#d2dde9" />
          </linearGradient>
          <linearGradient id={id('ear')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eef2f8" />
            <stop offset="100%" stopColor="#ccd6e3" />
          </linearGradient>
          <linearGradient id={id('screen')} x1="0" y1="39" x2="0" y2="73" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#131c33" />
            <stop offset="100%" stopColor="#0a0f1f" />
          </linearGradient>
          <linearGradient id={id('eye')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfe0ff" />
            <stop offset="100%" stopColor="#4f96f5" />
          </linearGradient>
          <linearGradient
            id={id('halo')}
            x1="36"
            y1="16"
            x2="124"
            y2="100"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <filter id={id('haloBlur')} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id={id('eyeGlow')} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Halo roxo atrás da cabeça */}
        <g className="ai-robot-halo">
          <circle
            cx="80"
            cy="58"
            r="45"
            fill="none"
            stroke={`url(#${id('halo')})`}
            strokeWidth="5"
            opacity="0.85"
            filter={`url(#${id('haloBlur')})`}
          />
          <circle
            cx="80"
            cy="58"
            r="45"
            fill="none"
            stroke={`url(#${id('halo')})`}
            strokeWidth="2.5"
          />
        </g>

        {/* Cabeça (gira de leve olhando pros lados) */}
        <g className="ai-robot-head">
          {/* Orelhas / fones laterais */}
          <rect
            x="42"
            y="46"
            width="11"
            height="22"
            rx="5.5"
            fill={`url(#${id('ear')})`}
            stroke="#c5d2e4"
            strokeWidth="1"
          />
          <circle cx="47.5" cy="57" r="3" fill="#aab8cc" />
          <rect
            x="107"
            y="46"
            width="11"
            height="22"
            rx="5.5"
            fill={`url(#${id('ear')})`}
            stroke="#c5d2e4"
            strokeWidth="1"
          />
          <circle cx="112.5" cy="57" r="3" fill="#aab8cc" />

          {/* Crânio */}
          <circle
            cx="80"
            cy="56"
            r="32"
            fill={`url(#${id('head')})`}
            stroke="#c5d2e4"
            strokeWidth="1.5"
          />

          {/* Tela do rosto */}
          <rect
            x="58"
            y="39"
            width="44"
            height="34"
            rx="16"
            fill={`url(#${id('screen')})`}
            stroke="#16203a"
            strokeWidth="1"
          />
          {/* Reflexo suave na tela */}
          <ellipse cx="72" cy="48" rx="14" ry="6" fill="#ffffff" opacity="0.06" />

          {/* Olhos (mexem e piscam) */}
          <g className="ai-robot-eyes" filter={`url(#${id('eyeGlow')})`}>
            <path d="M67 53 Q73 62 79 53 Q73 55 67 53 Z" fill={`url(#${id('eye')})`} />
            <path d="M81 53 Q87 62 93 53 Q87 55 81 53 Z" fill={`url(#${id('eye')})`} />
          </g>
        </g>

        {/* Pescoço (conecta cabeça e corpo) */}
        <rect x="72" y="80" width="16" height="14" rx="6" fill="#d4deea" />

        {/* Corpo em formato de ovo */}
        <path
          d="M62 92 C54 100 47 114 49 128 C51 146 65 158 80 158 C95 158 109 146 111 128 C113 114 106 100 98 92 C92 86 68 86 62 92 Z"
          fill={`url(#${id('body')})`}
          stroke="#c5d2e4"
          strokeWidth="1.5"
        />
        {/* Costuras dos painéis */}
        <path d="M80 94 L80 154" stroke="#c2cee0" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
        <path
          d="M55 122 Q80 132 105 122"
          fill="none"
          stroke="#c2cee0"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.65"
        />

        {/* Braço esquerdo — levantado, acena de vez em quando */}
        <g className="ai-robot-arm-l">
          <rect
            x="33"
            y="66"
            width="14"
            height="40"
            rx="7"
            fill={`url(#${id('arm')})`}
            stroke="#c5d2e4"
            strokeWidth="1.2"
          />
        </g>

        {/* Braço direito — para baixo, balança suave */}
        <g className="ai-robot-arm-r">
          <rect
            x="110"
            y="96"
            width="13"
            height="38"
            rx="6.5"
            fill={`url(#${id('arm')})`}
            stroke="#c5d2e4"
            strokeWidth="1.2"
          />
        </g>
      </svg>
    </div>
  );
}
