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
      <div className="min-h-screen bg-gray-100">
        <AppHeader />
        <div className="flex justify-center py-20 text-gray-600">Carregando painel admin...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Painel Administrativo</h1>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-white rounded-lg p-1 w-fit border border-gray-200">
          {(['metrics', 'users', 'fretes'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {t === 'metrics' ? 'Métricas' : t === 'users' ? 'Usuários' : 'Fretes'}
            </button>
          ))}
        </div>

        {/* Métricas */}
        {tab === 'metrics' && metrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Total Usuários', value: metrics.totalUsers, color: 'text-blue-600' },
              { label: 'Motoristas', value: metrics.totalMotoristas, color: 'text-green-600' },
              { label: 'Embarcadores', value: metrics.totalEmbarcadores, color: 'text-purple-600' },
              { label: 'Fretes Ativos', value: metrics.activeFretes, color: 'text-yellow-600' },
              {
                label: 'Fretes Encerrados',
                value: metrics.completedFretes,
                color: 'text-gray-600',
              },
              { label: 'Total Fretes', value: metrics.totalFretes, color: 'text-gray-800' },
            ].map((m) => (
              <div
                key={m.label}
                className="bg-white border border-gray-200 rounded-lg p-5 text-center"
              >
                <p className={`text-3xl font-bold ${m.color}`}>{m.value}</p>
                <p className="text-xs text-gray-600 mt-1">{m.label}</p>
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
                className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
              />
              <select
                value={filterUserType}
                onChange={(e) => setFilterUserType(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
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
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-600">Nome</th>
                    <th className="px-4 py-2 text-left text-gray-600">Telefone</th>
                    <th className="px-4 py-2 text-left text-gray-600">Tipo</th>
                    <th className="px-4 py-2 text-left text-gray-600">Status</th>
                    <th className="px-4 py-2 text-left text-gray-600">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-gray-200">
                      <td className="px-4 py-3 text-gray-800">{u.name}</td>
                      <td className="px-4 py-3 text-gray-600">{u.phone}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${u.userType === 'motorista' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}
                        >
                          {u.userType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
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
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
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
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-600">Rota</th>
                    <th className="px-4 py-2 text-left text-gray-600">Carga</th>
                    <th className="px-4 py-2 text-left text-gray-600">Status</th>
                    <th className="px-4 py-2 text-left text-gray-600">Views</th>
                    <th className="px-4 py-2 text-left text-gray-600">Data</th>
                    <th className="px-4 py-2 text-left text-gray-600">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {fretes.map((f) => (
                    <tr key={f.id} className="border-t border-gray-200">
                      <td className="px-4 py-3 text-gray-800">
                        {f.origin} → {f.destination}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{f.cargoType}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            f.status === 'ativo'
                              ? 'bg-green-100 text-green-700'
                              : f.status === 'encerrado'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {f.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{f.viewsCount}</td>
                      <td className="px-4 py-3 text-gray-600">
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
