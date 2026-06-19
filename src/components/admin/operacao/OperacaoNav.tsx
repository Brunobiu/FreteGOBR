/**
 * OperacaoNav — sub-navegação compacta da Central de Operação (Painel · Alertas
 * · Logs). Cada aba só aparece com a permissão correspondente (DASHBOARD_VIEW /
 * ALERT_VIEW / LOG_VIEW), espelhando o gating das próprias páginas.
 */

import { NavLink } from 'react-router-dom';
import { useAdminPermission } from '../../../hooks/useAdminPermission';

function linkCls({ isActive }: { isActive: boolean }): string {
  return `px-3 py-1.5 text-[13px] border-b-2 -mb-px transition ${
    isActive
      ? 'border-cyan-400 text-cyan-300'
      : 'border-transparent text-gray-400 hover:text-gray-200'
  }`;
}

export default function OperacaoNav() {
  const { allowed: canDash } = useAdminPermission('DASHBOARD_VIEW');
  const { allowed: canAlerts } = useAdminPermission('ALERT_VIEW');
  const { allowed: canLogs } = useAdminPermission('LOG_VIEW');

  return (
    <nav className="flex items-center gap-1 border-b border-gray-800">
      {canDash && (
        <NavLink to="/admin/operacao" end className={linkCls}>
          Painel
        </NavLink>
      )}
      {canAlerts && (
        <NavLink to="/admin/operacao/alertas" className={linkCls}>
          Alertas
        </NavLink>
      )}
      {canLogs && (
        <NavLink to="/admin/operacao/logs" className={linkCls}>
          Logs
        </NavLink>
      )}
    </nav>
  );
}
