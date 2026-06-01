/**
 * MarketingMetricsPage - /admin/marketing
 *
 * Painel de metricas da Meta Marketing API (admin-marketing 048, task 10.1).
 * Gated por `MARKETING_VIEW`: sem a permissao renderiza `Stealth404` (404
 * furtivo identico ao publico, sem revelar a existencia da rota — Req 1.4 /
 * admin-patterns.md §5). O servidor reaplica o gating na Edge
 * `meta-marketing-read` (camada 2).
 *
 * Compoe os componentes ja prontos de `components/admin/marketing/`:
 *   - MarketingPeriodSelector  (seletor de periodo; sincroniza a URL e dispara
 *     o re-fetch via onChange — Req 5.2 / 5.4)
 *   - MarketingKpiCards        (cards de KPI da campanha — Req 5.1)
 *   - MarketingTrendChart      (grafico SVG de tendencia)
 *   - MarketingCreativeRanking (ranking de criativos)
 *   - estados: MarketingEmptyState (TOKEN_NOT_CONFIGURED — Req 5.11),
 *     MarketingErrorState (META_API_UNAVAILABLE + retry — Req 5.12) e
 *     MarketingStaleIndicator (dados defasados de cache).
 *
 * Dados: `getMetrics(period)` (Edge meta-marketing-read). O periodo inicial vem
 * da URL (resolvido pelo MarketingPeriodSelector) ou, na ausencia, do
 * `default_period` de `marketing_config`, lido via `getConfig()` (Req 5.3).
 *
 * Estilo compacto (project-conventions.md): SEM `<h1>` grande no topo (a
 * sidebar ja identifica a area — Req 1.7).
 *
 * _Requirements: 1.1, 1.3, 1.4, 1.6, 1.7, 1.9, 5.1, 5.2, 5.3, 5.4, 5.11, 5.12_
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getConfig,
  getMetrics,
  mapMarketingError,
  MARKETING_ERROR_MESSAGES,
  MarketingError,
  type MetricPeriod,
  type MetricsResult,
} from '../../../services/admin/marketing';
import { useAdminPermission } from '../../../hooks/useAdminPermission';
import Stealth404 from '../../../components/admin/Stealth404';
import MarketingPeriodSelector from '../../../components/admin/marketing/MarketingPeriodSelector';
import MarketingKpiCards from '../../../components/admin/marketing/MarketingKpiCards';
import MarketingTrendChart from '../../../components/admin/marketing/MarketingTrendChart';
import MarketingCreativeRanking from '../../../components/admin/marketing/MarketingCreativeRanking';
import MarketingEmptyState from '../../../components/admin/marketing/MarketingEmptyState';
import MarketingErrorState from '../../../components/admin/marketing/MarketingErrorState';
import MarketingStaleIndicator from '../../../components/admin/marketing/MarketingStaleIndicator';

/** Rota de configuracao da integracao (link Configurar integracao). */
const CONFIG_HREF = '/admin/marketing/configuracoes';

/** Periodo default canonico ate `marketing_config` carregar (Req 3.12). */
const FALLBACK_PERIOD: MetricPeriod = '7d';

/** Estado do fetch de metricas (loading | ready | error). */
type MetricsState =
  | { status: 'loading' }
  | { status: 'ready'; result: MetricsResult }
  | { status: 'error'; error: MarketingError };

/** Skeleton leve enquanto as metricas carregam (padrao compacto do painel). */
function MetricsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Carregando métricas">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-gray-800 bg-gray-900 animate-pulse"
          />
        ))}
      </div>
      <div className="h-48 rounded-lg border border-gray-800 bg-gray-900 animate-pulse" />
    </div>
  );
}

export default function MarketingMetricsPage() {
  // Camada 1 (UI): sem MARKETING_VIEW cai no 404 furtivo (Req 1.4).
  const { allowed: canView } = useAdminPermission('MARKETING_VIEW');
  // Link Configurar integracao: gated por MARKETING_EDIT (oculto, nao
  // desabilitado — Req 1.9 / 5.11).
  const { allowed: canEdit } = useAdminPermission('MARKETING_EDIT');

  // Periodo default vindo de marketing_config; o MarketingPeriodSelector o usa
  // quando a URL nao traz um `period` valido (Req 5.3).
  const [defaultPeriod, setDefaultPeriod] = useState<MetricPeriod>(FALLBACK_PERIOD);
  // Periodo efetivamente resolvido (URL ou default), comunicado pelo selector.
  const [period, setPeriod] = useState<MetricPeriod | null>(null);
  // Re-fetch manual (botao Tentar novamente do MarketingErrorState).
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<MetricsState>({ status: 'loading' });

  // Le o default de marketing_config (Req 5.3). Falha aqui nao quebra a pagina:
  // mantem o fallback canonico '7d' e o selector continua funcional.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    getConfig()
      .then((cfg) => {
        if (!cancelled) setDefaultPeriod(cfg.default_period);
      })
      .catch(() => {
        /* Config indisponivel: mantem FALLBACK_PERIOD. */
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  // Recebe o periodo resolvido do selector (URL ou default) e dispara o fetch.
  const handlePeriodChange = useCallback((next: MetricPeriod) => {
    setPeriod(next);
  }, []);

  // Re-busca as metricas via Edge meta-marketing-read quando o periodo muda ou
  // ao clicar em Tentar novamente (Req 5.4 / 5.12).
  useEffect(() => {
    if (!canView || period === null) return;
    let cancelled = false;
    setState({ status: 'loading' });
    getMetrics(period)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', result });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', error: mapMarketingError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [canView, period, refreshKey]);

  const onRetry = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (!canView) return <Stealth404 />;

  return (
    <div className="space-y-3">
      {/* Barra superior compacta: seletor de periodo + link Configurar (gated).
          O seletor fica sempre montado para resolver o periodo da URL/default e
          disparar o fetch inicial via onChange. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <MarketingPeriodSelector defaultPeriod={defaultPeriod} onChange={handlePeriodChange} />
        {canEdit && (
          <Link
            to={CONFIG_HREF}
            className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition focus:outline-none focus:ring-2 focus:ring-cyan-700"
          >
            Configurar integração
          </Link>
        )}
      </div>

      {state.status === 'loading' && <MetricsSkeleton />}

      {state.status === 'error' &&
        (state.error.code === 'TOKEN_NOT_CONFIGURED' ? (
          // Integracao nao configurada: orienta a configurar (link gated dentro
          // do proprio componente por MARKETING_EDIT) — Req 5.11.
          <MarketingEmptyState configHref={CONFIG_HREF} />
        ) : (
          // Meta indisponivel (ou erro inesperado): bloco de erro com retry,
          // sem quebrar a pagina — Req 5.12.
          <MarketingErrorState
            onRetry={onRetry}
            message={MARKETING_ERROR_MESSAGES[state.error.code]}
          />
        ))}

      {state.status === 'ready' && (
        <>
          {/* Aviso de dados defasados (cache fallback); null quando nao stale. */}
          <MarketingStaleIndicator stale={state.result.stale} fetchedAt={state.result.fetched_at} />
          <MarketingKpiCards metrics={state.result.campaign} />
          <MarketingTrendChart series={state.result.series} />
          <MarketingCreativeRanking creatives={state.result.creatives} />
        </>
      )}
    </div>
  );
}
