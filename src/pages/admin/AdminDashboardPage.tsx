/**
 * AdminDashboardPage - placeholder
 *
 * Conteudo completo de metricas/graficos sera entregue na spec admin-dashboard.
 * Por ora, exibe cards basicos de seguranca e atalhos.
 */

import { Link } from 'react-router-dom';
import { useAdminContext } from '../../components/admin/AdminProvider';

export default function AdminDashboardPage() {
  const { roles } = useAdminContext();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Papéis ativos
          </div>
          <div className="text-sm font-semibold text-gray-100">
            {roles.length === 0 ? 'Nenhum' : roles.join(', ')}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Eventos de segurança (24h)
          </div>
          <div className="text-sm font-semibold text-gray-100">Nenhum incidente recente</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Atalhos</div>
          <div className="flex flex-col gap-1 mt-1 text-xs">
            <Link to="/admin/audit" className="text-cyan-400 hover:underline">
              Ver auditoria
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
