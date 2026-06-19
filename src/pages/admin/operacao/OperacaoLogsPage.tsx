/**
 * OperacaoLogsPage (/admin/operacao/logs) — Painel de Logs (somente-leitura).
 *
 * Tabela ordenada (compareLogs: occurred_at ↓, depois desempate estável),
 * filtros em popover (tipo/datas/ator/alvo), paginação 10/50/100. SEM qualquer
 * controle de mutação (Req 10.6). Estado vazio: "Nenhum registro encontrado.".
 *
 * Gating: LOG_VIEW ⇒ senão Stealth_404 (Req 1.6, 1.7, 10.6, 10.7). Compacto.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import OperacaoNav from '../../../components/admin/operacao/OperacaoNav';
import LogsFiltersPopover from '../../../components/admin/operacao/LogsFiltersPopover';
import {
  listLogs,
  OperacaoError,
  type LogFilters,
  type LogEntry,
  type PageSize,
} from '../../../services/admin/operacao';
import { compareLogs } from '../../../services/admin/operacao/ordering';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Chave sintética estável (LogEntry não traz id) para desempate/render. */
function logKey(e: LogEntry): string {
  return `${e.occurred_at}|${e.event_type}|${e.actor ?? ''}|${e.target_id ?? ''}`;
}

function sortLogs(items: LogEntry[]): LogEntry[] {
  return [...items].sort((a, b) =>
    compareLogs(
      { id: logKey(a), occurredAt: a.occurred_at, eventType: a.event_type },
      { id: logKey(b), occurredAt: b.occurred_at, eventType: b.event_type }
    )
  );
}

export default function OperacaoLogsPage() {
  const { allowed: canView } = useAdminPermission('LOG_VIEW');

  const [filters, setFilters] = useState<LogFilters>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [data, setData] = useState<{ items: LogEntry[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listLogs(filters, page, pageSize)
      .then((d) => setData({ items: sortLogs(d.items), total: d.total }))
      .catch((e) =>
        setError(e instanceof OperacaoError ? e.message : 'Não foi possível carregar os logs.')
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
      <OperacaoNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {total > 0 ? `Exibindo ${pageStart}–${pageEnd} de ${total}` : 'Nenhum registro'}
        </div>
        <div className="flex items-center gap-1.5">
          <LogsFiltersPopover
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
        <div className="text-center text-gray-500 text-sm py-6">Carregando logs...</div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Quando</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Evento</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Ator</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Alvo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {items.map((e) => (
                  <tr key={logKey(e)} className="hover:bg-gray-900/60">
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {formatDateTime(e.occurred_at)}
                    </td>
                    <td className="px-3 py-2 text-gray-200">{e.summary}</td>
                    <td className="px-3 py-2 text-gray-400 font-mono text-[11px]">
                      {e.actor ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-[11px]">
                      {e.target_type ? `${e.target_type}${e.target_id ? ` · ${e.target_id}` : ''}` : '—'}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {items.map((e) => (
              <div key={logKey(e)} className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm text-gray-100">{e.summary}</span>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap">
                    {formatDateTime(e.occurred_at)}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 font-mono truncate">{e.actor ?? '—'}</p>
                {e.target_type && (
                  <p className="text-[11px] text-gray-500 truncate">
                    {e.target_type}
                    {e.target_id ? ` · ${e.target_id}` : ''}
                  </p>
                )}
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-6">Nenhum registro encontrado.</p>
            )}
          </div>

          {/* Paginação */}
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
