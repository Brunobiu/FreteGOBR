/**
 * AdminDashboardPage - /admin (rota indice)
 *
 * Dashboard analitico do painel admin. Substitui o placeholder.
 * Gated por DASHBOARD_VIEW (renderiza Stealth_404 quando ausente).
 *
 * Cada bloco isola seu erro proprio (degradacao parcial — CP-2).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  downloadCsvBlob,
  exportCSV,
  formatBRL,
  getMetrics,
  parseFiltersFromQuery,
  serializeFiltersToQuery,
  type DashboardFilters,
  type DashboardMetricsBundle,
  type DashboardServiceError,
} from '../../services/admin/dashboard';
import { useAdminPermission } from '../../hooks/useAdminPermission';
import Stealth404 from '../../components/admin/Stealth404';
import DashboardTopBar from '../../components/admin/dashboard/DashboardTopBar';
import DashboardKpiGrid from '../../components/admin/dashboard/DashboardKpiGrid';
import DashboardTrendChart from '../../components/admin/dashboard/DashboardTrendChart';
import DashboardGeoMap from '../../components/admin/dashboard/DashboardGeoMap';
import DashboardSecurityAlerts from '../../components/admin/dashboard/DashboardSecurityAlerts';
import DashboardTopList from '../../components/admin/dashboard/DashboardTopList';
import DashboardBlockSkeleton from '../../components/admin/dashboard/DashboardBlockSkeleton';
import DashboardBlockError from '../../components/admin/dashboard/DashboardBlockError';

interface PageState {
  status: 'loading' | 'ready' | 'error';
  bundle?: DashboardMetricsBundle;
  error?: DashboardServiceError;
}

export default function AdminDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = useMemo(() => parseFiltersFromQuery(searchParams), [searchParams]);
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [exporting, setExporting] = useState(false);

  const { allowed: canView } = useAdminPermission('DASHBOARD_VIEW');
  const { allowed: hasFinanceiro } = useAdminPermission('FINANCEIRO_VIEW');
  const { allowed: hasAudit } = useAdminPermission('AUDIT_VIEW');

  // Sincroniza URL <- filters
  useEffect(() => {
    setSearchParams(serializeFiltersToQuery(filters), { replace: true });
  }, [filters, setSearchParams]);

  // Carrega bundle quando filtros ou refreshKey mudam
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setState({ status: 'loading' });
    getMetrics(filters)
      .then((b) => {
        if (cancelled) return;
        setState({ status: 'ready', bundle: b });
      })
      .catch((e: DashboardServiceError) => {
        if (cancelled) return;
        setState({ status: 'error', error: e });
      });
    return () => {
      cancelled = true;
    };
  }, [canView, filters, refreshKey]);

  const onRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const onExport = useCallback(async () => {
    if (state.status !== 'ready') return;
    setExporting(true);
    try {
      const result = await exportCSV(filters, { hasFinanceiro, hasAudit });
      downloadCsvBlob(result.csv, result.filename);
      if (result.truncated) {
        alert('Export limitado a 10000 linhas. Refine os filtros para exportar mais.');
      }
    } catch (err) {
      alert((err as Error).message ?? 'Falha ao exportar CSV.');
    } finally {
      setExporting(false);
    }
  }, [filters, hasFinanceiro, hasAudit, state.status]);

  if (!canView) return <Stealth404 />;

  const bundle = state.bundle;
  const loading = state.status === 'loading';
  const globalError =
    state.status === 'error' ? (state.error?.message ?? 'Erro desconhecido') : undefined;

  return (
    <div className="space-y-3">
      <DashboardTopBar
        filters={filters}
        onChangeFilters={setFilters}
        onRefresh={onRefresh}
        onExport={() => void onExport()}
        canExport={state.status === 'ready'}
        exporting={exporting}
      />

      {/* KPIs */}
      <DashboardKpiGrid
        bundle={bundle}
        loading={loading}
        error={globalError}
        onRetry={onRefresh}
        filters={filters}
      />

      {/* Graficos de tendencia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {loading ? (
          <DashboardBlockSkeleton className="h-64" />
        ) : globalError || bundle?.errors.cadastros ? (
          <div data-block="cadastros">
            <DashboardBlockError
              message={globalError ?? bundle?.errors.cadastros}
              onRetry={onRefresh}
            />
          </div>
        ) : bundle ? (
          <div data-block="cadastros">
            <DashboardTrendChart
              title="Cadastros novos por dia"
              ariaLabel="Cadastros novos por dia: motoristas e embarcadores"
              series={[
                ...(filters.userType !== 'embarcador'
                  ? [
                      {
                        name: 'Motoristas',
                        color: '#3b82f6',
                        points: bundle.series.cadastrosMotoristas,
                      },
                    ]
                  : []),
                ...(filters.userType !== 'motorista'
                  ? [
                      {
                        name: 'Embarcadores',
                        color: '#f97316',
                        points: bundle.series.cadastrosEmbarcadores,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : null}

        {loading ? (
          <DashboardBlockSkeleton className="h-64" />
        ) : globalError || bundle?.errors.fretes ? (
          <div data-block="fretes">
            <DashboardBlockError
              message={globalError ?? bundle?.errors.fretes}
              onRetry={onRefresh}
            />
          </div>
        ) : bundle ? (
          <div data-block="fretes">
            <DashboardTrendChart
              title="Fretes postados vs encerrados"
              ariaLabel="Fretes postados vs encerrados por dia"
              series={[
                {
                  name: 'Postados',
                  color: '#22c55e',
                  points: bundle.series.fretesPostados,
                },
                {
                  name: 'Encerrados',
                  color: '#9ca3af',
                  points: bundle.series.fretesEncerrados,
                },
              ]}
            />
          </div>
        ) : null}
      </div>

      {/* Volume diario (gated FINANCEIRO_VIEW) */}
      {hasFinanceiro && bundle?.series.volumeDiario && (
        <div data-block="volume">
          <DashboardTrendChart
            title="Volume transacionado por dia"
            ariaLabel="Volume transacionado por dia em reais"
            series={[
              {
                name: 'Volume',
                color: '#0891b2',
                points: bundle.series.volumeDiario,
              },
            ]}
            formatter={(n) => formatBRL(n)}
          />
        </div>
      )}

      {/* Mapa geografico */}
      {loading ? (
        <DashboardBlockSkeleton className="h-80" />
      ) : globalError || bundle?.errors.geo ? (
        <div data-block="geo">
          <DashboardBlockError message={globalError ?? bundle?.errors.geo} onRetry={onRefresh} />
        </div>
      ) : bundle ? (
        <div data-block="geo">
          <DashboardGeoMap
            fretesAtivos={bundle.geo.fretesAtivos}
            usuariosAtivos={bundle.geo.usuariosAtivos}
          />
        </div>
      ) : null}

      {/* Alertas + tops */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {hasAudit && (
          <div className="space-y-3">
            {loading ? (
              <DashboardBlockSkeleton className="h-48" />
            ) : (
              <DashboardSecurityAlerts
                alerts={bundle?.securityAlerts?.items ?? null}
                error={globalError}
                onRetry={onRefresh}
              />
            )}
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            <DashboardBlockSkeleton className="h-48" />
          ) : (
            <>
              {hasFinanceiro && bundle?.topEmbarcadores && (
                <div data-block="top_embarcadores">
                  <DashboardTopList
                    title="Top embarcadores"
                    items={bundle.topEmbarcadores.items}
                    error={globalError ?? bundle.errors.top_embarcadores}
                    onRetry={onRefresh}
                  />
                </div>
              )}
              <div data-block="top_motoristas">
                <DashboardTopList
                  title="Top motoristas"
                  items={bundle?.topMotoristas.items ?? null}
                  error={globalError ?? bundle?.errors.top_motoristas}
                  onRetry={onRefresh}
                />
              </div>
              <div data-block="top_rotas">
                <DashboardTopList
                  title="Top rotas"
                  items={bundle?.topRotas.items ?? null}
                  error={globalError ?? bundle?.errors.top_rotas}
                  onRetry={onRefresh}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {}
    </div>
  );
}
