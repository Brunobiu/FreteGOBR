/**
 * TrialListPage - /admin/trial
 *
 * Listagem paginada do status de trial dos motoristas (Req 10.1). Segue o
 * scaffold padrao das paginas de listagem do painel admin (espelha
 * BlacklistListPage): gate de permissao em primeira camada, fetch com
 * cancelamento, estados de loading/erro, filtros em popover e paginacao
 * 10/50/100.
 *
 * Padroes aplicados (steering project-conventions.md + admin-patterns.md):
 *   - Gate `useAdminPermission('USER_VIEW')` => `<Stealth404 />` quando negado
 *     (Req 10.4); o servidor reaplica o gating na RPC `admin_list_trial_motoristas`.
 *   - Estilo compacto: SEM `<h1>` grande no topo; filtros via popover
 *     (`TrialFilters` com botao `SlidersHorizontal`); seletor de paginacao
 *     10/50/100 com default 10 (Req 10.5).
 *   - Degradacao graciosa: a tabela e sempre renderizada com os dados, mesmo
 *     que o estilo compacto nao possa ser plenamente mantido (Req 10.6).
 *   - Acao "Estender" gated por `useAdminPermission('USER_EDIT')` (camada de UI);
 *     abre o `ExtendTrialModal`, que aplica versionamento otimista. Em sucesso
 *     (ou `STALE_VERSION`), a listagem e refetchada.
 *
 * Filtros sao mantidos na URL via `parseTrialFiltersFromQuery` /
 * `serializeTrialFiltersToQuery` (deep-linkable, padrao da casa).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  listTrialMotoristas,
  parseTrialFiltersFromQuery,
  serializeTrialFiltersToQuery,
  TrialServiceError,
  TRIAL_ERROR_MESSAGES,
  type TrialFilters,
  type TrialListResult,
  type TrialMotoristaRow,
} from '../../../services/admin/trial';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import TrialFiltersUI from '../../../components/admin/trial/TrialFilters';
import TrialMotoristasTable from '../../../components/admin/trial/TrialMotoristasTable';
import ExtendTrialModal from '../../../components/admin/trial/ExtendTrialModal';

export default function TrialListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseTrialFiltersFromQuery(searchParams), [searchParams]);

  // Camada 1 (UI): gating de permissao. A RPC reaplica no servidor.
  const { allowed: canView } = useAdminPermission('USER_VIEW');
  const { allowed: canExtend } = useAdminPermission('USER_EDIT');

  const [data, setData] = useState<TrialListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Linha alvo do modal de extensao (null = fechado).
  const [extendRow, setExtendRow] = useState<TrialMotoristaRow | null>(null);

  // Carrega a listagem sempre que filtros (ou reloadKey) mudam.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listTrialMotoristas(filters);
        if (cancelled) return;
        setData(result);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof TrialServiceError
            ? TRIAL_ERROR_MESSAGES[err.code]
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
    (next: TrialFilters) => {
      setSearchParams(serializeTrialFiltersToQuery(next));
    },
    [setSearchParams]
  );

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // Gate de permissao: usuario sem USER_VIEW ve o 404 furtivo (Req 10.4).
  if (!canView) return <Stealth404 />;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      {/* Top bar compacto: contagem + filtros (popover) + seletor de pagina. Sem <h1>. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-500">
          {data && data.total > 0
            ? `${data.total} motorista(s)`
            : 'Nenhum motorista no filtro atual'}
        </div>

        <div className="flex items-center gap-2">
          <TrialFiltersUI filters={filters} onChange={applyFilters} />
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
          Não foi possível carregar os motoristas.{' '}
          <button type="button" onClick={refetch} className="underline">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Degradacao graciosa (Req 10.6): a tabela sempre renderiza os dados. */}
      <TrialMotoristasTable
        rows={data?.rows ?? []}
        loading={loading}
        onExtend={canExtend ? (row) => setExtendRow(row) : undefined}
        canExtend={canExtend}
      />

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div>
            Página {data.page} de {totalPages} · {data.total} motorista(s)
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

      {canExtend && (
        <ExtendTrialModal
          row={extendRow}
          open={extendRow !== null}
          onClose={() => setExtendRow(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
