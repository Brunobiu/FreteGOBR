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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel administrativo</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Papeis ativos</div>
          <div className="text-lg font-semibold text-gray-100">
            {roles.length === 0 ? 'Nenhum' : roles.join(', ')}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Eventos de seguranca (24h)
          </div>
          <div className="text-lg font-semibold text-gray-100">Nenhum incidente recente</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Atalhos</div>
          <div className="flex flex-col gap-1 mt-2 text-sm">
            <Link to="/admin/audit" className="text-cyan-400 hover:underline">
              Ver auditoria
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200/80">
        Em breve: dashboards completos com metricas de usuarios, fretes, receita e alertas de
        seguranca. Esta tela e apenas um placeholder da fundacao do painel.
      </div>
    </div>
  );
}
