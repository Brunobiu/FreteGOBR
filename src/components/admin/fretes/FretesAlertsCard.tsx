/**
 * FretesAlertsCard - 3 alertas compactos exibidos inline na barra de ações.
 */

import type { FretesAlerts } from '../../../services/admin/fretes';

interface Props {
  alerts: FretesAlerts | null;
  onClickFlagged: () => void;
}

export default function FretesAlertsCard({ alerts, onClickFlagged }: Props) {
  if (!alerts) return null;
  const total = alerts.flaggedCount + alerts.expiredActiveCount + alerts.noClicksRecentCount;
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      {alerts.flaggedCount > 0 && (
        <button
          type="button"
          onClick={onClickFlagged}
          className="px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition"
          title={`${alerts.flaggedCount} fretes sob revisão`}
        >
          ⚑ {alerts.flaggedCount}
        </button>
      )}
      {alerts.expiredActiveCount > 0 && (
        <span
          className="px-2 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
          title={`${alerts.expiredActiveCount} fretes ativos com prazo expirado`}
        >
          ⏰ {alerts.expiredActiveCount}
        </span>
      )}
      {alerts.noClicksRecentCount > 0 && (
        <span
          className="px-2 py-0.5 rounded border border-gray-600/40 bg-gray-700/40 text-gray-400"
          title={`${alerts.noClicksRecentCount} fretes ativos sem cliques há 7 dias`}
        >
          ⌛ {alerts.noClicksRecentCount}
        </span>
      )}
    </div>
  );
}
