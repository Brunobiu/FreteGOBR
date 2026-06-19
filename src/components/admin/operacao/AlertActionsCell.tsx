/**
 * AlertActionsCell — botões Reconhecer/Resolver de um alerta, com gating de UI.
 *
 * Camada 1 do gating (UI): "Reconhecer" só aparece com ALERT_ACK e alerta OPEN;
 * "Resolver" só com ALERT_RESOLVE e alerta OPEN/ACKNOWLEDGED. O servidor revalida
 * (camada 2). O envio carrega `updated_at` (versionamento otimista).
 */

import { useAdminPermission } from '../../../hooks/useAdminPermission';
import type { SystemAlert } from '../../../services/admin/operacao';

interface Props {
  alert: SystemAlert;
  busy: boolean;
  onAck: (alert: SystemAlert) => void;
  onResolve: (alert: SystemAlert) => void;
}

export default function AlertActionsCell({ alert, busy, onAck, onResolve }: Props) {
  const { allowed: canAck } = useAdminPermission('ALERT_ACK');
  const { allowed: canResolve } = useAdminPermission('ALERT_RESOLVE');

  const showAck = canAck && alert.state === 'OPEN';
  const showResolve = canResolve && (alert.state === 'OPEN' || alert.state === 'ACKNOWLEDGED');

  if (!showAck && !showResolve) return <span className="text-gray-600">—</span>;

  return (
    <div className="flex items-center gap-1.5">
      {showAck && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAck(alert)}
          className="text-xs px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          Reconhecer
        </button>
      )}
      {showResolve && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(alert)}
          className="text-xs px-2.5 py-1 rounded bg-green-600/80 text-white hover:bg-green-600 disabled:opacity-50"
        >
          Resolver
        </button>
      )}
    </div>
  );
}
