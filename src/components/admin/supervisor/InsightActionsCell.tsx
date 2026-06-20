/**
 * InsightActionsCell — botões Reconhecer/Descartar de um insight, com gating de UI.
 *
 * Camada 1 (UI): aparecem só com SUPERVISOR_MANAGE; "Reconhecer" só em OPEN;
 * "Descartar" em OPEN/ACKNOWLEDGED (DISMISSED é terminal). O servidor revalida.
 * Envia `updated_at` (versionamento otimista).
 */

import { useAdminPermission } from '../../../hooks/useAdminPermission';
import type { SupervisorInsight } from '../../../services/admin/supervisor';

interface Props {
  insight: SupervisorInsight;
  busy: boolean;
  onAck: (insight: SupervisorInsight) => void;
  onDismiss: (insight: SupervisorInsight) => void;
}

export default function InsightActionsCell({ insight, busy, onAck, onDismiss }: Props) {
  const { allowed: canManage } = useAdminPermission('SUPERVISOR_MANAGE');
  if (!canManage) return <span className="text-gray-600">—</span>;

  const showAck = insight.state === 'OPEN';
  const showDismiss = insight.state === 'OPEN' || insight.state === 'ACKNOWLEDGED';
  if (!showAck && !showDismiss) return <span className="text-gray-600">—</span>;

  return (
    <div className="flex items-center gap-1.5">
      {showAck && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAck(insight)}
          className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          Reconhecer
        </button>
      )}
      {showDismiss && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onDismiss(insight)}
          className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          Descartar
        </button>
      )}
    </div>
  );
}
