/**
 * AdminAuditPage - listagem paginada de admin_audit_logs
 *
 * Filtros: admin, acao, target, periodo. Botao exportar CSV.
 */

import { useEffect, useState } from 'react';
import {
  AdminAuditLogRow,
  AuditFilters,
  exportAuditLogsCSV,
  listAuditLogs,
} from '../../services/admin/audit';
import { useAdminPermission } from '../../hooks/useAdminPermission';

const PAGE_SIZE = 50;

export default function AdminAuditPage() {
  const { allowed } = useAdminPermission('AUDIT_VIEW');
  const [rows, setRows] = useState<AdminAuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await listAuditLogs({ filters, page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, filters, page]);

  if (!allowed) return null;

  async function handleExport() {
    const csv = await exportAuditLogsCSV({ filters });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Auditoria</h1>
        <button
          type="button"
          onClick={() => void handleExport()}
          className="px-3 py-1.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-sm hover:bg-cyan-500/25 transition"
        >
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <input
          type="text"
          placeholder="Acao"
          value={filters.action ?? ''}
          onChange={(e) => {
            setPage(0);
            setFilters((f) => ({ ...f, action: e.target.value || undefined }));
          }}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
        />
        <input
          type="text"
          placeholder="Tipo do alvo"
          value={filters.targetType ?? ''}
          onChange={(e) => {
            setPage(0);
            setFilters((f) => ({ ...f, targetType: e.target.value || undefined }));
          }}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
        />
        <input
          type="date"
          value={filters.fromDate?.slice(0, 10) ?? ''}
          onChange={(e) => {
            setPage(0);
            setFilters((f) => ({
              ...f,
              fromDate: e.target.value ? `${e.target.value}T00:00:00Z` : undefined,
            }));
          }}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
        />
        <input
          type="date"
          value={filters.toDate?.slice(0, 10) ?? ''}
          onChange={(e) => {
            setPage(0);
            setFilters((f) => ({
              ...f,
              toDate: e.target.value ? `${e.target.value}T23:59:59Z` : undefined,
            }));
          }}
          className="px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-100"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-800/60 text-gray-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Admin</th>
              <th className="text-left px-3 py-2">Acao</th>
              <th className="text-left px-3 py-2">Alvo</th>
              <th className="text-left px-3 py-2">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-gray-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-gray-500">
                  Sem registros.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString('pt-BR')}
                </td>
                <td className="px-3 py-2 text-gray-300 font-mono text-xs">
                  {r.admin_id.slice(0, 8)}
                </td>
                <td className="px-3 py-2 text-cyan-300">{r.action}</td>
                <td className="px-3 py-2 text-gray-400">
                  {r.target_type ?? '-'}
                  {r.target_id ? ` · ${r.target_id}` : ''}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate">
                  {r.after_data
                    ? JSON.stringify(r.after_data)
                    : r.before_data
                      ? JSON.stringify(r.before_data)
                      : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-400">
        <div>
          {total} registros · pag. {page + 1}/{totalPages}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
          >
            Proximo
          </button>
        </div>
      </div>
    </div>
  );
}
