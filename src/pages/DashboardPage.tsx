import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Redirect based on user type
  useEffect(() => {
    if (user) {
      if (user.userType === 'motorista') {
        navigate('/motorista/dashboard', { replace: true });
      } else if (user.userType === 'embarcador') {
        navigate('/embarcador/dashboard', { replace: true });
      } else if (user.userType === 'admin') {
        navigate('/admin/dashboard', { replace: true });
      }
    }
  }, [user, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-gray-900 shadow border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">FreteGO Dashboard</h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{user?.name}</p>
              <p className="text-xs text-gray-400 capitalize">{user?.userType}</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="bg-gray-900 rounded-lg shadow border border-gray-800 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Bem-vindo, {user?.name}!</h2>
          <p className="text-gray-300">
            Você está logado como <span className="font-medium capitalize">{user?.userType}</span>.
          </p>
          <p className="text-gray-300 mt-2">Telefone: {user?.phone}</p>
          <p className="text-gray-400 mt-4">Redirecionando...</p>
        </div>
      </main>
    </div>
  );
}
