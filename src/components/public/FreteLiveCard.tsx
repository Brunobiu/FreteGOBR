/**
 * FreteLiveCard — card de um frete na vitrine pública "tempo real" (rota,
 * carga/veículo, há quanto tempo foi postado). SEM valor (segue a regra do
 * feed, que esconde o valor de quem não está logado). Usado na seção da
 * landing (carrossel) e na página dedicada (grade) — por isso o `h-full`,
 * pra ficar com altura uniforme nos dois layouts.
 */

import type { PublicFrete } from '../../services/publicFretes';

function Clock({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** "agora mesmo" / "há 12 min" / "há 3 h" / "há 2 dias". */
function formatRelative(date: Date): string {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

export default function FreteLiveCard({ frete }: { frete: PublicFrete }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-gray-900">
          {frete.origin} <span className="text-gray-400">→</span> {frete.destination}
        </p>
        {frete.source === 'comunidade' && (
          <span className="shrink-0 rounded-full bg-brand-green/10 px-2 py-0.5 text-[10px] font-semibold text-brand-green">
            Comunidade
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs text-gray-600">
        {frete.product || frete.cargoType}
        {frete.vehicleType ? ` · ${frete.vehicleType}` : ''}
      </p>
      <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400">
        <Clock className="h-3 w-3" />
        {formatRelative(frete.createdAt)}
      </p>
    </div>
  );
}
