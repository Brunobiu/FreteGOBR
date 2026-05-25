/**
 * DashboardSecurityAlerts - lista de alertas de seguranca recentes (24h fixo).
 *
 * Componente assume que o caller ja gated por AUDIT_VIEW. Quando o sub-objeto
 * vem null (sem AUDIT_VIEW), retorna null.
 */

import { Link } from 'react-router-dom';
import {
  formatRelativeTime,
  resolveAlertLabel,
  type DashboardSecurityAlertRaw,
} from '../../../services/admin/dashboard';
import DashboardBlockError from './DashboardBlockError';

interface Props {
  alerts: DashboardSecurityAlertRaw[] | null;
  error?: string;
  onRetry: () => void;
}

const SEVERITY_BG: Record<'info' | 'warn' | 'high', string> = {
  info: 'bg-cyan-500/10 text-cyan-300',
  warn: 'bg-amber-500/10 text-amber-300',
  high: 'bg-red-500/10 text-red-300',
};

const SEVERITY_ICON: Record<'info' | 'warn' | 'high', string> = {
  info: 'ℹ',
  warn: '⚠',
  high: '⛔',
};

export default function DashboardSecurityAlerts({ alerts, error, onRetry }: Props) {
  if (alerts === null) return null;

  if (error) {
    return (
      <div data-block="security_alerts">
        <DashboardBlockError message={error} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div data-block="security_alerts" className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <h3 className="text-xs font-semibold text-gray-300 mb-2">Alertas de segurança (24h)</h3>
      {alerts.length === 0 ? (
        <div role="status" className="text-xs text-green-300 flex items-center gap-2 py-3">
          <span aria-hidden="true">✓</span>
          Nenhum alerta nas últimas 24 horas.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {alerts.slice(0, 10).map((a) => {
            const { label, severity } = resolveAlertLabel(a.action);
            return (
              <li key={`${a.action}:${a.lastAt}`}>
                <Link
                  to={`/admin/audit?action=${a.action}`}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800/60 transition"
                >
                  <span
                    aria-hidden="true"
                    className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] ${SEVERITY_BG[severity]}`}
                  >
                    {SEVERITY_ICON[severity]}
                  </span>
                  <span className="flex-1 text-xs text-gray-200 truncate">{label}</span>
                  {a.count > 1 && <span className="text-[10px] text-gray-500">× {a.count}</span>}
                  <span className="text-[10px] text-gray-500 whitespace-nowrap">
                    {formatRelativeTime(a.lastAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
