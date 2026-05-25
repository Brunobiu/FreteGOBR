/**
 * DashboardTopBar - barra superior do dashboard com periodo + acoes.
 */

import { describePeriod, type DashboardFilters } from '../../../services/admin/dashboard';
import DashboardFilterPopover from './DashboardFilterPopover';

interface Props {
  filters: DashboardFilters;
  onChangeFilters: (next: DashboardFilters) => void;
  onRefresh: () => void;
  onExport: () => void;
  canExport: boolean;
  exporting?: boolean;
}

export default function DashboardTopBar({
  filters,
  onChangeFilters,
  onRefresh,
  onExport,
  canExport,
  exporting = false,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="text-xs text-gray-400">
        Período: <span className="text-gray-200">{describePeriod(filters)}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-200 hover:bg-gray-700"
          title="Atualizar dados"
        >
          Atualizar
        </button>
        <DashboardFilterPopover filters={filters} onChange={onChangeFilters} />
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport || exporting}
          title={!canExport ? 'Aguarde os dados carregarem.' : 'Exportar dashboard em CSV'}
          className="px-2.5 py-1 rounded text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {exporting ? 'Gerando...' : 'Exportar CSV'}
        </button>
      </div>
    </div>
  );
}
