/**
 * FreteClicksBlock - lista de motoristas que clicaram, paginada 10/página.
 */

import { Link } from 'react-router-dom';
import type { FreteClickRow } from '../../../services/admin/fretes';

interface Props {
  clicks: FreteClickRow[];
  total: number;
  page: number;
  pageSize: number;
  canViewUser: boolean;
  onPageChange: (page: number) => void;
  error?: string;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

export default function FreteClicksBlock({
  clicks,
  total,
  page,
  pageSize,
  canViewUser,
  onPageChange,
  error,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Motoristas que clicaram ({total})
      </h3>
      {error && <div className="text-xs text-red-400 mb-2">Falha ao carregar cliques.</div>}
      {clicks.length === 0 && !error && (
        <div className="text-xs text-gray-500">Nenhum motorista clicou neste frete ainda.</div>
      )}
      <ul className="space-y-2 text-sm">
        {clicks.map((c) => (
          <li
            key={c.click_id}
            className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/40 last:border-0"
          >
            <div className="min-w-0">
              <div className="text-gray-200 truncate">{c.motorista_name}</div>
              <div className="text-xs text-gray-500">
                {c.motorista_phone} · {fmtDateTime(c.clicked_at)}
              </div>
            </div>
            {canViewUser && (
              <Link
                to={`/admin/users/${c.motorista_id}`}
                className="text-xs text-cyan-400 hover:text-cyan-300 shrink-0"
              >
                Ver perfil
              </Link>
            )}
          </li>
        ))}
      </ul>
      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
          <span>
            Pagina {page} de {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
