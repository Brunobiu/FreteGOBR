/**
 * FretesListPage - /admin/fretes
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  bulkClose,
  bulkCancel,
  exportFretesCSV,
  getAlerts,
  listFretes,
  parseFretesFiltersFromQuery,
  serializeFretesFiltersToQuery,
  type BulkResult,
  type FretesAlerts,
  type FretesFilters,
  type FretesListResult,
} from '../../../services/admin/fretes';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import FretesFiltersUI from '../../../components/admin/fretes/FretesFilters';
import FretesTable from '../../../components/admin/fretes/FretesTable';
import FretesBulkBar from '../../../components/admin/fretes/FretesBulkBar';
import FretesAlertsCard from '../../../components/admin/fretes/FretesAlertsCard';

export default function FretesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFretesFiltersFromQuery(searchParams), [searchParams]);

  const { allowed: canView } = useAdminPermission('FRETE_VIEW');
  const { allowed: canForceClose } = useAdminPermission('FRETE_FORCE_CLOSE');

  const [data, setData] = useState<FretesListResult | null>(null);
  const [alerts, setAlerts] = useState<FretesAlerts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showBulkCancel, setShowBulkCancel] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [list, al] = await Promise.all([listFretes(filters), getAlerts()]);
        if (cancelled) return;
        setData(list);
        setAlerts(al);
      } catch (err) {
        if (cancelled) return;
        console.error('[admin/fretes] listFretes/getAlerts falhou:', err);
        setError((err as Error).message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, filters]);

  function applyFilters(next: FretesFilters) {
    setSearchParams(serializeFretesFiltersToQuery(next));
    setSelectedIds(new Set());
  }

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
      return new Set(data.rows.map((r) => r.id));
    });
  }

  async function handleBulkClose() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProgress({ current: 0, total: ids.length });
    try {
      const result = await bulkClose(ids);
      setBulkResult(result);
      setSelectedIds(new Set());
      const refreshed = await listFretes(filters);
      setData(refreshed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkProgress(null);
    }
  }

  async function handleBulkCancelConfirmed(reason: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setShowBulkCancel(false);
    setBulkProgress({ current: 0, total: ids.length });
    try {
      const result = await bulkCancel(ids, reason);
      setBulkResult(result);
      setSelectedIds(new Set());
      const refreshed = await listFretes(filters);
      setData(refreshed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkProgress(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await exportFretesCSV(filters);
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      a.href = url;
      a.download = `fretego-fretes-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (result.truncated) {
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
        <div className="flex items-center gap-2 flex-wrap">
          <FretesFiltersUI
            filters={filters}
            onChange={applyFilters}
            totalFiltered={data?.total ?? 0}
          />
          <FretesAlertsCard
            alerts={alerts}
            onClickFlagged={() => applyFilters({ ...filters, flagged: true, page: 1 })}
          />
        </div>

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
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="px-2.5 py-1 rounded text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50 transition"
          >
            {exporting ? 'Gerando...' : 'Exportar'}
          </button>
        </div>
      </div>

      {canForceClose && (
        <FretesBulkBar
          selectedCount={selectedIds.size}
          inProgress={bulkProgress}
          onClose={() => void handleBulkClose()}
          onCancel={() => setShowBulkCancel(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
          <div>Nao foi possivel carregar fretes.</div>
          <div className="text-xs text-red-400/80 mt-1 break-all">{error}</div>
          <button
            type="button"
            onClick={() => setSearchParams(serializeFretesFiltersToQuery(filters))}
            className="underline mt-2"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <FretesTable
        rows={data?.rows ?? []}
        loading={loading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        canSelect={canForceClose}
      />

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div>
            Página {data.page} de {totalPages} · {data.total} fretes
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

      {bulkResult && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-lg">
          <div className="text-sm font-semibold text-gray-200 mb-1">Operacao concluida</div>
          <p className="text-xs text-gray-400 mb-3">
            {bulkResult.success.length} sucesso · {bulkResult.skipped.length} pulados ·{' '}
            {bulkResult.failed.length} falhas
          </p>
          <button
            type="button"
            onClick={() => setBulkResult(null)}
            className="text-xs text-cyan-300 hover:text-cyan-200"
          >
            Fechar
          </button>
        </div>
      )}

      {showBulkCancel && data && data.rows.length > 0 && (
        <BulkCancelModal
          count={selectedIds.size}
          onClose={() => setShowBulkCancel(false)}
          onConfirm={handleBulkCancelConfirmed}
        />
      )}
    </div>
  );
}

// Modal local para bulk cancel com motivo
function BulkCancelModal({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 1000;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">
            Cancelar {count} fretes selecionados
          </h3>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-400">
            O mesmo motivo sera aplicado a todos os fretes do lote.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 1000))}
            rows={4}
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
            placeholder="Motivo do cancelamento..."
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => onConfirm(reason)}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white"
            >
              Cancelar fretes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
