/**
 * DashboardTopList - card generico com top N items rankeados.
 *
 * Quando items === null (gating server-side), retorna null. Quando vazio,
 * mostra mensagem "Sem dados no período.".
 */

import { Link } from 'react-router-dom';
import type { DashboardTopListItem } from '../../../services/admin/dashboard';
import DashboardBlockError from './DashboardBlockError';

interface Props {
  title: string;
  items: DashboardTopListItem[] | null;
  error?: string;
  onRetry: () => void;
  emptyMessage?: string;
}

export default function DashboardTopList({
  title,
  items,
  error,
  onRetry,
  emptyMessage = 'Sem dados no período.',
}: Props) {
  if (items === null) return null;

  if (error) {
    return <DashboardBlockError message={error} onRetry={onRetry} />;
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <h3 className="text-xs font-semibold text-gray-300 mb-2">{title}</h3>
      {items.length === 0 ? (
        <div role="status" className="text-xs text-gray-500 py-2">
          {emptyMessage}
        </div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it, idx) => (
            <li key={it.id}>
              <Link
                to={it.link}
                className="flex items-start gap-2 px-2 py-1 rounded hover:bg-gray-800/60 transition"
              >
                <span className="text-[10px] text-gray-500 w-5 shrink-0 mt-0.5">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-200 truncate">{it.name}</div>
                  {it.secondary && (
                    <div className="text-[10px] text-gray-500 truncate">{it.secondary}</div>
                  )}
                </div>
                <div className="text-xs text-cyan-300 whitespace-nowrap shrink-0">
                  {it.primaryLabel}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
