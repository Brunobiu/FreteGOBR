/**
 * SupervisorDiagnosticsPage (/admin/supervisor/diagnostico) — Central de
 * Diagnóstico (somente-leitura). Tabela ordenada (compareDiagnostics), filtros
 * em popover (módulo/severidade/datas), paginação 10/50/100. SEM mutação.
 *
 * Gating: SUPERVISOR_VIEW ⇒ senão Stealth_404. Compacto.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import SupervisorNav from '../../../components/admin/supervisor/SupervisorNav';
import DiagnosticsFiltersPopover from '../../../components/admin/supervisor/DiagnosticsFiltersPopover';
import { InsightSeverityBadge } from '../../../components/admin/supervisor/SupervisorBadges';
import {
  listDiagnostics,
  SupervisorError,
  type DiagnosticFilters,
  type SupervisorDiagnostic,
  type PageSize,
} from '../../../services/admin/supervisor';
import { compareDiagnostics } from '../../../services/admin/supervisor/ordering';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function sortDiagnostics(items: SupervisorDiagnostic[]): SupervisorDiagnostic[] {
  return [...items].sort((a, b) =>
    compareDiagnostics({ id: a.id, lastSeenAt: a.last_seen_at }, { id: b.id, lastSeenAt: b.last_seen_at })
  );
}

export default function SupervisorDiagnosticsPage() {
  const { allowed: canView } = useAdminPermission('SUPERVISOR_VIEW');
  const [filters, setFilters] = useState<DiagnosticFilters>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [data, setData] = useState<{ items: SupervisorDiagnostic[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listDiagnostics(filters, page, pageSize)
      .then((d) => setData({ items: sortDiagnostics(d.items), total: d.total }))
      .catch((e) =>
        setError(e instanceof SupervisorError ? e.message : 'Não foi possível carregar os diagnósticos.')
      )
      .finally(() => setLoading(false));
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  if (!canView) return <Stealth404 />;

  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(page * pageSize + pageSize, total);
  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <SupervisorNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {total > 0 ? `Exibindo ${pageStart}–${pageEnd} de ${total}` : 'Nenhum diagnóstico'}
        </div>
        <div className="flex items-center gap-1.5">
          <DiagnosticsFiltersPopover
            filters={filters}
            onApply={(next) => {
              setPage(0);
              setFilters(next);
            }}
          />
          <button
            type="button"
            onClick={load}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700"
            title="Atualizar"
          >
            {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error ? (
        <DashboardBlockError message={error} onRetry={load} />
      ) : loading && !data ? (
        <div className="text-center text-gray-500 text-sm py-6">Carregando diagnósticos...</div>
      ) : (
        <>
          <div className="hidden md:block rounded border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Severidade</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Módulo</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Descrição</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Ocorrências</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Última vez</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {items.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-900/60">
                    <td className="px-3 py-2">
                      <InsightSeverityBadge severity={d.severity} />
                    </td>
                    <td className="px-3 py-2 text-gray-300">{d.module}</td>
                    <td className="px-3 py-2 text-gray-200">
                      <div>{d.description}</div>
                      {d.suggested_fix && (
                        <div className="text-[10px] text-gray-500">Sugestão: {d.suggested_fix}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{d.occurrence_count}</td>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {formatDateTime(d.last_seen_at)}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Nenhum diagnóstico encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {items.map((d) => (
              <div key={d.id} className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <InsightSeverityBadge severity={d.severity} />
                  <span className="text-[10px] text-gray-500">{d.module}</span>
                </div>
                <p className="text-sm text-gray-100">{d.description}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {d.occurrence_count}x · {formatDateTime(d.last_seen_at)}
                </p>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-6">Nenhum diagnóstico encontrado.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <select
              value={pageSize}
              onChange={(e) => {
                setPage(0);
                setPageSize(Number(e.target.value) as PageSize);
              }}
              className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-gray-200"
            >
              <option value={10}>10</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={pageEnd >= total}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
