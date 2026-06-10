/**
 * UsersListPage - /admin/users
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  bulkToggleActive,
  exportUsersCSV,
  getPendingDocCountsByUser,
  isMasterAdmin,
  listUsers,
  parseUsersFiltersFromQuery,
  serializeUsersFiltersToQuery,
  type BulkResult,
  type UsersFilters,
  type UsersListResult,
} from '../../../services/admin/users';
import { useAdminContext } from '../../../components/admin/AdminProvider';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import UsersFiltersUI from '../../../components/admin/users/UsersFilters';
import UsersTable from '../../../components/admin/users/UsersTable';
import UsersBulkBar from '../../../components/admin/users/UsersBulkBar';
import { Link } from 'react-router-dom';

export default function UsersListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseUsersFiltersFromQuery(searchParams), [searchParams]);

  const { allowed: canView } = useAdminPermission('USER_VIEW');
  const { allowed: canToggleActive } = useAdminPermission('USER_TOGGLE_ACTIVE');
  const { allowed: canManageAdmins } = useAdminPermission('ADMIN_ROLE_GRANT');

  const { session } = useAdminContext();
  const selfId = session?.userId ?? null;

  const [data, setData] = useState<UsersListResult | null>(null);
  const [pendingByUser, setPendingByUser] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [exporting, setExporting] = useState(false);

  // Carrega usuarios sempre que filtros mudam
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listUsers(filters);
        if (cancelled) return;
        setData(result);
        // Busca contagem de documentos pendentes por usuário (badge na linha).
        void getPendingDocCountsByUser(result.rows.map((r) => r.id)).then((counts) => {
          if (!cancelled) setPendingByUser(counts);
        });
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
  }, [canView, filters]);

  function applyFilters(next: UsersFilters) {
    setSearchParams(serializeUsersFiltersToQuery(next));
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
      const next = new Set<string>();
      for (const r of data.rows) {
        if (!isMasterAdmin(r) && r.id !== selfId) next.add(r.id);
      }
      return next;
    });
  }

  async function handleBulk(targetState: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProgress({ current: 0, total: ids.length });
    try {
      const result = await bulkToggleActive(ids, targetState);
      setBulkResult(result);
      setSelectedIds(new Set());
      // Recarrega lista
      const refreshed = await listUsers(filters);
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
      const result = await exportUsersCSV(filters);
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      a.href = url;
      a.download = `fretego-usuarios-${ts}.csv`;
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
        <UsersFiltersUI
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
          {canManageAdmins && (
            <Link
              to="/admin/users/admins"
              className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700 transition"
            >
              Admins
            </Link>
          )}
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

      {canToggleActive && (
        <UsersBulkBar
          selectedCount={selectedIds.size}
          inProgress={bulkProgress}
          onActivate={() => void handleBulk(true)}
          onDeactivate={() => void handleBulk(false)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
          Nao foi possivel carregar usuarios.{' '}
          <button
            type="button"
            onClick={() => setSearchParams(serializeUsersFiltersToQuery(filters))}
            className="underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <UsersTable
        rows={data?.rows ?? []}
        loading={loading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        canSelect={canToggleActive}
        isMasterAdminId={(id) => {
          const u = data?.rows.find((r) => r.id === id);
          return u ? isMasterAdmin(u) : false;
        }}
        isSelfId={(id) => id === selfId}
        pendingByUser={pendingByUser}
      />

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div>
            Página {data.page} de {totalPages} · {data.total} usuários
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
    </div>
  );
}
