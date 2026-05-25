/**
 * DashboardKpiGrid - grid de KPIs principais.
 *
 * Renderiza skeleton enquanto carrega; bloco de erro em caso de falha global;
 * caso contrario, ate 9 DashboardKpiCard com gating granular.
 *
 * Cards gated por FINANCEIRO_VIEW e AUDIT_VIEW sao automaticamente omitidos
 * quando o sub-objeto correspondente vem null do servidor.
 */

import {
  formatBRL,
  formatNumber,
  type DashboardFilters,
  type DashboardMetricsBundle,
} from '../../../services/admin/dashboard';
import DashboardBlockError from './DashboardBlockError';
import DashboardBlockSkeleton from './DashboardBlockSkeleton';
import DashboardKpiCard from './DashboardKpiCard';

interface Props {
  bundle?: DashboardMetricsBundle;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  filters: DashboardFilters;
}

function periodLabelSuffix(filters: DashboardFilters): string {
  switch (filters.period) {
    case 'today':
      return '24h';
    case '7d':
      return '7d';
    case '30d':
      return '30d';
    case 'custom':
      return 'período';
  }
}

function formatPercentage(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

export default function DashboardKpiGrid({ bundle, loading, error, onRetry, filters }: Props) {
  if (loading || !bundle) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <DashboardBlockSkeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (error || bundle.errors.kpis) {
    return (
      <div data-block="kpis">
        <DashboardBlockError message={error ?? bundle.errors.kpis} onRetry={onRetry} />
      </div>
    );
  }

  const suffix = periodLabelSuffix(filters);

  // Construir querystrings de drill-down
  const periodQ = filters.period !== '7d' ? `&period=${filters.period}` : '';
  const ufQ = filters.uf ? `&uf=${filters.uf}` : '';

  return (
    <div data-block="kpis" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
      <DashboardKpiCard
        label="Usuários ativos"
        kpi={bundle.kpis.usuariosAtivos}
        formatter={formatNumber}
        link={`/admin/users?status=ativo${ufQ}`}
      />
      <DashboardKpiCard
        label={`Cadastros (${suffix})`}
        kpi={bundle.kpis.novosCadastros}
        formatter={formatNumber}
        link={`/admin/users?${periodQ}${ufQ}`.replace(/^[?&]+/, '?')}
      />
      <DashboardKpiCard
        label="Fretes ativos"
        kpi={bundle.kpis.fretesAtivos}
        formatter={formatNumber}
        link={`/admin/fretes?status=ativo${ufQ}`}
      />
      <DashboardKpiCard
        label={`Postados (${suffix})`}
        kpi={bundle.kpis.fretesPostados}
        formatter={formatNumber}
        link={`/admin/fretes?${periodQ}${ufQ}`.replace(/^[?&]+/, '?')}
      />
      <DashboardKpiCard
        label={`Encerrados (${suffix})`}
        kpi={bundle.kpis.fretesEncerrados}
        formatter={formatNumber}
        link={`/admin/fretes?status=encerrado${ufQ}`}
      />
      <DashboardKpiCard
        label="Taxa de conversão"
        kpi={bundle.kpis.taxaConversaoPct}
        formatter={formatPercentage}
      />
      <DashboardKpiCard
        label={`Volume (${suffix})`}
        kpi={bundle.kpis.volumeTransacionado}
        formatter={formatBRL}
        link={`/admin/fretes?status=encerrado${ufQ}`}
      />
      <DashboardKpiCard
        label={`Logins admin (${suffix})`}
        kpi={bundle.kpis.loginsAdmin}
        formatter={formatNumber}
        link="/admin/audit?action=ADMIN_LOGIN_SUCCESS"
      />
      <DashboardKpiCard
        label="Alertas segurança 24h"
        kpi={bundle.kpis.alertasSeguranca24h}
        formatter={formatNumber}
        link="/admin/audit?action=ADMIN_LOGIN_FAILURE"
        invertColors
      />
    </div>
  );
}
