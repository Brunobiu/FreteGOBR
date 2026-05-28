import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listAdminTickets,
  TicketError,
  type SupportTicket,
  type TicketStatus,
  type TicketPriority,
} from '../../services/admin/tickets';

const PAGE_SIZE_OPTIONS = [10, 50, 100];

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: 'bg-blue-900/40 text-blue-300',
  in_progress: 'bg-yellow-900/40 text-yellow-300',
  resolved: 'bg-green-900/40 text-green-300',
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
};

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  low: 'bg-gray-700 text-gray-300',
  normal: 'bg-blue-900/30 text-blue-300',
  high: 'bg-red-900/40 text-red-300',
};

/**
 * Página admin `/admin/suporte/tickets`. Permissão SUPORTE_VIEW.
 */
export default function AdminTicketsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filterStatus, setFilterStatus] = useState<TicketStatus | ''>('');
  const [filterPriority, setFilterPriority] = useState<TicketPriority | ''>('');
  const [guestOnly, setGuestOnly] = useState(false);
  const [q, setQ] = useState('');
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilterCount =
    (filterStatus ? 1 : 0) + (filterPriority ? 1 : 0) + (guestOnly ? 1 : 0) + (q.trim() ? 1 : 0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAdminTickets({
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
        guestOnly: guestOnly || undefined,
        q: q.trim() || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof TicketError ? err.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterStatus, filterPriority, guestOnly, q]);

  const clearFilters = () => {
    setFilterStatus('');
    setFilterPriority('');
    setGuestOnly(false);
    setQ('');
    setPage(1);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Tickets de Suporte</h1>
          <p className="text-sm text-gray-400 mt-1">
            Solicitações de usuários e visitantes anônimos.
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setFilterPopoverOpen((v) => !v)}
            className="relative inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
              />
            </svg>
            Filtros
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0 bg-blue-600 text-white text-[10px] rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>

          {filterPopoverOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterPopoverOpen(false)} />
              <div className="absolute top-full right-0 mt-1 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 z-40 space-y-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Buscar assunto</label>
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as TicketStatus | '')}
                    className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                  >
                    <option value="">Todos</option>
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em andamento</option>
                    <option value="resolved">Resolvido</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Prioridade</label>
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value as TicketPriority | '')}
                    className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                  >
                    <option value="">Todas</option>
                    <option value="low">Baixa</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={guestOnly}
                    onChange={(e) => setGuestOnly(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-gray-200">Apenas visitantes anônimos</span>
                </label>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="w-full px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-300 text-[11px] font-medium rounded"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400 text-center">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-sm text-gray-400 text-center">Nenhum ticket encontrado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Assunto</th>
                <th className="px-3 py-2 text-left w-32">De</th>
                <th className="px-3 py-2 text-left w-24">Status</th>
                <th className="px-3 py-2 text-left w-20">Prioridade</th>
                <th className="px-3 py-2 text-left w-32">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/admin/suporte/tickets/${t.id}`)}
                  className="border-t border-gray-700 hover:bg-gray-700/40 cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <p className="text-gray-100 font-medium truncate max-w-md">{t.subject}</p>
                  </td>
                  <td className="px-3 py-2">
                    {t.userId ? (
                      <span className="text-gray-300 text-xs">Usuário</span>
                    ) : (
                      <div>
                        <span className="text-yellow-300 text-xs font-medium">Visitante</span>
                        <p className="text-[10px] text-gray-500 truncate">{t.guestName}</p>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BADGE[t.status]}`}
                    >
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${PRIORITY_BADGE[t.priority]}`}
                    >
                      {PRIORITY_LABEL[t.priority]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">
                    {new Date(t.createdAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && items.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700 bg-gray-900/40 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <span>Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-200"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
              </span>
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-40"
              >
                ←
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
