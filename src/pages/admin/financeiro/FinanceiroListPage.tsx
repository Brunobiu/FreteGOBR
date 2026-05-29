/**
 * FinanceiroListPage — /admin/financeiro
 *
 * Lista paginada de repasses (1:1 com fretes encerrados). Filtros
 * compactos em popover, paginação 10/50/100, ações por linha
 * conforme permissão FINANCEIRO_EDIT.
 *
 * Spec: .kiro/specs/admin-financeiro/{requirements,design,tasks}.md
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import {
  DEFAULT_REPASSE_FILTERS,
  FINANCEIRO_ERROR_MESSAGES,
  FinanceiroError,
  formatBRL,
  formatDate,
  listRepasses,
  parseFiltersFromQuery,
  serializeFiltersToQuery,
  type ListRepassesResult,
  type RepasseFilters,
  type RepasseStatus,
} from '../../../services/admin/financeiro';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RepasseStatus | 'todos', string> = {
  todos: 'Todos',
  pendente: 'Pendente',
  pago: 'Pago',
  estornado: 'Estornado',
};

const STATUS_BADGE: Record<RepasseStatus, string> = {
  pendente: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  pago: 'bg-green-100 text-green-800 border-green-200',
  estornado: 'bg-gray-100 text-gray-700 border-gray-200',
};

// ─── Página ─────────────────────────────────────────────────────────────────

export default function FinanceiroListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canView } = useAdminPermission('FINANCEIRO_VIEW');
  const { allowed: canEdit } = useAdminPermission('FINANCEIRO_EDIT');

  const filters: RepasseFilters = useMemo(
    () => ({ ...DEFAULT_REPASSE_FILTERS, ...parseFiltersFromQuery(searchParams) }),
    [searchParams]
  );

  const [data, setData] = useState<ListRepassesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listRepasses(filters)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof FinanceiroError ? err.code : 'UNKNOWN';
        setError(FINANCEIRO_ERROR_MESSAGES[code] ?? 'Erro inesperado.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, filters]);

  if (!canView) {
    // Stealth_404: usuário sem permissão vê 404 padrão
    return (
      <div className="p-6 text-center text-gray-500">
        <h2 className="text-lg font-semibold text-gray-700">Pagina nao encontrada</h2>
        <p className="text-sm mt-2">A rota solicitada nao existe.</p>
      </div>
    );
  }

  const updateFilter = (patch: Partial<RepasseFilters>) => {
    const next = { ...filters, ...patch, offset: 0 };
    setSearchParams(serializeFiltersToQuery(next));
  };

  const goToPage = (newOffset: number) => {
    setSearchParams(serializeFiltersToQuery({ ...filters, offset: newOffset }));
  };

  const total = data?.total ?? 0;
  const limit = filters.limit ?? 10;
  const offset = filters.offset ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + limit, total);

  return (
    <div className="p-3 sm:p-5 space-y-3">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {total > 0
            ? `Exibindo ${pageStart}–${pageEnd} de ${total} repasses`
            : 'Nenhum repasse no periodo'}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="text-xs px-2.5 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
            title="Filtros"
          >
            ⚙ Filtros
          </button>
          <button
            onClick={() => setSearchParams(serializeFiltersToQuery({ ...filters }))}
            className="text-xs px-2.5 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
            title="Atualizar"
          >
            {loading ? '⏳' : '↻'} Atualizar
          </button>
          {canEdit && (
            <Link
              to="/admin/financeiro/configuracoes"
              className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Configurar comissao
            </Link>
          )}
        </div>
      </div>

      {/* Filtros popover */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-md p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
              Status
            </label>
            <select
              value={filters.status ?? 'todos'}
              onChange={(e) =>
                updateFilter({
                  status: e.target.value === 'todos' ? null : (e.target.value as RepasseStatus),
                })
              }
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            >
              {(['todos', 'pendente', 'pago', 'estornado'] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
              De
            </label>
            <input
              type="date"
              value={filters.period_from ?? ''}
              onChange={(e) => updateFilter({ period_from: e.target.value || null })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
              Ate
            </label>
            <input
              type="date"
              value={filters.period_to ?? ''}
              onChange={(e) => updateFilter({ period_to: e.target.value || null })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
          </div>
        </div>
      )}

      {/* Tabela */}
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="bg-white border border-gray-200 rounded p-6 text-center text-gray-500 text-sm">
          <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2 align-middle" />
          Carregando repasses...
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">
                    Frete
                  </th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">
                    Embarcador
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">
                    Valor bruto
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">
                    Comissao
                  </th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider">
                    Liquido
                  </th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">
                    Encerrado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.items.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-600">
                      <Link
                        to={`/admin/financeiro/${row.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        #{row.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-800 truncate max-w-[180px]">
                      {row.embarcador_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-800">
                      {formatBRL(row.valor_bruto)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {formatBRL(row.commission_value)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-green-700">
                      {formatBRL(row.valor_liquido)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_BADGE[row.status]}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{formatDate(row.closed_at)}</td>
                  </tr>
                ))}
                {data?.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                      Nenhum repasse encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {data?.items.map((row) => (
              <Link
                key={row.id}
                to={`/admin/financeiro/${row.id}`}
                className="block bg-white border border-gray-200 rounded p-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] text-gray-500">#{row.id.slice(0, 8)}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_BADGE[row.status]}`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </div>
                <p className="text-xs text-gray-800 truncate">{row.embarcador_name ?? '—'}</p>
                <div className="flex justify-between items-end mt-1.5 text-xs">
                  <span className="text-gray-500">{formatDate(row.closed_at)}</span>
                  <span className="font-semibold text-green-700">
                    {formatBRL(row.valor_liquido)}
                  </span>
                </div>
              </Link>
            ))}
            {data?.items.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-6">Nenhum repasse encontrado.</p>
            )}
          </div>

          {/* Paginação */}
          {total > limit && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <select
                value={limit}
                onChange={(e) => updateFilter({ limit: Number(e.target.value) as 10 | 50 | 100 })}
                className="border border-gray-300 rounded px-2 py-1"
              >
                <option value={10}>10</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={offset === 0}
                  onClick={() => goToPage(Math.max(0, offset - limit))}
                  className="px-2.5 py-1 bg-white border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <button
                  disabled={pageEnd >= total}
                  onClick={() => goToPage(offset + limit)}
                  className="px-2.5 py-1 bg-white border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Proxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
