/**
 * Avatar do assistente "Pergunte à IA": carinha sorridente branca dentro
 * de um anel circular com gradiente azul → magenta → rosa. Renderizado
 * 100% em SVG inline pra escalar bem em qualquer tamanho.
 */
interface AskAiAvatarProps {
  size?: number;
  className?: string;
}

export default function AskAiAvatar({ size = 28, className = '' }: AskAiAvatarProps) {
  const id = 'ai-avatar-grad';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Pergunte à IA"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      {/* Anel gradiente */}
      <circle cx="16" cy="16" r="14" fill={`url(#${id})`} />
      {/* Bolha branca interna */}
      <circle cx="16" cy="16" r="11" fill="#0f172a" />
      <circle cx="16" cy="16" r="10" fill="white" />
      {/* Olhos */}
      <circle cx="12" cy="14.5" r="1.4" fill="#0f172a" />
      <circle cx="20" cy="14.5" r="1.4" fill="#0f172a" />
      {/* Sorriso */}
      <path
        d="M11.5 18.5 Q16 22 20.5 18.5"
        stroke="#0f172a"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
