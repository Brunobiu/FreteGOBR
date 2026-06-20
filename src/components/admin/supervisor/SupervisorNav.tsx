/**
 * SupervisorNav — sub-navegação compacta da IA Supervisora (Painel · Diagnóstico
 * · Insights · Resumo). Todas as abas exigem SUPERVISOR_VIEW (gating da página).
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

export default function SupervisorNav() {
  const { allowed } = useAdminPermission('SUPERVISOR_VIEW');
  if (!allowed) return null;
  return (
    <nav className="flex items-center gap-1 border-b border-gray-800">
      <NavLink to="/admin/supervisor" end className={linkCls}>
        Painel
      </NavLink>
      <NavLink to="/admin/supervisor/diagnostico" className={linkCls}>
        Diagnóstico
      </NavLink>
      <NavLink to="/admin/supervisor/insights" className={linkCls}>
        Insights
      </NavLink>
      <NavLink to="/admin/supervisor/resumo" className={linkCls}>
        Resumo
      </NavLink>
    </nav>
  );
}
