import { useAuth } from '../hooks/useAuth';

export default function EmbarcadorHomePage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Bem-vindo, {user?.name}!</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card: Fretes Ativos */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Fretes Ativos</h2>
              <svg
                className="w-8 h-8 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <p className="text-3xl font-bold text-white mb-2">-</p>
            <p className="text-sm text-gray-400">Aguardando implementação</p>
          </div>

          {/* Card: Visualizações */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Visualizações</h2>
              <svg
                className="w-8 h-8 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </div>
            <p className="text-3xl font-bold text-white mb-2">-</p>
            <p className="text-sm text-gray-400">Aguardando implementação</p>
          </div>

          {/* Card: Avaliação */}
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Avaliação</h2>
              <svg className="w-8 h-8 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-white mb-2">-</p>
            <p className="text-sm text-gray-400">Aguardando implementação</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8">
          <h2 className="text-2xl font-bold text-white mb-4">Ações Rápidas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button className="bg-gray-900 p-4 rounded-lg border border-gray-800 hover:border-blue-500 transition-colors text-left">
              <svg
                className="w-6 h-6 text-blue-500 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <p className="text-white font-medium">Postar Frete</p>
              <p className="text-sm text-gray-400 mt-1">Em breve</p>
            </button>

            <button className="bg-gray-900 p-4 rounded-lg border border-gray-800 hover:border-blue-500 transition-colors text-left">
              <svg
                className="w-6 h-6 text-blue-500 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              <p className="text-white font-medium">Meus Fretes</p>
              <p className="text-sm text-gray-400 mt-1">Gerenciar</p>
            </button>

            <button className="bg-gray-900 p-4 rounded-lg border border-gray-800 hover:border-blue-500 transition-colors text-left">
              <svg
                className="w-6 h-6 text-blue-500 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <p className="text-white font-medium">Estatísticas</p>
              <p className="text-sm text-gray-400 mt-1">Em breve</p>
            </button>

            <button className="bg-gray-900 p-4 rounded-lg border border-gray-800 hover:border-blue-500 transition-colors text-left">
              <svg
                className="w-6 h-6 text-blue-500 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              <p className="text-white font-medium">Perfil</p>
              <p className="text-sm text-gray-400 mt-1">Editar</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
