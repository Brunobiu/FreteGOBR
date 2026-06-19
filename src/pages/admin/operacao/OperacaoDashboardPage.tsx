/**
 * OperacaoDashboardPage (/admin/operacao) — Painel Operacional.
 *
 * Orquestra os onze Dashboard_KPI via OperacaoKpiGrid e aplica o Realtime_Refresh
 * (realtimeRefresh.reduce): atualização automática a cada Refresh_Interval, com
 * UMA requisição em voo (CP2), pausa em aba oculta e refresh manual que reinicia
 * o temporizador. Degradação parcial por grupo via OperacaoKpiGrid.
 *
 * Gating: DASHBOARD_VIEW ⇒ senão Stealth_404 (Req 1.2, 1.3). Padrão compacto
 * (sem <h1> grande).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import OperacaoNav from '../../../components/admin/operacao/OperacaoNav';
import OperacaoKpiGrid from '../../../components/admin/operacao/OperacaoKpiGrid';
import {
  getOperationsMetrics,
  OperacaoError,
  type OperationsMetricsBundle,
} from '../../../services/admin/operacao';
import {
  initRefresh,
  reduce,
  type RefreshEvent,
  type RefreshState,
} from '../../../services/admin/operacao/realtimeRefresh';

const TICK_MS = 1000;

export default function OperacaoDashboardPage() {
  const { allowed: canView } = useAdminPermission('DASHBOARD_VIEW');
  const [bundle, setBundle] = useState<OperationsMetricsBundle>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshRef = useRef<RefreshState>(initRefresh());

  const doFetch = useCallback(() => {
    setError(undefined);
    getOperationsMetrics()
      .then((b) => setBundle(b))
      .catch((e) =>
        setError(e instanceof OperacaoError ? e.message : 'Não foi possível carregar as métricas.')
      )
      .finally(() => {
        setLoading(false);
        refreshRef.current = reduce(refreshRef.current, { kind: 'request_done' }).state;
      });
  }, []);

  const dispatch = useCallback(
    (event: RefreshEvent) => {
      const { state, startFetch } = reduce(refreshRef.current, event);
      refreshRef.current = state;
      if (startFetch) doFetch();
    },
    [doFetch]
  );

  useEffect(() => {
    if (!canView) return;
    // Carga inicial imediata (arma inFlight, reinicia o temporizador).
    dispatch({ kind: 'manual' });
    const id = setInterval(() => dispatch({ kind: 'tick', deltaMs: TICK_MS }), TICK_MS);
    const onVis = () =>
      dispatch({ kind: 'visibility', visible: document.visibilityState === 'visible' });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [canView, dispatch]);

  if (!canView) return <Stealth404 />;

  const generatedAt = bundle?.meta.generatedAt
    ? new Date(bundle.meta.generatedAt)
    : null;

  return (
    <div className="space-y-3">
      <OperacaoNav />

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {generatedAt && !Number.isNaN(generatedAt.getTime())
            ? `Atualizado às ${generatedAt.toLocaleTimeString('pt-BR')}`
            : 'Painel operacional'}
        </div>
        <button
          type="button"
          onClick={() => dispatch({ kind: 'manual' })}
          className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700"
          title="Atualizar agora"
        >
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      <OperacaoKpiGrid
        bundle={bundle}
        loading={loading}
        error={error}
        onRetry={() => dispatch({ kind: 'manual' })}
      />
    </div>
  );
}
