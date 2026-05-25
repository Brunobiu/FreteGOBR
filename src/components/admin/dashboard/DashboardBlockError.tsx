/**
 * DashboardBlockError - bloco com erro local + botao Tentar novamente.
 */

interface Props {
  message?: string;
  onRetry: () => void;
  className?: string;
}

export default function DashboardBlockError({
  message = 'Dados indisponíveis',
  onRetry,
  className = 'h-32',
}: Props) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-900/40 bg-red-500/10 p-3 flex flex-col items-start justify-center gap-2 ${className}`}
    >
      <div className="text-xs text-red-300">⚠ {message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-200 hover:bg-red-500/30"
      >
        Tentar novamente
      </button>
    </div>
  );
}
