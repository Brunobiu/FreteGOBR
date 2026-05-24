import { useNavigate } from 'react-router-dom';

/**
 * Botão de entrada para o assistente IA. Estilo "pílula branca com
 * borda gradiente animada" (turquesa → azul → roxo). Clica e navega
 * pra `/assistente`.
 */
export default function TripSuggestion() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/assistente?new=1')}
      title="Pergunte à IA do FreteGO"
      className="trip-suggest-btn relative w-full h-full flex items-center justify-center gap-2 px-4 py-2 text-sm sm:text-base font-semibold"
    >
      <span className="truncate">Pergunte à IA</span>
      <SparkleIcon />
    </button>
  );
}

function SparkleIcon() {
  return (
    <svg
      className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 shrink-0"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2l1.6 4.5L18 8l-4.4 1.5L12 14l-1.6-4.5L6 8l4.4-1.5L12 2z" />
      <path d="M19 13l.9 2.4L22 16l-2.1.6L19 19l-.9-2.4L16 16l2.1-.6L19 13z" />
      <path d="M6 14l.7 1.8L8 16l-1.3.5L6 18l-.7-1.5L4 16l1.3-.2L6 14z" />
    </svg>
  );
}
