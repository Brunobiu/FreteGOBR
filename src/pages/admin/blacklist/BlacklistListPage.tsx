/**
 * BlacklistListPage - /admin/blacklist
 *
 * Lista paginada de entradas da blacklist. Filtros em popover, paginacao 10/50/100,
 * acoes topo direito gated por permissoes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  bulkRemove,
  exportCSV,
  listEntries,
  parseBlacklistFiltersFromQuery,
  serializeBlacklistFiltersToQuery,
  type BlacklistFilters,
  type BlacklistListResult,
} from '../../../services/admin/blacklist';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import BlacklistFiltersUI from '../../../components/admin/blacklist/BlacklistFilters';
import BlacklistTable from '../../../components/admin/blacklist/BlacklistTable';
import BlacklistAddModal from '../../../components/admin/blacklist/BlacklistAddModal';
import BlacklistBulkRemoveModal from '../../../components/admin/blacklist/BlacklistBulkRemoveModal';

export default function BlacklistListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseBlacklistFiltersFromQuery(searchParams), [searchParams]);

  const { allowed: canView } = useAdminPermission('BLACKLIST_VIEW');
  const { allowed: canManage } = useAdminPermission('BLACKLIST_MANAGE');
  const { allowed: canBulk } = useAdminPermission('BLACKLIST_BULK');

  const [data, setData] = useState<BlacklistListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkRemove, setShowBulkRemove] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Carrega entradas sempre que filtros (ou reloadKey) mudam
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listEntries(filters);
        if (cancelled) return;
        setData(result);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, filters, reloadKey]);

  const applyFilters = useCallback(
    (next: BlacklistFilters) => {
      setSearchParams(serializeBlacklistFiltersToQuery(next));
      setSelectedIds(new Set());
    },
    [setSearchParams]
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (!data) return;
    setSelectedIds(() => {
      if (!checked) return new Set();
      const next = new Set<string>();
      for (const r of data.rows) {
        if (!r.removed_at) next.add(r.id);
      }
      return next;
    });
  }

  async function handleConfirmBulkRemove(reason: string | null) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const result = await bulkRemove(ids, reason ? { reason } : {});
      setSelectedIds(new Set());
      setShowBulkRemove(false);
      setReloadKey((k) => k + 1);
      // toast simples
      // eslint-disable-next-line no-alert
      alert(
        `Concluído: ${result.success.length} removida(s), ${result.skipped.length} já estavam removida(s), ${result.failed.length} falha(s).`
      );
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert((err as Error).message ?? 'Falha na remoção em massa.');
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await exportCSV(filters);
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      a.href = url;
      a.download = `fretego-blacklist-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (result.truncated) {
        // eslint-disable-next-line no-alert
        alert('Export limitado a 10000 linhas. Refine os filtros para exportar todos.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  if (!canView) return null;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <BlacklistFiltersUI
          filters={filters}
          onChange={applyFilters}
          totalFiltered={data?.total ?? 0}
        />

        <div className="flex items-center gap-2">
          <select
            aria-label="Tamanho da página"
            value={filters.pageSize}
            onChange={(e) =>
              applyFilters({ ...filters, pageSize: Number(e.target.value), page: 1 })
            }
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100"
          >
            <option value={10}>10</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="px-2.5 py-1 rounded text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
            >
              Adicionar
            </button>
          )}
          {canBulk && (
            <Link
              to="/admin/blacklist/bulk"
              className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Importar CSV
            </Link>
          )}
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="px-2.5 py-1 rounded text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {exporting ? 'Gerando...' : 'Exportar'}
          </button>
        </div>
      </div>

      {canManage && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded border border-cyan-500/30 bg-cyan-500/10 p-2 text-xs text-cyan-200">
          <div>{selectedIds.size} selecionada(s)</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setShowBulkRemove(true)}
              disabled={selectedIds.size > 200}
              className="px-2 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50"
            >
              Remover selecionadas
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
          Não foi possível carregar a blacklist.{' '}
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="underline">
            Tentar novamente
          </button>
        </div>
      )}

      <BlacklistTable
        rows={data?.rows ?? []}
        loading={loading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        canSelect={canManage}
      />

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div>
            Página {data.page} de {totalPages} · {data.total} entrada(s)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyFilters({ ...filters, page: Math.max(1, filters.page - 1) })}
              disabled={data.page <= 1}
              className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() =>
                applyFilters({
                  ...filters,
                  page: Math.min(totalPages, filters.page + 1),
                })
              }
              disabled={data.page >= totalPages}
              className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
            >
              Próximo
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <BlacklistAddModal
          open={showAdd}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {showBulkRemove && (
        <BlacklistBulkRemoveModal
          selectedCount={selectedIds.size}
          onClose={() => setShowBulkRemove(false)}
          onConfirm={handleConfirmBulkRemove}
        />
      )}
    </div>
  );
}
