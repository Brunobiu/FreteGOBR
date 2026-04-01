import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import {
  getPlatformMetrics,
  getAdminUsers,
  getAdminFretes,
  toggleUserActive,
  adminDeleteFrete,
  type PlatformMetrics,
  type AdminUser,
  type AdminFrete,
} from '../services/admin';

type Tab = 'metrics' | 'users' | 'fretes';

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('metrics');
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [fretes, setFretes] = useState<AdminFrete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchUser, setSearchUser] = useState('');
  const [filterUserType, setFilterUserType] = useState('');
  const [filterFreteStatus, setFilterFreteStatus] = useState('');

  useEffect(() => {
    if (user?.userType !== 'admin') {
      navigate('/');
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [m, u, f] = await Promise.all([
        getPlatformMetrics(),
        getAdminUsers(),
        getAdminFretes(),
      ]);
      setMetrics(m);
      setUsers(u);
      setFretes(f);
    } catch (err) {
      console.error('Erro ao carregar dados admin:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleUser = async (userId: string, isActive: boolean) => {
    await toggleUserActive(userId, !isActive);
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive: !isActive } : u)));
  };

  const handleDeleteFrete = async (freteId: string) => {
    if (!confirm('Excluir este frete?')) return;
    await adminDeleteFrete(freteId);
    setFretes((prev) => prev.filter((f) => f.id !== freteId));
  };

  const handleSearchUsers = async () => {
    const data = await getAdminUsers({
      userType: filterUserType || undefined,
      search: searchUser || undefined,
    });
    setUsers(data);
  };

  const handleFilterFretes = async () => {
    const data = await getAdminFretes({ status: filterFreteStatus || undefined });
    setFretes(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <AppHeader />
        <div className="flex justify-center py-20 text-gray-400">Carregando painel admin...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <AppHeader />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-white mb-6">Painel Administrativo</h1>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-gray-900 rounded-lg p-1 w-fit">
          {(['metrics', 'users', 'fretes'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {t === 'metrics' ? 'Métricas' : t === 'users' ? 'Usuários' : 'Fretes'}
            </button>
          ))}
        </div>

        {/* Métricas */}
        {tab === 'metrics' && metrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Total Usuários', value: metrics.totalUsers, color: 'text-blue-400' },
              { label: 'Motoristas', value: metrics.totalMotoristas, color: 'text-green-400' },
              { label: 'Embarcadores', value: metrics.totalEmbarcadores, color: 'text-purple-400' },
              { label: 'Fretes Ativos', value: metrics.activeFretes, color: 'text-yellow-400' },
              {
                label: 'Fretes Encerrados',
                value: metrics.completedFretes,
                color: 'text-gray-400',
              },
              { label: 'Total Fretes', value: metrics.totalFretes, color: 'text-white' },
            ].map((m) => (
              <div
                key={m.label}
                className="bg-gray-900 border border-gray-800 rounded-lg p-5 text-center"
              >
                <p className={`text-3xl font-bold ${m.color}`}>{m.value}</p>
                <p className="text-xs text-gray-400 mt-1">{m.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Usuários */}
        {tab === 'users' && (
          <div>
            <div className="flex space-x-2 mb-4">
              <input
                type="text"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              />
              <select
                value={filterUserType}
                onChange={(e) => setFilterUserType(e.target.value)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              >
                <option value="">Todos</option>
                <option value="motorista">Motorista</option>
                <option value="embarcador">Embarcador</option>
              </select>
              <button
                onClick={handleSearchUsers}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Buscar
              </button>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-400">Nome</th>
                    <th className="px-4 py-2 text-left text-gray-400">Telefone</th>
                    <th className="px-4 py-2 text-left text-gray-400">Tipo</th>
                    <th className="px-4 py-2 text-left text-gray-400">Status</th>
                    <th className="px-4 py-2 text-left text-gray-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-gray-800">
                      <td className="px-4 py-3 text-white">{u.name}</td>
                      <td className="px-4 py-3 text-gray-300">{u.phone}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${u.userType === 'motorista' ? 'bg-green-900/50 text-green-300' : 'bg-purple-900/50 text-purple-300'}`}
                        >
                          {u.userType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${u.isActive ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}
                        >
                          {u.isActive ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleUser(u.id, u.isActive)}
                          className={`text-xs px-3 py-1 rounded ${u.isActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                        >
                          {u.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Fretes */}
        {tab === 'fretes' && (
          <div>
            <div className="flex space-x-2 mb-4">
              <select
                value={filterFreteStatus}
                onChange={(e) => setFilterFreteStatus(e.target.value)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
              >
                <option value="">Todos</option>
                <option value="ativo">Ativo</option>
                <option value="encerrado">Encerrado</option>
                <option value="cancelado">Cancelado</option>
              </select>
              <button
                onClick={handleFilterFretes}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Filtrar
              </button>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-400">Rota</th>
                    <th className="px-4 py-2 text-left text-gray-400">Carga</th>
                    <th className="px-4 py-2 text-left text-gray-400">Status</th>
                    <th className="px-4 py-2 text-left text-gray-400">Views</th>
                    <th className="px-4 py-2 text-left text-gray-400">Data</th>
                    <th className="px-4 py-2 text-left text-gray-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {fretes.map((f) => (
                    <tr key={f.id} className="border-t border-gray-800">
                      <td className="px-4 py-3 text-white">
                        {f.origin} → {f.destination}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{f.cargoType}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            f.status === 'ativo'
                              ? 'bg-green-900/50 text-green-300'
                              : f.status === 'encerrado'
                                ? 'bg-gray-700 text-gray-300'
                                : 'bg-red-900/50 text-red-300'
                          }`}
                        >
                          {f.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{f.viewsCount}</td>
                      <td className="px-4 py-3 text-gray-400">
                        {new Date(f.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDeleteFrete(f.id)}
                          className="text-xs px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
