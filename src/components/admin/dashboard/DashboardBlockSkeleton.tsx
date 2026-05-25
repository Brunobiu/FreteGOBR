/**
 * DashboardBlockSkeleton - placeholder cinza animado para loading de blocos.
 */

interface Props {
  /** Altura tailwind (h-32 default). */
  className?: string;
}

export default function DashboardBlockSkeleton({ className = 'h-32' }: Props) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`rounded-lg border border-gray-800 bg-gray-900/40 ${className} animate-pulse`}
    >
      <span className="sr-only">Carregando...</span>
    </div>
  );
}
