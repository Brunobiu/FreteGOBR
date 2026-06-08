/**
 * SubscriptionsListPage — /admin/assinaturas
 *
 * Listagem das assinaturas dos motoristas (spec assinaturas-pagamento, Fase 6).
 * Segue o scaffold padrão das páginas de listagem admin (espelha TrialListPage):
 *   - Gate `useAdminPermission('FINANCEIRO_VIEW')` => `<Stealth404 />` (a RPC
 *     reaplica o gating no servidor com audit negativo SUBSCRIPTION_VIEW_DENIED).
 *   - Estilo compacto: SEM `<h1>`; abas de grupo (A vencer / Pagas /
 *     Inadimplentes / Todos); busca; seletor de página 10/50/100 (default 10).
 *   - Filtros deep-linkáveis na URL.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  listSubscriptions,
  parseSubscriptionFiltersFromQuery,
  serializeSubscriptionFiltersToQuery,
  SubscriptionAdminError,
  SUBSCRIPTION_ADMIN_ERROR_MESSAGES,
  type SubscriptionFilters,
  type SubscriptionGroup,
  type SubscriptionListResult,
} from '../../../services/admin/subscriptions';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import SubscriptionsTable from '../../../components/admin/subscriptions/SubscriptionsTable';

const GROUP_TABS: Array<{ key: SubscriptionGroup; label: string }> = [
  { key: 'a_vencer', label: 'A vencer' },
  { key: 'pagas', label: 'Pagas' },
  { key: 'inadimplentes', label: 'Inadimplentes' },
  { key: 'todos', label: 'Todas' },
];

export default function SubscriptionsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseSubscriptionFiltersFromQuery(searchParams), [searchParams]);

  const { allowed: canView } = useAdminPermission('FINANCEIRO_VIEW');

  const [data, setData] = useState<SubscriptionListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchInput, setSearchInput] = useState(filters.q ?? '');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listSubscriptions(filters);
        if (cancelled) return;
        setData(result);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof SubscriptionAdminError
            ? SUBSCRIPTION_ADMIN_ERROR_MESSAGES[err.code]
            : (err as Error).message;
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, filters, reloadKey]);

  const applyFilters = useCallback(
    (next: SubscriptionFilters) => {
      setSearchParams(serializeSubscriptionFiltersToQuery(next));
    },
    [setSearchParams]
  );

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  if (!canView) return <Stealth404 />;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      {/* Abas de grupo */}
      <div className="flex items-center gap-1 flex-wrap">
        {GROUP_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => applyFilters({ ...filters, group: t.key, page: 1 })}
            className={`text-xs px-2.5 py-1 rounded-md border transition ${
              filters.group === t.key
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                : 'text-gray-400 border-gray-700 hover:bg-gray-800/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Top bar: contagem + busca + seletor de página */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-500">
          {data && data.total > 0
            ? `${data.total} assinatura(s)`
            : 'Nenhuma assinatura no filtro atual'}
        </div>

        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyFilters({ ...filters, q: searchInput.trim() || null, page: 1 });
            }}
          >
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar nome/telefone"
              className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-100 w-44"
            />
          </form>
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
        </div>
      </div>

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
          {error}{' '}
          <button type="button" onClick={refetch} className="underline">
            Tentar novamente
          </button>
        </div>
      )}

      <SubscriptionsTable rows={data?.rows ?? []} loading={loading} />

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div>
            Página {data.page} de {totalPages} · {data.total} assinatura(s)
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
                applyFilters({ ...filters, page: Math.min(totalPages, filters.page + 1) })
              }
              disabled={data.page >= totalPages}
              className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
            >
              Próximo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
