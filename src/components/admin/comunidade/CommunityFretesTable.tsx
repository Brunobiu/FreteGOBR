/**
 * CommunityFretesTable — lista paginada de fretes comunidade publicados.
 * Desktop = tabela; mobile (<768px) = cards single-column. Paginação 10/50/100.
 * spec frete-comunidade (Fase 5 / Req 3.x).
 */

import type { CommunityFreteRow } from '../../../services/admin/comunidade';

interface Props {
  rows: CommunityFreteRow[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  onPageChange: (offset: number) => void;
  onLimitChange: (limit: number) => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export default function CommunityFretesTable({
  rows,
  total,
  limit,
  offset,
  loading,
  onPageChange,
  onLimitChange,
}: Props) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Fretes publicados ({total})</h2>
        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
        >
          <option value={10}>10</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">Carregando...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">Nenhum frete comunidade publicado.</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-2 py-1">Transportadora</th>
                  <th className="px-2 py-1">Rota</th>
                  <th className="px-2 py-1">Valor</th>
                  <th className="px-2 py-1">Produto</th>
                  <th className="px-2 py-1">Expira em</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-2 py-1">{r.carrierName ?? '—'}</td>
                    <td className="px-2 py-1">
                      {r.origin} → {r.destination}
                    </td>
                    <td className="px-2 py-1">{formatCurrency(r.value)}</td>
                    <td className="px-2 py-1">{r.product ?? '—'}</td>
                    <td className="px-2 py-1">{r.daysLeft} dia(s)</td>
                    <td className="px-2 py-1">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded border border-gray-200 p-2 text-xs">
                <div className="font-medium">{r.carrierName ?? '—'}</div>
                <div className="text-gray-600">
                  {r.origin} → {r.destination}
                </div>
                <div className="mt-1 flex justify-between text-gray-500">
                  <span>{formatCurrency(r.value)}</span>
                  <span>{r.daysLeft} dia(s)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              className="rounded bg-gray-100 px-2.5 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-gray-500">
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(offset + limit)}
              className="rounded bg-gray-100 px-2.5 py-1 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </section>
  );
}
