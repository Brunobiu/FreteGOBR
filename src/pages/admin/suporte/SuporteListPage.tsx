/**
 * SuporteListPage — Central de Suporte Inteligente (/admin/suporte).
 *
 * Padrão compacto: sem <h1> grande, filtros em popover (ícone funil),
 * paginação 10/50/100 (default 10), tabela desktop + cards mobile. Sem
 * inserção em tempo real (Req 2.8): novos atendimentos só após "Atualizar".
 * Abas: Atendimentos · Base de Conhecimento · IA.
 *
 * Gating em duas camadas: AdminGuard (sessão) + Stealth404 quando sem
 * SUPORTE_VIEW (Req 1.3).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import DashboardBlockError from '../../../components/admin/dashboard/DashboardBlockError';
import {
  SuporteStatusBadge,
  SuportePriorityBadge,
  SuporteModeBadge,
} from '../../../components/admin/suporte/SuporteBadges';
import SuporteFiltersPopover from '../../../components/admin/suporte/SuporteFiltersPopover';
import FaqPanel from '../../../components/admin/suporte/FaqPanel';
import SupportAiConfigPanel from '../../../components/admin/suporte/SupportAiConfigPanel';
import {
  listTickets,
  SuporteError,
  type ListTicketsFilters,
  type SupportConsoleTicket,
} from '../../../services/admin/suporte';

type Tab = 'atendimentos' | 'faq' | 'ia';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function SuporteListPage() {
  const { allowed: canView } = useAdminPermission('SUPORTE_VIEW');
  const { allowed: canFaqView } = useAdminPermission('FAQ_VIEW');

  const [tab, setTab] = useState<Tab>('atendimentos');
  const [filters, setFilters] = useState<ListTicketsFilters>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<10 | 50 | 100>(10);
  const [data, setData] = useState<{ items: SupportConsoleTicket[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listTickets(filters, page, pageSize)
      .then(setData)
      .catch((err) => setError(err instanceof SuporteError ? err.message : 'Erro ao carregar atendimentos.'))
      .finally(() => setLoading(false));
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (canView && tab === 'atendimentos') load();
  }, [canView, tab, load]);

  if (!canView) return <Stealth404 />;

  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(page * pageSize + pageSize, total);

  return (
    <div className="space-y-3">
      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-gray-800">
        {([
          ['atendimentos', 'Atendimentos'],
          ...(canFaqView ? ([['faq', 'Base de Conhecimento']] as const) : []),
          ['ia', 'IA'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-[13px] border-b-2 -mb-px transition ${
              tab === key
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'atendimentos' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-500">
              {total > 0 ? `Exibindo ${pageStart}–${pageEnd} de ${total}` : 'Nenhum atendimento'}
            </div>
            <div className="flex items-center gap-1.5">
              <SuporteFiltersPopover
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
            <div className="text-center text-gray-500 text-sm py-6">Carregando atendimentos...</div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block rounded border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-900 text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Criado</th>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Cliente</th>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Plano</th>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Prioridade</th>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Responsável</th>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {data?.items.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-900/60">
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                          <Link to={`/admin/suporte/${t.id}`} className="text-cyan-400 hover:underline">
                            {formatDateTime(t.createdAt)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-gray-200">
                          <div className="truncate max-w-[200px]">{t.clientName ?? '—'}</div>
                          <div className="text-[10px] text-gray-500 truncate max-w-[200px]">
                            {t.clientEmail ?? ''}
                            {t.clientWhatsapp ? ` · ${t.clientWhatsapp}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-400">{t.planoLabel}</td>
                        <td className="px-3 py-2">
                          <SuportePriorityBadge level={t.priorityLevel} />
                        </td>
                        <td className="px-3 py-2">
                          <SuporteModeBadge mode={t.responderMode} />
                        </td>
                        <td className="px-3 py-2">
                          <SuporteStatusBadge status={t.status} />
                        </td>
                      </tr>
                    ))}
                    {data?.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                          Nenhum atendimento encontrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {data?.items.map((t) => (
                  <Link
                    key={t.id}
                    to={`/admin/suporte/${t.id}`}
                    className="block rounded border border-gray-800 bg-gray-900 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] text-gray-500">{formatDateTime(t.createdAt)}</span>
                      <SuporteStatusBadge status={t.status} />
                    </div>
                    <p className="text-sm text-gray-100 truncate">{t.clientName ?? '—'}</p>
                    <p className="text-[11px] text-gray-500 truncate">{t.clientEmail ?? ''}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <SuportePriorityBadge level={t.priorityLevel} />
                      <SuporteModeBadge mode={t.responderMode} />
                      <span className="text-[10px] text-gray-500 ml-auto">{t.planoLabel}</span>
                    </div>
                  </Link>
                ))}
                {data?.items.length === 0 && (
                  <p className="text-center text-gray-500 text-sm py-6">Nenhum atendimento encontrado.</p>
                )}
              </div>

              {/* Paginação */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPage(0);
                    setPageSize(Number(e.target.value) as 10 | 50 | 100);
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
        </>
      )}

      {tab === 'faq' && canFaqView && <FaqPanel />}
      {tab === 'ia' && <SupportAiConfigPanel />}
    </div>
  );
}
