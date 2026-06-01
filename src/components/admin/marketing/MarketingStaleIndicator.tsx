/**
 * MarketingStaleIndicator - aviso de dados defasados (cache fallback).
 *
 * Renderizado quando `getMetrics` retorna `stale === true` (Meta indisponivel
 * em uma atualizacao, porem havia snapshot em cache — Req 7.4). Comunica a
 * idade dos dados a partir de `fetched_at` em formato pt-BR (ex.: "Dados de
 * 5 min atras"), para que o admin saiba que esta vendo o ultimo snapshot
 * disponivel e nao metricas em tempo real (Req 7.5).
 *
 * Quando `stale` e falso, o componente nao renderiza nada (retorna null), de
 * modo que a Marketing_Metrics_Page possa monta-lo incondicionalmente.
 *
 * `now` e injetavel para testabilidade (default: instante atual).
 *
 * _Requirements: 7.4, 7.5_
 */

interface Props {
  /** Indicador de dados defasados vindo de MetricsResult.stale. */
  stale: boolean;
  /** Timestamp ISO do snapshot (MetricsResult.fetched_at). */
  fetchedAt: string;
  /** Instante de referencia para calcular a idade. Default: agora. */
  now?: Date;
  className?: string;
}

/**
 * Formata a idade de `fetchedAt` em relacao a `now` em pt-BR.
 * Ex.: "agora há pouco", "5 min atrás", "2 h atrás", "3 dias atrás".
 * Retorna `null` quando o ISO e invalido ou esta no futuro de forma absurda.
 */
function formatDataAge(fetchedAt: string, now: Date): string {
  const d = new Date(fetchedAt);
  if (Number.isNaN(d.getTime())) return 'Dados desatualizados';

  const diffMs = now.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60000);

  if (min < 1) return 'Dados de agora há pouco';
  if (min < 60) return `Dados de ${min} min atrás`;

  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `Dados de ${hrs} h atrás`;

  const days = Math.floor(hrs / 24);
  return `Dados de ${days} ${days === 1 ? 'dia' : 'dias'} atrás`;
}

export default function MarketingStaleIndicator({
  stale,
  fetchedAt,
  now = new Date(),
  className = '',
}: Props) {
  if (!stale) return null;

  const age = formatDataAge(fetchedAt, now);

  return (
    <div
      role="status"
      className={`rounded-md border border-amber-900/40 bg-amber-500/10 px-3 py-2 flex items-center gap-2 text-xs text-amber-300 ${className}`}
    >
      {/* Icone relogio (SVG inline) */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>{age} (sem conexão com a Meta no momento).</span>
    </div>
  );
}
